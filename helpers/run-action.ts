import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as consumers from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The runner sets these too, so they are overridden rather than defaulted: a
// test must never reach the real API or depend on where it runs. fetch refuses
// port 9 outright, so a request that no fake answers fails at once.
const githubEnv = {
	GITHUB_API_URL: 'http://127.0.0.1:9',
	GITHUB_SERVER_URL: 'https://github.com',
	GITHUB_REPOSITORY: 'navikt/fixture',
};

export interface ActionResult {
	/** The working directory the action ran in. */
	cwd: string;
	status: number | null;
	stdout: string;
	stderr: string;
	/** What the action wrote to GITHUB_OUTPUT. */
	outputs: Record<string, string>;
	/** What the action wrote to GITHUB_STEP_SUMMARY. */
	summary: string;
}

export interface RunOptions {
	/** Defaults to a new temporary directory. */
	cwd?: string;
	/** Applied over the GitHub variables above, e.g. `GITHUB_API_URL` for a fake. */
	env?: Record<string, string>;
}

/**
 * Run an action the way the runner does: `node <action>/src/main.ts` with
 * each input as `INPUT_<NAME>` and GITHUB_OUTPUT and GITHUB_STEP_SUMMARY
 * files. Node strips the types itself, so no build is involved. Defaults from
 * action.yml are not applied; pass every input the test relies on.
 */
export function runAction(action: string, inputs: Record<string, string> = {}, cwd?: string): ActionResult {
	const run = prepare(action, inputs, { cwd });
	const { status, stdout, stderr } = spawnSync(process.execPath, [run.main], {
		cwd: run.cwd,
		env: run.env,
		encoding: 'utf8',
	});
	return run.result(status, stdout, stderr);
}

/**
 * Like `runAction`, but without blocking the event loop, so the test can
 * answer the action's requests, e.g. with `fakeGitHub`.
 */
export async function runActionAsync(
	action: string,
	inputs: Record<string, string> = {},
	options: RunOptions = {},
): Promise<ActionResult> {
	const run = prepare(action, inputs, options);
	const child = spawn(process.execPath, [run.main], { cwd: run.cwd, env: run.env });
	const exited = new Promise<number | null>((resolve, reject) => {
		child.on('error', reject);
		child.on('close', resolve);
	});
	const [stdout, stderr, status] = await Promise.all([
		consumers.text(child.stdout),
		consumers.text(child.stderr),
		exited,
	]);
	return run.result(status, stdout, stderr);
}

/** The environment and files for one run, and how to read back what the action wrote. */
function prepare(action: string, inputs: Record<string, string>, options: RunOptions) {
	const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), `${action}-`));
	const files = mkdtempSync(join(tmpdir(), 'github-files-'));
	const outputFile = join(files, 'output');
	const summaryFile = join(files, 'summary');
	writeFileSync(outputFile, '');
	writeFileSync(summaryFile, '');

	const env: NodeJS.ProcessEnv = {
		...process.env,
		...githubEnv,
		...options.env,
		GITHUB_OUTPUT: outputFile,
		GITHUB_STEP_SUMMARY: summaryFile,
	};
	for (const [name, value] of Object.entries(inputs)) {
		env[`INPUT_${name.toUpperCase()}`] = value;
	}

	return {
		main: join(repoRoot, action, 'src', 'main.ts'),
		cwd,
		env,
		result: (status: number | null, stdout: string, stderr: string): ActionResult => ({
			cwd,
			status,
			stdout,
			stderr,
			outputs: parseOutputs(readFileSync(outputFile, 'utf8')),
			summary: readFileSync(summaryFile, 'utf8'),
		}),
	};
}

/** Parse a GITHUB_OUTPUT file: `name=value` lines and the `name<<EOF` blocks @actions/core writes. */
export function parseOutputs(text: string): Record<string, string> {
	const outputs: Record<string, string> = {};
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const block = /^([^=<]+)<<(.+)$/.exec(lines[i]);
		if (block) {
			const [, name, delimiter] = block;
			const value: string[] = [];
			while (++i < lines.length && lines[i] !== delimiter) value.push(lines[i]);
			outputs[name] = value.join('\n');
			continue;
		}
		const pair = /^([^=]+)=(.*)$/.exec(lines[i]);
		if (pair) outputs[pair[1]] = pair[2];
	}
	return outputs;
}

/** Create files under `root` from a path -> content map, making directories as needed. */
export function writeFiles(root: string, files: Record<string, string>): void {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}

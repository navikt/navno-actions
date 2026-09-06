import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export interface ActionResult {
	/** The working directory the action ran in. */
	cwd: string;
	status: number | null;
	stdout: string;
	stderr: string;
	/** What the action wrote to GITHUB_OUTPUT. */
	outputs: Record<string, string>;
}

/**
 * Run an action the way the runner does: `node <action>/src/main.ts` with
 * each input as `INPUT_<NAME>` and a GITHUB_OUTPUT file. Node strips the
 * types itself, so no build is involved. Defaults from action.yml are not
 * applied; pass every input the test relies on.
 */
export function runAction(
	action: string,
	inputs: Record<string, string> = {},
	cwd = mkdtempSync(join(tmpdir(), `${action}-`)),
): ActionResult {
	const outputFile = join(mkdtempSync(join(tmpdir(), 'github-output-')), 'output');
	writeFileSync(outputFile, '');

	const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: outputFile };
	for (const [name, value] of Object.entries(inputs)) {
		env[`INPUT_${name.toUpperCase()}`] = value;
	}

	const { status, stdout, stderr } = spawnSync(process.execPath, [join(repoRoot, action, 'src', 'main.ts')], {
		cwd,
		env,
		encoding: 'utf8',
	});
	return { cwd, status, stdout, stderr, outputs: parseOutputs(readFileSync(outputFile, 'utf8')) };
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

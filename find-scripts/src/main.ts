import * as core from '@actions/core';
import { readFile } from 'node:fs/promises';

async function readScripts(): Promise<Record<string, string>> {
	let text: string;
	try {
		text = await readFile('package.json', 'utf8');
	} catch {
		throw new Error(`No package.json in ${process.cwd()}`);
	}
	return JSON.parse(text).scripts ?? {};
}

async function run(): Promise<void> {
	try {
		const scripts = await readScripts();
		const required = new Set(core.getInput('require').split(/\s+/).filter(Boolean));

		for (const name of core.getInput('scripts', { required: true }).split(/\s+/).filter(Boolean)) {
			const found = name in scripts;
			core.setOutput(name, found);
			if (found) continue;
			if (required.has(name)) throw new Error(`package.json has no "${name}" script`);
			core.notice(`package.json has no "${name}" script, so the ${name} step is skipped`, {
				title: `No ${name} script`,
			});
		}
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}

await run();

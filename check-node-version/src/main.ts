import * as core from '@actions/core';
import { readFile } from 'node:fs/promises';

async function run(): Promise<void> {
	try {
		let text: string;
		try {
			text = await readFile('package.json', 'utf8');
		} catch {
			throw new Error(`No package.json in ${process.cwd()}`);
		}
		const version = JSON.parse(text).engines?.node;
		if (!version) {
			throw new Error(
				'package.json must declare the Node version in engines.node. ' +
					'Without it actions/setup-node silently uses whatever Node the runner ships.',
			);
		}
		core.info(`package.json declares Node ${version}`);
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}

await run();

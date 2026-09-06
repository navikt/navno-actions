import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import * as io from '@actions/io';

async function run(): Promise<void> {
	try {
		const patterns = core.getInput('remove', { required: true }).split(/\s+/).filter(Boolean);
		const globber = await glob.create(patterns.join('\n'), {
			// Match directories only
			implicitDescendants: false,
			// Do not walk pnpm (or other) symlinks
			followSymbolicLinks: false,
		});
		for (const path of await globber.glob()) {
			core.info(`Removing ${path}`);
			await io.rmRF(path);
		}
		await exec.exec('pnpm', ['install', '--frozen-lockfile', '--prod']);
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}

await run();

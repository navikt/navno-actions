import * as core from '@actions/core';
import * as exec from '@actions/exec';

async function run(): Promise<void> {
	try {
		for (const line of core.getMultilineInput('packages', { required: true })) {
			const words = line.split(/\s+/);
			if (words.length !== 2) {
				throw new Error(`expected "<package> <output-dir>", got: ${line}`);
			}
			const [pkg, outputDir] = words;
			await exec.exec('pnpm', ['--filter', pkg, 'deploy', '--prod', outputDir, '--legacy']);
		}
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}

await run();

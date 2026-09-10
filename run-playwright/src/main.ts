import * as core from '@actions/core';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Where the version comes from, most specific first. Playwright ships these in
 * lockstep, and `playwright-core` is what pins the browser revisions, so any of
 * them identifies the same browsers. Only direct dependencies are resolvable
 * under pnpm's default layout, hence the list.
 */
const PACKAGES = ['@playwright/test', 'playwright', 'playwright-core'];

/** The installed version, not the declared range: this is what package.json resolved to. */
function readVersion(cwd: string): string {
	// Resolve as if from a file in cwd, so bare specifiers hit cwd/node_modules.
	const require = createRequire(join(cwd, 'noop.js'));
	for (const name of PACKAGES) {
		let version: unknown;
		try {
			version = require(`${name}/package.json`).version;
		} catch {
			continue;
		}
		if (typeof version === 'string' && version) return version;
	}
	throw new Error(`No Playwright in ${cwd}. Looked for ${PACKAGES.join(', ')}.`);
}

try {
	const version = readVersion(process.cwd());
	core.info(`Playwright ${version}`);
	core.setOutput('version', version);
} catch (error) {
	core.setFailed(error instanceof Error ? error.message : String(error));
}

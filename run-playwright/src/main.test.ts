import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAction, writeFiles } from '../../helpers/run-action.ts';

/** A project with the named Playwright packages installed at the given versions. */
function project(packages: Record<string, string>): string {
	const cwd = mkdtempSync(join(tmpdir(), 'run-playwright-'));
	const files: Record<string, string> = { 'package.json': JSON.stringify({ name: 'fixture' }) };
	for (const [name, version] of Object.entries(packages)) {
		files[`node_modules/${name}/package.json`] = JSON.stringify({ name, version });
	}
	writeFiles(cwd, files);
	return cwd;
}

test('outputs the installed version', () => {
	const { status, stdout, outputs } = runAction('run-playwright', {}, project({ '@playwright/test': '1.62.1' }));

	assert.equal(status, 0, stdout);
	assert.equal(outputs.version, '1.62.1');
});

test('prefers @playwright/test, then playwright, then playwright-core', () => {
	const all = project({ '@playwright/test': '1.62.1', playwright: '1.60.0', 'playwright-core': '1.50.0' });
	assert.equal(runAction('run-playwright', {}, all).outputs.version, '1.62.1');

	const noTest = project({ playwright: '1.60.0', 'playwright-core': '1.50.0' });
	assert.equal(runAction('run-playwright', {}, noTest).outputs.version, '1.60.0');

	// pnpm does not hoist, so a transitive-only install leaves just playwright-core.
	const coreOnly = project({ 'playwright-core': '1.50.0' });
	assert.equal(runAction('run-playwright', {}, coreOnly).outputs.version, '1.50.0');
});

test('fails, naming every package it looked for, when Playwright is not installed', () => {
	const { status, stdout } = runAction('run-playwright', {}, project({}));

	assert.equal(status, 1);
	assert.match(stdout, /::error::No Playwright in /);
	assert.match(stdout, /@playwright\/test, playwright, playwright-core/);
});

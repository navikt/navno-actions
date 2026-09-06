import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAction } from '../../helpers/run-action.ts';

function packageWithScripts(scripts: Record<string, string>): string {
	const cwd = mkdtempSync(join(tmpdir(), 'find-scripts-'));
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', scripts }));
	return cwd;
}

test('outputs true for scripts that exist and false, with a notice, for those that do not', () => {
	const cwd = packageWithScripts({ build: 'vite build', test: 'vitest run' });
	const { status, stdout, outputs } = runAction('find-scripts', { scripts: 'lint build test' }, cwd);
	assert.equal(status, 0, stdout);
	assert.deepEqual(outputs, { lint: 'false', build: 'true', test: 'true' });
	assert.match(stdout, /::notice title=No lint script::package\.json has no "lint" script/);
	assert.doesNotMatch(stdout, /No build script/);
});

test('fails when a required script is missing', () => {
	const cwd = packageWithScripts({ build: 'vite build' });
	const { status, stdout } = runAction('find-scripts', { scripts: 'lint build', require: 'lint' }, cwd);
	assert.equal(status, 1);
	assert.match(stdout, /::error::package\.json has no "lint" script/);
});

test('fails without a package.json', () => {
	const { status, stdout } = runAction('find-scripts', { scripts: 'lint' });
	assert.equal(status, 1);
	assert.match(stdout, /::error::No package\.json in /);
});

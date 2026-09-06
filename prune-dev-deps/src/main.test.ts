import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAction, writeFiles } from '../../helpers/run-action.ts';

/** A dependency-free pnpm workspace with stray node_modules directories to prune. */
function workspace(): string {
	const cwd = mkdtempSync(join(tmpdir(), 'prune-dev-deps-'));
	writeFiles(cwd, {
		'package.json': JSON.stringify({ name: 'fixture', private: true }),
		'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
		'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
		'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
	});
	execFileSync('pnpm', ['install'], { cwd, stdio: 'pipe' });
	for (const dir of ['node_modules/left-over', 'packages/a/node_modules/x', 'packages/b/node_modules/y']) {
		mkdirSync(join(cwd, dir), { recursive: true });
		writeFileSync(join(cwd, dir, 'index.js'), '');
	}
	return cwd;
}

test('removes the listed directories, expanding globs, then reinstalls with --prod', () => {
	const cwd = workspace();
	const { status, stdout } = runAction('prune-dev-deps', { remove: 'node_modules packages/*/node_modules' }, cwd);
	assert.equal(status, 0, stdout);
	assert.ok(!existsSync(join(cwd, 'node_modules/left-over')), 'root node_modules was replaced');
	assert.ok(!existsSync(join(cwd, 'packages/a/node_modules')));
	assert.ok(!existsSync(join(cwd, 'packages/b/node_modules')));
	assert.match(stdout, /Removing .*packages\/a\/node_modules/);
	assert.match(stdout, /pnpm.*install --frozen-lockfile --prod/);
});

test('a pattern that matches nothing removes nothing', () => {
	const cwd = workspace();
	const { status, stdout } = runAction('prune-dev-deps', { remove: 'does-not-exist' }, cwd);
	assert.equal(status, 0, stdout);
	assert.doesNotMatch(stdout, /Removing/);
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAction, writeFiles } from '../../helpers/run-action.ts';

/** A pnpm workspace with one dependency-free package, so `pnpm deploy` needs no network. */
function workspace(): string {
	const cwd = mkdtempSync(join(tmpdir(), 'pnpm-deploy-'));
	writeFiles(cwd, {
		'package.json': JSON.stringify({ name: 'fixture', private: true }),
		'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
		'packages/server/package.json': JSON.stringify({ name: 'server', version: '1.0.0' }),
		'packages/server/index.js': "console.log('server')\n",
	});
	execFileSync('pnpm', ['install'], { cwd, stdio: 'pipe' });
	return cwd;
}

test('deploys each listed package to its output directory', () => {
	const cwd = workspace();
	const { status, stdout } = runAction('pnpm-deploy', { packages: './packages/server nonsymlink/server\n' }, cwd);
	assert.equal(status, 0, stdout);
	assert.ok(existsSync(join(cwd, 'nonsymlink/server/index.js')));
	assert.ok(existsSync(join(cwd, 'nonsymlink/server/package.json')));
});

test('fails on a line that is not a package and an output directory', () => {
	const { status, stdout } = runAction('pnpm-deploy', { packages: './packages/server\n' });
	assert.equal(status, 1);
	assert.match(stdout, /::error::expected "<package> <output-dir>", got: \.\/packages\/server/);
});

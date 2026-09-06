import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAction } from '../../helpers/run-action.ts';

function packageJson(contents: object): string {
	const cwd = mkdtempSync(join(tmpdir(), 'check-node-version-'));
	writeFileSync(join(cwd, 'package.json'), JSON.stringify(contents));
	return cwd;
}

test('passes when engines.node is declared', () => {
	const { status, stdout } = runAction('check-node-version', {}, packageJson({ engines: { node: '24.x' } }));
	assert.equal(status, 0, stdout);
	assert.match(stdout, /declares Node 24\.x/);
});

test('fails when engines.node is missing', () => {
	const { status, stdout } = runAction('check-node-version', {}, packageJson({ name: 'x' }));
	assert.equal(status, 1);
	assert.match(stdout, /::error::package\.json must declare the Node version in engines\.node/);
});

test('fails without a package.json', () => {
	const { status, stdout } = runAction('check-node-version');
	assert.equal(status, 1);
	assert.match(stdout, /::error::No package\.json in /);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAction } from '../../helpers/run-action.ts';

test('writes the lines verbatim with one trailing newline', () => {
	const { cwd, status, stdout } = runAction('write-env-file', {
		content: 'A=1\nB=x y\nC="quoted" $dollar\n\n',
		path: '.env',
	});
	assert.equal(status, 0, stdout);
	assert.equal(readFileSync(join(cwd, '.env'), 'utf8'), 'A=1\nB=x y\nC="quoted" $dollar\n');
	assert.match(stdout, /Wrote \.env with keys A, B, C/);
});

test('copies the file to each copy-to path, creating directories', () => {
	const { cwd, status } = runAction('write-env-file', {
		content: 'A=1',
		path: '.env',
		'copy-to': 'packages/nextjs/.env\npackages/server/.env .env',
	});
	assert.equal(status, 0);
	assert.equal(readFileSync(join(cwd, 'packages/nextjs/.env'), 'utf8'), 'A=1\n');
	assert.equal(readFileSync(join(cwd, 'packages/server/.env'), 'utf8'), 'A=1\n');
});

test('writes to a nested path', () => {
	const { cwd, status } = runAction('write-env-file', { content: 'A=1', path: 'xp-archive/.env' });
	assert.equal(status, 0);
	assert.equal(readFileSync(join(cwd, 'xp-archive/.env'), 'utf8'), 'A=1\n');
});

test('allows comments, blank lines, leading whitespace and export', () => {
	const { cwd, status, stdout } = runAction('write-env-file', {
		content: '# comment\n\n  A=1\nexport B=2\n',
		path: '.env',
	});
	assert.equal(status, 0, stdout);
	assert.equal(readFileSync(join(cwd, '.env'), 'utf8'), '# comment\n\n  A=1\nexport B=2\n');
	assert.match(stdout, /keys A, B/);
});

test('fails with the line number of a line that is not KEY=VALUE', () => {
	const { status, stdout } = runAction('write-env-file', {
		content: 'A=1\nB 2\nC=3',
		path: '.env',
	});
	assert.equal(status, 1);
	assert.match(stdout, /::error::line 2 is not KEY=VALUE: B 2/);
});

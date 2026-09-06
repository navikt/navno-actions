import * as core from '@actions/core';
import * as io from '@actions/io';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/;

/** The key of every KEY=VALUE line. Throws on a line that is none of KEY=VALUE, blank or a comment. */
function keysOf(content: string): string[] {
	const keys: string[] = [];
	content.split('\n').forEach((line, index) => {
		const match = KEY_LINE.exec(line);
		if (match) {
			keys.push(match[1]);
		} else if (line.trim() && !line.trimStart().startsWith('#')) {
			throw new Error(`line ${index + 1} is not KEY=VALUE: ${line}`);
		}
	});
	return keys;
}

async function run(): Promise<void> {
	try {
		// Trailing whitespace only: a `|` block scalar ends with a newline, and
		// the file should match a heredoc byte for byte.
		const content = core.getInput('content', { required: true, trimWhitespace: false }).trimEnd() + '\n';
		const copyTo = core.getInput('copy-to').split(/\s+/).filter(Boolean);
		const paths = [...new Set([core.getInput('path') || '.env', ...copyTo])];

		const keys = keysOf(content.trimEnd());
		for (const path of paths) {
			await io.mkdirP(dirname(path));
			await writeFile(path, content);
		}
		core.info(`Wrote ${paths.join(', ')} with keys ${keys.join(', ')}`);
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}

await run();

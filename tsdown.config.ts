import { globSync } from 'node:fs';
import { defineConfig, type UserConfig } from 'tsdown';

export default defineConfig(
	// One bundle per action.
	globSync('*/src/main.ts').map((entry): UserConfig => ({
		entry: { index: entry },
		outDir: entry.replace('src/main.ts', 'dist'),
		platform: 'node',
		format: 'esm',
		dts: false,
		// tsdown is smart about bundling deps/devDeps
		// but it's nice to avoid magic for future users who don't know about it
		deps: { alwaysBundle: /./, onlyImport: [], onlyBundle: false },
	})),
);

import { defineConfig } from 'oxfmt';

export default defineConfig({
	printWidth: 120,
	useTabs: true,
	tabWidth: 2,
	singleQuote: true,
	trailingComma: 'all',
	ignorePatterns: ['*/dist', 'pnpm-lock.yaml'],
});

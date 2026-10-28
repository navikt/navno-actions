// Run by navno-actions' CI through ./run-playwright. Not part of any action.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	forbidOnly: true,
	reporter: 'list',
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
	],
});

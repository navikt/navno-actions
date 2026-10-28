import { expect, test } from '@playwright/test';

test('runs in the Playwright image with the step environment', async ({ page, browser }) => {
	await page.setContent('<h1>run-playwright</h1>');
	await expect(page.getByRole('heading')).toHaveText('run-playwright');

	// The browsers come from the image, not from an install on the runner.
	expect(browser.browserType().executablePath()).toMatch(/^\/ms-playwright\//);

	// The caller's env, secrets included, reaches the container intact.
	expect(process.env.SMOKE_SECRET).toBe('two\nlines\n');
});

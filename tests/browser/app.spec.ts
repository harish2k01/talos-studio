import { test, expect } from '@playwright/test';
test('fleet, inspector, logs, configuration review and context switching', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.machine-card')).toHaveCount(6);
  await page.locator('.machine-card').filter({ hasText: 'worker-01' }).click();
  await page.getByRole('tab', { name: 'Services' }).click();
  await expect(page.locator('.service-row')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Logs' }).click();
  await expect(page.locator('.terminal pre')).toContainText('Demo kubelet logs');
  await page.getByRole('combobox', { name: 'Log service' }).selectOption('containerd');
  await expect(page.locator('.terminal pre')).toContainText('Demo containerd logs');
  await page.getByRole('tab', { name: 'Hardware' }).click();
  await page.locator('.hardware-sections details').first().locator('summary').click();
  await expect(page.locator('.hardware-sections pre').first()).toContainText('Example hardware');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Merge patch' })
    .fill('machine:\n  kubelet:\n    extraArgs: {max-pods: "120"}');
  await page.getByRole('button', { name: 'Review patch' }).click();
  await expect(page.getByRole('dialog')).toContainText('120');
  await expect(page.getByRole('dialog')).toContainText('Read-only session');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('combobox', { name: 'Talos context' }).selectOption('staging');
  await expect(page.locator('.machine-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('.machine-grid')).toHaveClass(/list-view/);
  await page.getByRole('combobox', { name: 'Talos context' }).selectOption('homelab');
  await expect(page.locator('.machine-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Card view' }).click();
  await page.getByRole('textbox', { name: 'Search machines' }).fill('worker-03');
  await expect(page.locator('.machine-card')).toHaveCount(1);
  await page.locator('.machine-card').click();
  await expect(page.getByRole('dialog')).toContainText('Live inspection unavailable');
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Search machines' }).fill('');
  if (process.env.UPDATE_SCREENSHOTS) {
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: 'docs/overview.png', fullPage: true });
  }
  expect(errors).toEqual([]);
});
test('mobile layout, theme and keyboard dialog controls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.locator('.machine-card')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.machine-card').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('ended log streams retain output and errors until explicitly refreshed', async ({ page }) => {
  await page.route('**/api/connection', async (route) => {
    const response = await route.fetch();
    const connection = await response.json();
    await route.fulfill({ response, json: { ...connection, demo: false } });
  });
  await page.route('**/api/logs/stream', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({ text: 'live stream output\n' }) +
        '\n' +
        JSON.stringify({ error: 'Stream limit reached; reconnect to continue' }) +
        '\n',
    }),
  );
  await page.goto('/');
  await expect(page.locator('.machine-card')).toHaveCount(6);
  await page.locator('.machine-card').filter({ hasText: 'worker-01' }).click();
  await page.getByRole('tab', { name: 'Logs' }).click();
  await expect(page.locator('.terminal pre')).toContainText('Demo kubelet logs');
  await page.getByRole('button', { name: 'Follow live', exact: true }).click();
  await expect(page.locator('.terminal pre')).toContainText('live stream output');
  await expect(page.locator('.terminal-header')).toContainText('STOPPED');
  await expect(page.getByRole('alert')).toContainText('Stream limit reached');
  await page.getByRole('button', { name: 'Reload log snapshot' }).click();
  await expect(page.locator('.terminal pre')).toContainText('Demo kubelet logs');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

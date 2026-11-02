import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(root, 'fixtures/sample-program.json');
const altFixture = path.join(root, 'fixtures/sample-program-alt.json');
const shots = '/opt/cursor/artifacts';

async function loadSample(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Load program' })).toBeVisible();
  await page.locator('#program-file').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
}

test('load program screen and file import', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Load program' })).toBeVisible();
  await expect(page.getByText('never uploaded')).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'screenshot_load_program_iphone.png'), scale: 'css' });
  await page.locator('#program-file').setInputFiles(fixture);
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
  await expect(page.getByText('Sample Focus A').first()).toBeVisible();
  await expect(page.locator('a.day-link[data-rest="true"]')).toHaveCount(1);
  await expect(page.locator('a.day-link[data-schedule="true"]')).toHaveCount(2);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'icons/apple-touch-icon.png');
  const shell = await page.evaluate(async () => {
    const css = await (await fetch('styles.css')).text();
    const manifest = await (await fetch('manifest.webmanifest')).json();
    return {
      safeArea: css.includes('safe-area-inset-top') && css.includes('safe-area-inset-bottom'),
      display: manifest.display,
      theme: manifest.theme_color,
    };
  });
  expect(shell).toEqual({ safeArea: true, display: 'standalone', theme: '#0c0e12' });
  expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173'))).toBe(true);
  await page.screenshot({ path: path.join(shots, 'screenshot_home_iphone.png'), scale: 'css' });
});

test('paste JSON loads the same sample', async ({ page }) => {
  await page.goto('/');
  await page.locator('#paste-json').fill(readFileSync(fixture, 'utf8'));
  await page.getByRole('button', { name: 'Load pasted JSON' }).click();
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
});

test('invalid JSON shows an error and does not leave the load screen', async ({ page }) => {
  await page.goto('/');
  await page.locator('#paste-json').fill('{');
  await page.getByRole('button', { name: 'Load pasted JSON' }).click();
  await expect(page.getByRole('alert')).toHaveText('That is not valid JSON.');
  await expect(page.locator('[data-screen="load"]')).toBeVisible();
});

test('logs sets, shows last time across sessions, and checks off a day', async ({ page }) => {
  await loadSample(page);
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(page.getByTestId('page-note')).toHaveText('Sample page note for day 1.');
  const first = page.locator('[data-exercise="sample exercise a"]');
  await expect(first.locator('.reps li')).toHaveText(['Set 1: 12-15', 'Set 2: 8-12', 'Set 3: 6x4 Cluster']);
  await expect(first).toContainText('Tempo 3-1-1-0');
  await expect(first).toContainText('Rest 90 sec');
  await expect(first).toContainText('Sample note only.');
  await expect(first.getByTestId('last-time')).toHaveText('No previous log');
  await expect(first.locator('input[data-field="weight"]').first()).toHaveAttribute('inputmode', 'decimal');
  await expect(first.locator('input[data-field="reps"]').first()).toHaveAttribute('inputmode', 'numeric');

  const second = page.locator('[data-exercise="sample exercise b"]');
  await expect(second.locator('.reps li')).toHaveText(['8-12']);
  await expect(second.locator('.rep-label')).toHaveText(['8-12', '8-12']);
  await expect(second.getByTestId('last-time')).toHaveText('No previous log');

  await first.locator('input[data-field="weight"]').nth(0).fill('100');
  await first.locator('input[data-field="reps"]').nth(0).fill('12');
  await first.locator('input[data-field="weight"]').nth(1).fill('95');
  await first.locator('input[data-field="reps"]').nth(1).fill('10');
  await expect(page.locator('#save-state')).toHaveText('Saved');
  await first.getByRole('button', { name: 'Increase weight, set 3, Sample Exercise A' }).click();
  await expect(first.locator('input[data-field="weight"]').nth(2)).toHaveValue('2.5');
  await first.getByRole('button', { name: 'Add set' }).click();
  await expect(first.locator('input[data-field="weight"]')).toHaveCount(4);

  await page.getByRole('button', { name: 'Mark day complete' }).click();
  await expect(page.getByRole('button', { name: 'Completed · Undo' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/#/day/1/2');
  await expect(page.getByTestId('footer-note')).toHaveText('Sample footer note.');
  const later = page.locator('[data-exercise="sample exercise a"]');
  await expect(later.getByTestId('last-time')).toContainText('Last time');
  await expect(later.getByTestId('last-time')).toHaveAttribute('data-date', /\d{4}-\d{2}-\d{2}/);
  await expect(later.getByTestId('prev-set').nth(0)).toContainText('100 lb × 12');
  await expect(later.getByTestId('prev-set').nth(1)).toContainText('95 lb × 10');
  await expect(later.locator('input[data-field="weight"]').nth(0)).toHaveAttribute('placeholder', '100');
  await expect(later.locator('input[data-field="reps"]').nth(0)).toHaveAttribute('placeholder', '12');
  await expect(later.locator('input[data-field="weight"]').nth(1)).toHaveValue('');
  await expect(later.locator('input[data-field="weight"]').nth(1)).toHaveAttribute('placeholder', '95');
  await later.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo(0, Math.max(0, top));
  });
  await page.screenshot({ path: path.join(shots, 'screenshot_day_last_time_iphone.png'), scale: 'css' });

  await later.locator('input[data-field="weight"]').nth(0).fill('110');
  await later.locator('input[data-field="reps"]').nth(0).fill('8');
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Week 1 Day 2: Sample Pull' })).toBeVisible();
  await expect(page.locator('a.day-link[data-week="1"][data-day="1"] .check.on')).toBeVisible();

  await page.goto('/#/day/1/1');
  await page.getByRole('button', { name: 'Completed · Undo' }).click();
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
  await expect(page.locator('a.day-link[data-week="1"][data-day="1"] .check.on')).toHaveCount(0);
});

test('rest days are visible and checkable, and next workout skips them', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/day/1/1');
  await page.getByRole('button', { name: 'Mark day complete' }).click();
  await page.goto('/#/day/1/2');
  await page.getByRole('button', { name: 'Mark day complete' }).click();
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Week 1 Day 4: Sample Legs' })).toBeVisible();

  await page.goto('/#/day/1/3');
  await expect(page.getByTestId('rest-text')).toContainText('Sample rest guidance line one.');
  await expect(page.getByTestId('rest-text')).toContainText('Sample rest guidance line two.');
  await page.getByRole('button', { name: 'Mark day complete' }).click();
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Week 1 Day 4: Sample Legs' })).toBeVisible();
  await expect(page.locator('a.day-link[data-week="1"][data-day="3"] .check.on')).toBeVisible();
});

test('week 13 schedule-only days and glossary show deload text', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/day/13/6');
  await expect(page.getByRole('heading', { name: 'Week 13 Day 6: Deload' })).toBeVisible();
  await expect(page.getByTestId('schedule-deload')).toContainText('Sample deload paragraph one.');
  await page.goto('/#/day/13/7');
  await expect(page.getByRole('heading', { name: 'Week 13 Day 7: Sample Sendoff' })).toBeVisible();
  await expect(page.getByTestId('schedule-deload')).toContainText('Sample deload paragraph two.');
  await page.goto('/#/deload');
  await expect(page.getByRole('heading', { name: 'Sample Deload' })).toBeVisible();
  await expect(page.getByText('Sample deload paragraph one.')).toBeVisible();
  await page.goto('/#/glossary');
  await expect(page.getByRole('heading', { name: 'Sample Term' })).toBeVisible();
  await expect(page.getByText('A fake glossary entry for tests.')).toBeVisible();
});

test('CSV and JSON backup round-trip', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/day/1/1');
  const card = page.locator('[data-exercise="sample exercise a"]');
  await card.locator('input[data-field="weight"]').nth(0).fill('100');
  await card.locator('input[data-field="reps"]').nth(0).fill('12');
  await card.locator('input[data-field="weight"]').nth(1).fill('95');
  await card.locator('input[data-field="reps"]').nth(1).fill('10');
  await page.getByRole('button', { name: 'Mark day complete' }).click();
  const loggedDate = await page.locator('input[type="date"]').inputValue();

  await page.goto('/#/settings');
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  const csv = readFileSync(await csvDownload.path(), 'utf8');
  const lines = csv.trimEnd().split('\n');
  expect(lines[0]).toBe('date,week,day,workout,exercise,set,weight,reps,completed_day');
  expect(lines).toContain(`${loggedDate},1,1,Sample Push,Sample Exercise A,1,100,12,true`);
  expect(lines).toContain(`${loggedDate},1,1,Sample Push,Sample Exercise A,2,95,10,true`);

  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const backupPath = await jsonDownload.path();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Load program' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#backup-file').setInputFiles(backupPath);
  await expect(page.locator('a.day-link[data-week="1"][data-day="1"]')).toHaveAttribute('aria-label', /completed/);
  await page.goto('/#/day/1/1');
  await expect(page.locator('[data-exercise="sample exercise a"] input[data-field="weight"]').nth(0)).toHaveValue('100');
  await expect(page.getByRole('button', { name: 'Completed · Undo' })).toBeVisible();
});

test('replace program keeps logs for the same exercise', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/day/1/1');
  await page.locator('[data-exercise="sample exercise a"] input[data-field="weight"]').nth(0).fill('80');
  await page.goto('/#/settings');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#program-file').setInputFiles(altFixture);
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Swap' })).toBeVisible();
  await page.goto('/#/day/1/1');
  await expect(page.locator('[data-exercise="sample exercise a"] input[data-field="weight"]').nth(0)).toHaveValue('80');
});

test('offline reload uses the cached app shell', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!await page.evaluate(() => navigator.serviceWorker.controller)) {
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  }
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.locator('#program-file').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start' })).toBeVisible();
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(12, 14, 18)');
});

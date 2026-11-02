import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptProgram } from './encrypt.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(root, 'fixtures/sample-program.json');
const altFixture = path.join(root, 'fixtures/sample-program-alt.json');
const sample = JSON.parse(readFileSync(fixture, 'utf8'));
const shots = '/opt/cursor/artifacts';

async function fulfillProgram(page, program = sample) {
  const packed = await encryptProgram(program);
  await page.context().route('**/program.enc.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(packed.enc),
  }));
  return packed;
}

async function openEncrypted(page, program = sample) {
  const packed = await fulfillProgram(page, program);
  await page.addInitScript((envelope) => {
    window.__LIFTLOG_ENVELOPE__ = envelope;
  }, packed.enc);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`/#k=${packed.key}`);
  await expect(page.getByRole('heading', { name: program.days[0].titlePrinted })).toBeVisible();
  expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173') && !url.includes(packed.key))).toBe(true);
  return { ...packed, requests };
}

test('personal link decrypts the program and opens the next workout', async ({ page }) => {
  await openEncrypted(page);
  await expect(page.locator('[data-screen="day"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Load program' })).toHaveCount(0);
  await expect(page.locator('[data-screen="day"] #program-file')).toHaveCount(0);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'icons/apple-touch-icon.png');
  const shell = await page.evaluate(async () => {
    const css = await (await fetch('styles.css')).text();
    const manifest = await (await fetch('manifest.webmanifest')).json();
    const step = document.querySelector('.step');
    return {
      safeArea: css.includes('safe-area-inset-top') && css.includes('safe-area-inset-bottom'),
      motion: css.includes('prefers-reduced-motion'),
      dynamicType: css.includes('-apple-system-body'),
      minTarget: step ? parseFloat(getComputedStyle(step).minHeight) : 0,
      display: manifest.display,
      theme: manifest.theme_color,
      standalone: document.documentElement.dataset.standalone,
    };
  });
  expect(shell.safeArea).toBe(true);
  expect(shell.motion).toBe(true);
  expect(shell.dynamicType).toBe(true);
  expect(shell.minTarget).toBeGreaterThanOrEqual(44);
  expect(shell.display).toBe('standalone');
  expect(shell.theme).toBe('#f2f2f7');
  await page.goto('/#/program');
  await expect(page.locator('a.day-link[data-rest="true"]')).toHaveCount(1);
  await expect(page.locator('a.day-link[data-schedule="true"]')).toHaveCount(2);
  await expect(page.getByTestId('next-workout')).toContainText('Week 1 Day 1: Sample Push');
});

test('a bad key shows one calm error', async ({ page }) => {
  await page.goto(`/#k=${'A'.repeat(43)}`);
  await expect(page.getByRole('alert')).toHaveText("This link didn't unlock the program.");
  await expect(page.locator('[data-screen="empty"]')).toBeVisible();
  await expect(page.locator('#program-file')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Lift Log' })).toBeVisible();
});

test.describe('without a service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('the personal link fetches program.enc.json and decrypts it', async ({ page }) => {
    const { key, enc } = await encryptProgram(sample);
    const urls = [];
    page.on('request', (request) => urls.push(request.url()));
    await page.route('**/program.enc.json', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(enc),
    }));
    await page.goto(`/#k=${key}`);
    await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
    expect(urls.some((url) => url.includes('/program.enc.json'))).toBe(true);
    expect(urls.every((url) => !url.includes(key))).toBe(true);
  });

  test('a failed download shows one calm error', async ({ page }) => {
    await page.route('**/program.enc.json', (route) => route.abort());
    await page.goto(`/#k=${'B'.repeat(43)}`);
    await expect(page.getByRole('alert')).toHaveText(/could not be downloaded/i);
    await expect(page.locator('[data-screen="empty"]')).toBeVisible();
    await expect(page.locator('#program-file')).toHaveCount(0);
  });
});

test('fresh standalone storage launched at start_url has the program', async ({ page, browser }) => {
  const { key, enc } = await openEncrypted(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  expect(manifest.start_url).toContain(`#k=${key}`);
  expect(manifest.start_url.includes('?')).toBe(false);
  expect(manifest.id).toBe('./');

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    const native = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (String(query).includes('display-mode') && String(query).includes('standalone')) {
        return {
          matches: true,
          media: String(query),
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
        };
      }
      return native(query);
    };
  });
  await context.addInitScript((envelope) => {
    window.__LIFTLOG_ENVELOPE__ = envelope;
  }, enc);
  const fresh = await context.newPage();
  const urls = [];
  fresh.on('request', (request) => urls.push(request.url()));
  await context.route('**/program.enc.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(enc),
  }));
  const start = manifest.start_url.replace(/^\.\//, '');
  await fresh.goto(`/${start}`);
  await expect(fresh.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
  expect(await fresh.evaluate(() => document.documentElement.dataset.standalone)).toBe('true');
  const stored = await fresh.evaluate(() => localStorage.getItem('liftlog.program.v1'));
  expect(stored).toContain('Sample Exercise A');
  expect(urls.every((url) => !url.includes(key))).toBe(true);
  await context.setOffline(true);
  await fresh.reload();
  await expect(fresh.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
  await context.close();
});

test('advanced file and paste still load a program', async ({ page }) => {
  await page.goto('/#/settings');
  await page.locator('[data-testid="advanced"] summary').click();
  await page.locator('#paste-json').fill(readFileSync(fixture, 'utf8'));
  await page.getByRole('button', { name: 'Load pasted JSON' }).click();
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.goto('/#/settings');
  await page.locator('[data-testid="advanced"] summary').click();
  await page.locator('#paste-json').fill('{');
  await page.getByRole('button', { name: 'Load pasted JSON' }).click();
  await expect(page.getByRole('alert')).toHaveText('That is not valid JSON.');
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();

  await page.locator('[data-testid="advanced"] summary').click();
  await page.locator('#program-file').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
});

test('logs sets, shows last time, and checks off a day', async ({ page }) => {
  await openEncrypted(page);
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
  await later.getByRole('button', { name: 'Same as last time, sample exercise a' }).click();
  await expect(later.locator('input[data-field="weight"]').nth(0)).toHaveValue('100');
  await expect(later.locator('input[data-field="reps"]').nth(0)).toHaveValue('12');
  await expect(later.locator('input[data-field="weight"]').nth(1)).toHaveValue('95');

  await page.goto('/#/program');
  await expect(page.getByRole('heading', { name: 'Week 1 Day 2: Sample Pull' })).toBeVisible();
  await expect(page.locator('a.day-link[data-week="1"][data-day="1"] .check.on')).toBeVisible();
  await page.goto('/#/day/1/1');
  await page.getByRole('button', { name: 'Completed · Undo' }).click();
  await page.goto('/#/program');
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
  await expect(page.locator('a.day-link[data-week="1"][data-day="1"] .check.on')).toHaveCount(0);
});

test('optional day flag is a list marker and a note under the title', async ({ page }) => {
  await openEncrypted(page);
  await page.goto('/#/program');
  const flagged = page.locator('a.day-link[data-week="1"][data-day="4"]');
  const plain = page.locator('a.day-link[data-week="1"][data-day="1"]');
  await expect(flagged).toHaveAttribute('data-flag', 'true');
  await expect(flagged.getByTestId('flag-mark')).toHaveText('!');
  await expect(plain).toHaveAttribute('data-flag', 'false');
  await expect(plain.getByTestId('flag-mark')).toHaveCount(0);
  await page.goto('/#/day/1/4');
  const note = page.getByTestId('day-flag');
  await expect(note).toHaveText('Sample flag: fake warning note.');
  const underTitle = await note.evaluate((element) => {
    const title = document.getElementById('day-title');
    return Boolean(title && title.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(underTitle).toBe(true);
  await page.goto('/#/day/1/1');
  await expect(page.getByTestId('day-flag')).toHaveCount(0);
});

test('rest days are optional and an out-of-order workout is not missed', async ({ page }) => {
  await openEncrypted(page);
  await page.goto('/#/day/1/4');
  await page.locator('[data-exercise="sample exercise c"] input[data-field="weight"]').fill('200');
  await page.goto('/#/program');
  await expect(page.getByTestId('next-workout')).toContainText('Week 1 Day 1: Sample Push');
  await expect(page.locator('a.day-link[data-week="1"][data-day="4"]')).toContainText('In progress');
  await expect(page.locator('a.day-link[data-week="1"][data-day="3"]')).toContainText('Rest');
  await expect(page.locator('[data-screen="home"]')).not.toContainText(/missed|overdue|behind|streak/i);

  await page.goto('/#/day/1/1');
  await page.getByRole('button', { name: 'Mark day complete' }).click();
  await page.goto('/#/day/1/2');
  await page.getByRole('button', { name: 'Mark day complete' }).click();
  await page.goto('/#/program');
  await expect(page.getByTestId('next-workout')).toContainText('Week 1 Day 4: Sample Legs');
  await expect(page.locator('a.day-link[data-week="1"][data-day="3"] .check.on')).toHaveCount(0);
  await expect(page.locator('[data-screen="home"]')).not.toContainText(/missed|overdue|behind|streak/i);

  await page.goto('/#/day/1/3');
  await expect(page.getByTestId('rest-text')).toContainText('Sample rest guidance line one.');
  await expect(page.getByTestId('rest-text')).toContainText('Sample rest guidance line two.');
  await page.getByRole('button', { name: 'Mark day complete' }).click();
  await page.goto('/#/program');
  await expect(page.getByTestId('next-workout')).toContainText('Week 1 Day 4: Sample Legs');
});

test('a back-dated session and an edited date reorder last time', async ({ page }) => {
  await openEncrypted(page);
  const first = page.locator('[data-exercise="sample exercise a"]');
  await first.locator('input[data-field="weight"]').nth(0).fill('100');
  await first.locator('input[data-field="reps"]').nth(0).fill('12');
  await page.locator('input[type="date"]').fill('2026-11-02');
  await page.goto('/#/day/1/2');
  const later = page.locator('[data-exercise="sample exercise a"]');
  await later.locator('input[data-field="weight"]').nth(0).fill('110');
  await later.locator('input[data-field="reps"]').nth(0).fill('8');
  await page.locator('input[type="date"]').fill('2026-11-03');
  await expect(later.getByTestId('last-time')).toHaveAttribute('data-date', '2026-11-02');
  await expect(later.getByTestId('prev-set').first()).toContainText('100 lb × 12');

  await page.locator('input[type="date"]').fill('2026-11-01');
  await expect(later.getByTestId('last-time')).toHaveText('No previous log');
  await page.goto('/#/day/1/1');
  await expect(page.locator('[data-exercise="sample exercise a"]').getByTestId('last-time')).toHaveAttribute('data-date', '2026-11-01');
  await expect(page.locator('[data-exercise="sample exercise a"]').getByTestId('prev-set').first()).toContainText('110 lb × 8');
});

test('week 13 schedule-only days and glossary show deload text', async ({ page }) => {
  await openEncrypted(page);
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

test('notes show warm-ups, swaps, drop sets, and supersets', async ({ page }) => {
  const program = {
    source: 'FAKE SAMPLE',
    schedule: [],
    days: [{
      week: 1,
      day: 1,
      dayOfWeek: 'Monday',
      workout: 'Sample Push',
      titlePrinted: 'Week 1 Day 1: Notes',
      isRest: false,
      exercises: [
        { name: 'Warm Up Move', sets: 2, reps: ['10'], tempo: null, rest: '60 sec', notes: 'Warm Up - Not Done To Failure' },
        { name: 'Main Move', sets: 2, reps: ['8-10'], tempo: null, rest: '2 min', notes: 'Can Substitute W/ Other Move' },
        { name: 'Drop Move', sets: 2, reps: ['12'], tempo: null, rest: '90 sec', notes: 'Lower Weight 25% No Rest, Immediately Into Next Set (Drop Set)' },
        { name: 'Super A', sets: 1, reps: ['10'], tempo: null, rest: null, notes: 'Superset with Super B' },
        { name: 'Super B', sets: 1, reps: ['10'], tempo: null, rest: '2 min', notes: 'Superset. Rest after both.' },
      ],
    }],
    deload: { title: 'Deload', paragraphs: ['Rest.'] },
    glossary: [],
  };
  await openEncrypted(page, program);
  await expect(page.locator('[data-exercise="warm up move"]')).toContainText('Warm-up');
  await expect(page.getByRole('button', { name: 'Swap Main Move' })).toBeVisible();
  await expect(page.locator('[data-exercise="drop move"]')).toContainText('Drop set');
  await expect(page.locator('[data-exercise="drop move"]')).toContainText('Set 2 · Drop');
  await expect(page.getByRole('region', { name: 'Superset' })).toBeVisible();
  await page.locator('[data-exercise="warm up move"] input[data-field="weight"]').first().fill('300');
  await page.locator('[data-exercise="warm up move"] input[data-field="reps"]').first().fill('5');
  await page.locator('[data-exercise="main move"] input[data-field="weight"]').first().fill('100');
  await page.locator('[data-exercise="main move"] input[data-field="reps"]').first().fill('8');
  await page.getByRole('button', { name: 'History for Warm Up Move' }).click();
  await expect(page.getByTestId('history-sheet')).toContainText('Warm-up sets stay out of PRs.');
  await expect(page.getByTestId('history-sheet')).not.toContainText('300');
  await page.getByTestId('history-sheet').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'History for Main Move' }).click();
  await expect(page.getByTestId('history-sheet')).toContainText('100');
  await expect(page.getByTestId('history-sheet')).toContainText('Est. 1RM');
});

test('CSV and JSON backup round-trip, and the backup omits the key', async ({ page }) => {
  const { key } = await openEncrypted(page);
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
  const backupText = readFileSync(backupPath, 'utf8');
  expect(backupText.includes(key)).toBe(false);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.goto('/#/settings');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#backup-file').setInputFiles(backupPath);
  await expect(page.getByRole('heading', { name: /Week 1 Day/ })).toBeVisible();
  await page.goto('/#/program');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.locator('a.day-link[data-week="1"][data-day="1"]')).toHaveAttribute('aria-label', /completed/);
  await page.goto('/#/day/1/1');
  await expect(page.locator('[data-exercise="sample exercise a"] input[data-field="weight"]').nth(0)).toHaveValue('100');
  await expect(page.getByRole('button', { name: 'Completed · Undo' })).toBeVisible();
});

test('replace program keeps logs for the same exercise', async ({ page }) => {
  await openEncrypted(page);
  await page.locator('[data-exercise="sample exercise a"] input[data-field="weight"]').nth(0).fill('80');
  await page.goto('/#/settings');
  await page.locator('[data-testid="advanced"] summary').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#program-file').setInputFiles(altFixture);
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Swap' })).toBeVisible();
  await page.goto('/#/day/1/1');
  await expect(page.locator('[data-exercise="sample exercise a"] input[data-field="weight"]').nth(0)).toHaveValue('80');
});

test('v1 logs stored on the phone survive the upgrade', async ({ page }) => {
  const logs = {
    sessions: {
      '1-1': {
        week: 1,
        day: 1,
        date: '2026-10-01',
        startedAt: 10,
        completed: true,
        exercises: {
          'sample exercise a': {
            name: 'Sample Exercise A',
            sets: [{ weight: '100', reps: '12' }, { weight: '95', reps: '10' }],
          },
        },
      },
    },
  };
  await page.addInitScript((payload) => {
    localStorage.setItem('liftlog.program.v1', JSON.stringify(payload.program));
    localStorage.setItem('liftlog.logs.v1', JSON.stringify(payload.stored));
  }, { program: sample, stored: logs });
  await page.goto('/#/day/1/2');
  const later = page.locator('[data-exercise="sample exercise a"]');
  await expect(later.getByTestId('last-time')).toContainText('Last time');
  await expect(later.getByTestId('last-time')).toHaveAttribute('data-date', '2026-10-01');
  await expect(later.getByTestId('prev-set').first()).toContainText('100 lb × 12');
  await page.goto('/#/settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const backup = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(backup.logs.sessions['1-1'].exercises['sample exercise a'].sets[0].weight).toBe('100');
  expect(backup.logs.sessions['1-1'].exercises['sample exercise a'].sets[1].reps).toBe('10');
});

test('offline reload uses the cached app shell', async ({ page, context }) => {
  await openEncrypted(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Week 1 Day 1: Sample Push' })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(0, 0, 0)');
});

test('iphone screenshots in light and dark', async ({ page }) => {
  test.setTimeout(90_000);
  await openEncrypted(page);
  const card = page.locator('[data-exercise="sample exercise a"]');
  await card.locator('input[data-field="weight"]').nth(0).fill('185');
  await card.locator('input[data-field="reps"]').nth(0).fill('6');
  await card.locator('input[data-field="weight"]').nth(1).fill('175');
  await card.locator('input[data-field="reps"]').nth(1).fill('8');
  await page.getByRole('button', { name: 'Plates' }).first().click();
  await expect(page.locator('.plate').nth(0)).toHaveText('45');
  await expect(page.locator('.plate').nth(1)).toHaveText('25');
  await page.getByTestId('plates-sheet').getByRole('button', { name: 'Done' }).click();

  await page.goto('/#/program');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: path.join(shots, 'screenshot_home_light_iphone.png'), scale: 'css' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(shots, 'screenshot_home_dark_iphone.png'), scale: 'css' });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/day/1/2');
  await expect(page.locator('[data-exercise="sample exercise a"]').getByTestId('last-time')).toContainText('Last time');
  await page.screenshot({ path: path.join(shots, 'screenshot_workout_light_iphone.png'), scale: 'css' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(shots, 'screenshot_workout_dark_iphone.png'), scale: 'css' });

  const later = page.locator('[data-exercise="sample exercise a"]');
  await later.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: path.join(shots, 'screenshot_logging_light_iphone.png'), scale: 'css' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(shots, 'screenshot_logging_dark_iphone.png'), scale: 'css' });

  await page.emulateMedia({ colorScheme: 'light' });
  await later.getByRole('button', { name: 'History for sample exercise a' }).click();
  await expect(page.getByTestId('history-sheet')).toContainText('185');
  await page.screenshot({ path: path.join(shots, 'screenshot_history_light_iphone.png'), scale: 'css' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(shots, 'screenshot_history_dark_iphone.png'), scale: 'css' });
  await page.getByTestId('history-sheet').getByRole('button', { name: 'Done' }).click();

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/day/1/1');
  await page.getByRole('button', { name: 'Mark set 1 done, Sample Exercise A' }).click();
  await expect(page.getByTestId('rest-timer')).toContainText('1:30');
  await page.screenshot({ path: path.join(shots, 'screenshot_timer_light_iphone.png'), scale: 'css' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(shots, 'screenshot_timer_dark_iphone.png'), scale: 'css' });
});

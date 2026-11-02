import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const programPath = process.env.PROGRAM_JSON;

test.describe('private program file', () => {
  test.skip(!programPath, 'PROGRAM_JSON is not set');

  test('loads the private file without logging its text', async ({ page }) => {
    const program = JSON.parse(readFileSync(programPath, 'utf8'));
    const repeats = new Map();
    let rangeCase = null;
    let noteCase = null;
    let footerCase = null;
    for (const day of program.days) {
      if (day.pageNote && !noteCase) noteCase = { week: day.week, day: day.day };
      if (day.footerNote && !footerCase) footerCase = { week: day.week, day: day.day };
      if (day.isRest) continue;
      day.exercises.forEach((exercise, index) => {
        const reps = Array.isArray(exercise.reps) ? exercise.reps : [];
        if (!rangeCase && reps.length === 1 && exercise.sets > 1) {
          rangeCase = { week: day.week, day: day.day, index, count: exercise.sets };
        }
        const key = String(exercise.name).trim().toLowerCase().replace(/\s+/g, ' ');
        if (!repeats.has(key)) repeats.set(key, []);
        repeats.get(key).push({ week: day.week, day: day.day, index });
      });
    }
    const pair = [...repeats.values()].map((list) => {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const after = list[j].week > list[i].week
            || (list[j].week === list[i].week && list[j].day > list[i].day);
          if (after) return [list[i], list[j]];
        }
      }
      return null;
    }).find(Boolean);
    expect(pair).toBeTruthy();
    const [earlier, later] = pair;

    await page.goto('/#/settings');
    await page.locator('[data-testid="advanced"] summary').click();
    await page.locator('#program-file').setInputFiles(programPath);
    await expect(page.locator('[data-screen="day"]')).toBeVisible();
    await page.goto('/#/program');
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await expect(page.locator('a.day-link')).toHaveCount(91);
    const summary = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a.day-link')];
      const title = document.querySelector('[data-testid="next-workout"] h2')?.textContent || '';
      return {
        count: links.length,
        rest: links.filter((link) => link.dataset.rest === 'true').length,
        schedule: links.filter((link) => link.dataset.schedule === 'true').length,
        week13: links
          .filter((link) => link.dataset.week === '13' && link.dataset.schedule === 'true')
          .map((link) => link.dataset.day)
          .sort(),
        nextIsFirst: title.startsWith('Week 1 Day 1'),
        firstRest: links.find((link) => link.dataset.rest === 'true')
          ? {
            week: links.find((link) => link.dataset.rest === 'true').dataset.week,
            day: links.find((link) => link.dataset.rest === 'true').dataset.day,
          }
          : null,
      };
    });
    expect(summary).toMatchObject({
      count: 91,
      rest: 35,
      schedule: 2,
      week13: ['6', '7'],
      nextIsFirst: true,
    });

    await page.goto(`/#/day/${summary.firstRest.week}/${summary.firstRest.day}`);
    const restLength = await page.evaluate(() => document.querySelector('[data-testid="rest-text"]')?.innerText.length || 0);
    expect(restLength).toBeGreaterThan(20);
    await page.getByRole('button', { name: 'Mark day complete' }).click();
    await page.goto('/#/program');
    const stillFirst = await page.evaluate(() => (
      document.querySelector('[data-testid="next-workout"] h2')?.textContent || ''
    ).startsWith('Week 1 Day 1'));
    expect(stillFirst).toBe(true);

    await page.goto(`/#/day/${noteCase.week}/${noteCase.day}`);
    const noteLength = await page.evaluate(() => document.querySelector('[data-testid="page-note"]')?.innerText.length || 0);
    expect(noteLength).toBeGreaterThan(10);
    await page.goto(`/#/day/${footerCase.week}/${footerCase.day}`);
    const footerLength = await page.evaluate(() => document.querySelector('[data-testid="footer-note"]')?.innerText.length || 0);
    expect(footerLength).toBeGreaterThan(0);

    await page.goto(`/#/day/${rangeCase.week}/${rangeCase.day}`);
    const repeated = await page.evaluate(({ index, count }) => {
      const card = document.querySelectorAll('article.exercise')[index];
      const labels = [...card.querySelectorAll('.rep-label')].map((node) => node.textContent);
      return labels.length === count && labels.every((label) => label && label === labels[0]);
    }, rangeCase);
    expect(repeated).toBe(true);

    await page.goto(`/#/day/${earlier.week}/${earlier.day}`);
    const card = page.locator('article.exercise').nth(earlier.index);
    await card.locator('input[data-field="weight"]').first().fill('101');
    await card.locator('input[data-field="reps"]').first().fill('9');
    await page.goto(`/#/day/${later.week}/${later.day}`);
    const matched = await page.evaluate((index) => {
      const laterCard = document.querySelectorAll('article.exercise')[index];
      const banner = laterCard?.querySelector('[data-testid="last-time"]')?.textContent || '';
      const previous = laterCard?.querySelector('[data-testid="prev-set"]')?.textContent || '';
      return banner.includes('Last time') && previous.includes('101') && previous.includes('9');
    }, later.index);
    expect(matched).toBe(true);

    await page.goto('/#/day/13/6');
    const saturday = await page.evaluate(() => document.querySelector('[data-testid="schedule-deload"]')?.innerText.length || 0);
    await page.goto('/#/day/13/7');
    const sunday = await page.evaluate(() => document.querySelector('[data-testid="schedule-deload"]')?.innerText.length || 0);
    expect(saturday).toBeGreaterThan(80);
    expect(sunday).toBeGreaterThan(80);

    await page.goto('/#/glossary');
    const glossary = await page.locator('[data-screen="glossary"] article').count();
    expect(glossary).toBeGreaterThan(0);
  });
});

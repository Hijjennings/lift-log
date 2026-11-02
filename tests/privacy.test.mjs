import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'path';

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === 'test-results' || name === 'playwright-report') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

test('the repo has no plaintext program file', () => {
  const files = walk(new URL('..', import.meta.url).pathname);
  const names = files.map((file) => file.split('/').pop());
  assert.equal(names.includes('program.json'), false);
  const siteJson = files.filter((file) => file.includes('/site/') && file.endsWith('.json'));
  assert.deepEqual(siteJson.map((file) => file.split('/').pop()), ['program.enc.json']);
});

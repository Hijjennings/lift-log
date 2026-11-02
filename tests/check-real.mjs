/**
 * Local-only shape check for a private program.json.
 * Never prints program text. Skips when PROGRAM_JSON is unset.
 *
 *   PROGRAM_JSON=/path/to/program.json node tests/check-real.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildEntries,
  deloadView,
  emptyLogs,
  findPrevious,
  isRestEntry,
  nextUp,
  normalizeName,
  prescribedSets,
  repForSet,
  repsArray,
  setLoggedSet,
  validateProgram,
} from '../site/model.js';

const path = process.env.PROGRAM_JSON;
if (!path) {
  console.log('SKIP check-real (set PROGRAM_JSON to a local program file)');
  process.exit(0);
}

const program = JSON.parse(readFileSync(path, 'utf8'));
validateProgram(program);
const entries = buildEntries(program);
const days = entries.filter((entry) => entry.source === 'day');
const rest = days.filter((entry) => isRestEntry(entry));
const scheduleOnly = entries.filter((entry) => entry.source === 'schedule');
assert.equal(days.length, 89, 'day count');
assert.equal(rest.length, 35, 'rest count');
assert.equal(scheduleOnly.length, 2, 'schedule-only count');
const week13 = scheduleOnly.filter((entry) => entry.week === 13).map((entry) => entry.day).sort();
assert.deepEqual(week13, [6, 7], 'week 13 schedule-only days');
const first = nextUp(entries, emptyLogs());
assert.equal(isRestEntry(first), false, 'next workout is not rest');
assert.equal(first.week, 1);
assert.equal(first.day, 1);
assert.ok(deloadView(program).blocks.length > 0, 'deload text');
assert.ok(days.some((entry) => entry.record.pageNote), 'page notes exist');
assert.ok(days.some((entry) => entry.record.footerNote), 'footer notes exist');
assert.ok(rest.every((entry) => Array.isArray(entry.record.restText) && entry.record.exercises.length === 0));

let repeatedRange = 0;
const byName = new Map();
for (const entry of days) {
  if (entry.record.isRest) continue;
  entry.record.exercises.forEach((exercise, index) => {
    const reps = repsArray(exercise);
    if (reps.length === 1 && prescribedSets(exercise) > reps.length) {
      repeatedRange += 1;
      assert.equal(repForSet(exercise, 0), repForSet(exercise, prescribedSets(exercise) - 1));
    }
    const key = normalizeName(exercise.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ entry, index });
  });
}
assert.ok(repeatedRange > 0, 'sets can exceed a single rep range');
const pair = [...byName.values()].find((list) => list.length >= 2);
assert.ok(pair, 'an exercise repeats on a later day');
const [earlier, later] = pair;
const logs = emptyLogs();
const earlierName = earlier.entry.record.exercises[earlier.index].name;
const laterName = later.entry.record.exercises[later.index].name;
setLoggedSet(logs, earlier.entry, earlierName, 0, 'weight', '101', 1_000);
setLoggedSet(logs, earlier.entry, earlierName, 0, 'reps', '9', 1_000);
const previous = findPrevious(logs, later.entry, laterName);
assert.equal(previous?.sets?.[0]?.weight, '101');
assert.equal(previous?.sets?.[0]?.reps, '9');
assert.equal(findPrevious(logs, earlier.entry, earlierName), null);

console.log(`PASS check-real days=${days.length} rest=${rest.length} scheduleOnly=${scheduleOnly.length} repeatedRanges=${repeatedRange}`);

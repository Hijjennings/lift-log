import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  addEmptySet,
  buildCsv,
  buildEntries,
  emptyLogs,
  findPrevious,
  isoDate,
  nextUp,
  normalizeName,
  prescribedSets,
  repForSet,
  setCompleted,
  setLoggedSet,
  validateProgram,
} from '../site/model.js';

const sample = JSON.parse(readFileSync(new URL('./fixtures/sample-program.json', import.meta.url), 'utf8'));

test('sample program validates and keeps schedule-only days', () => {
  validateProgram(sample);
  const entries = buildEntries(sample);
  assert.equal(entries.length, 6);
  const saturday = entries.find((entry) => entry.week === 13 && entry.day === 6);
  const sunday = entries.find((entry) => entry.week === 13 && entry.day === 7);
  assert.equal(saturday.source, 'schedule');
  assert.equal(sunday.source, 'schedule');
  assert.equal(entries.filter((entry) => entry.source === 'day' && entry.record.isRest).length, 1);
});

test('next workout skips rest days', () => {
  const entries = buildEntries(sample);
  const logs = emptyLogs();
  assert.equal(nextUp(entries, logs).day, 1);
  setCompleted(logs, entries[0], true, 1_000);
  setCompleted(logs, entries[1], true, 2_000);
  assert.equal(nextUp(entries, logs).day, 4);
  assert.equal(nextUp(entries, logs).dayOfWeek, 'Thursday');
});

test('single rep range is repeated when sets exceed reps.length', () => {
  const exercise = sample.days[0].exercises[1];
  assert.equal(prescribedSets(exercise), 2);
  assert.equal(repForSet(exercise, 0), '8-12');
  assert.equal(repForSet(exercise, 1), '8-12');
  assert.equal(repForSet(sample.days[0].exercises[0], 2), 'Set 3: 6x4 Cluster');
});

test('last time matches normalized names from the most recent earlier session', () => {
  const entries = buildEntries(sample);
  const logs = emptyLogs();
  const monday = entries[0];
  const tuesday = entries[1];
  setLoggedSet(logs, monday, 'Sample Exercise A', 0, 'weight', '100', 1_000);
  setLoggedSet(logs, monday, 'Sample Exercise A', 0, 'reps', '12', 1_000);
  setLoggedSet(logs, monday, 'Sample Exercise A', 1, 'weight', '95', 1_000);
  setLoggedSet(logs, monday, 'Sample Exercise A', 1, 'reps', '10', 1_000);
  const previous = findPrevious(logs, tuesday, '  SAMPLE   exercise a ');
  assert.equal(normalizeName('  SAMPLE   exercise a '), 'sample exercise a');
  assert.equal(previous.date, isoDate(new Date(1_000)));
  assert.equal(previous.sets[0].weight, '100');
  assert.equal(previous.sets[0].reps, '12');
  assert.equal(previous.sets[1].weight, '95');
  assert.equal(previous.sets[1].reps, '10');
  assert.equal(findPrevious(logs, monday, 'Sample Exercise A'), null);

  setLoggedSet(logs, tuesday, 'sample exercise a', 0, 'weight', '110', 5_000);
  setLoggedSet(logs, tuesday, 'sample exercise a', 0, 'reps', '8', 5_000);
  const afterTuesday = findPrevious(logs, { week: 2, day: 1 }, 'Sample Exercise A');
  assert.equal(afterTuesday.sets[0].weight, '110');
  assert.equal(afterTuesday.week, 1);
  assert.equal(afterTuesday.day, 2);
});

test('csv export uses the required columns and quotes commas', () => {
  const entries = buildEntries(sample);
  const logs = emptyLogs();
  setLoggedSet(logs, entries[0], 'Sample, Exercise A', 0, 'weight', '100', Date.UTC(2026, 10, 2, 15));
  setLoggedSet(logs, entries[0], 'Sample, Exercise A', 0, 'reps', '12', Date.UTC(2026, 10, 2, 15));
  setCompleted(logs, entries[0], true, Date.UTC(2026, 10, 2, 16));
  const csv = buildCsv(entries, logs);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], 'date,week,day,workout,exercise,set,weight,reps,completed_day');
  assert.match(lines[1], /^[^,]+,1,1,Sample Push,"Sample, Exercise A",1,100,12,true$/);
  assert.equal(csv.endsWith('\n'), true);
});

test('extra set is stored past the prescribed count', () => {
  const logs = emptyLogs();
  const entry = buildEntries(sample)[0];
  const count = addEmptySet(logs, entry, 'Sample Exercise A', 3);
  assert.equal(count, 4);
});

test('validation rejects a program with no days and tolerates extra fields', () => {
  assert.throws(() => validateProgram({ days: [] }), /no days/);
  assert.throws(() => validateProgram({ days: [{ week: 1, day: 1, exercises: [{ name: '', sets: 1, reps: [] }] }] }), /name/);
  const extra = structuredClone(sample);
  extra.unused = { anything: true };
  extra.days[0].exercises[0].coach = 'ignored';
  assert.doesNotThrow(() => validateProgram(extra));
});

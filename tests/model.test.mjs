import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  addEmptySet,
  annotateLoggedExercise,
  applySame,
  bestEffort,
  buildCsv,
  buildEntries,
  classifyExercise,
  emptyLogs,
  entryFlag,
  findPrevious,
  historySeries,
  isRestEntry,
  isoDate,
  migrateLogs,
  nextUp,
  normalizeName,
  parseHash,
  parseNotes,
  parseRest,
  platePlan,
  prescribedSets,
  repForSet,
  setCompleted,
  setLoggedSet,
  setSessionDate,
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

test('optional day flag is shown only when it is a non-empty string', () => {
  const entries = buildEntries(sample);
  const flagged = entries.find((entry) => entry.week === 1 && entry.day === 4);
  const plain = entries.find((entry) => entry.week === 1 && entry.day === 1);
  assert.equal(entryFlag(flagged), 'Sample flag: fake warning note.');
  assert.equal(entryFlag(plain), '');
  assert.equal(entryFlag({ source: 'day', record: { flag: '   ' } }), '');
  assert.equal(entryFlag({ source: 'day', record: { flag: 3 } }), '');
  assert.equal(entryFlag({ source: 'schedule', schedule: { flag: ' Sample schedule flag ' } }), 'Sample schedule flag');
});

test('extra set is stored past the prescribed count', () => {
  const logs = emptyLogs();
  const entry = buildEntries(sample)[0];
  const count = addEmptySet(logs, entry, 'Sample Exercise A', 3);
  assert.equal(count, 4);
});

test('last time follows the performed date, not program order or when it was typed', () => {
  const entries = buildEntries(sample);
  const logs = emptyLogs();
  const monday = entries[0];
  const tuesday = entries[1];
  const thursday = entries.find((entry) => entry.day === 4);
  setLoggedSet(logs, monday, 'Sample Exercise A', 0, 'weight', '100', 5_000);
  setLoggedSet(logs, monday, 'Sample Exercise A', 0, 'reps', '12', 5_000);
  setSessionDate(logs, monday, '2026-11-02');
  setLoggedSet(logs, tuesday, 'Sample Exercise A', 0, 'weight', '110', 1_000);
  setLoggedSet(logs, tuesday, 'Sample Exercise A', 0, 'reps', '8', 1_000);
  setSessionDate(logs, tuesday, '2026-11-03');

  const beforeEdit = findPrevious(logs, tuesday, 'Sample Exercise A');
  assert.equal(beforeEdit.date, '2026-11-02');
  assert.equal(beforeEdit.sets[0].weight, '100');
  assert.equal(beforeEdit.week, 1);
  assert.equal(beforeEdit.day, 1);

  setSessionDate(logs, tuesday, '2026-11-01');
  assert.equal(findPrevious(logs, tuesday, 'Sample Exercise A'), null);
  const reordered = findPrevious(logs, monday, 'Sample Exercise A');
  assert.equal(reordered.date, '2026-11-01');
  assert.equal(reordered.sets[0].weight, '110');
  assert.equal(reordered.sets[0].reps, '8');

  setLoggedSet(logs, thursday, 'Sample Exercise C', 0, 'weight', '200', 9_000);
  setCompleted(logs, thursday, true, 9_000);
  assert.equal(nextUp(entries, logs).day, 1);
  assert.equal(nextUp(entries, logs).week, 1);
});

test('skipped rest days do not block the next workout and are not appointments', () => {
  const entries = buildEntries(sample);
  const logs = emptyLogs();
  const rest = entries.find((entry) => isRestEntry(entry));
  setCompleted(logs, entries[0], true, 1_000);
  setCompleted(logs, entries[1], true, 2_000);
  assert.equal(isRestEntry(rest), true);
  assert.equal(nextUp(entries, logs).day, 4);
  assert.equal(nextUp(entries, logs).dayOfWeek, 'Thursday');
  setSessionDate(logs, rest, '2026-01-01');
  assert.equal(nextUp(entries, logs).day, 4);
});

test('program notes distinguish warm-ups, substitutes, drop sets, and supersets', () => {
  const warmup = parseNotes('Warm Up - Not Done To Failure');
  assert.equal(warmup.warmup, true);
  assert.equal(warmup.drop, false);
  const swap = parseNotes('Can Substitute W/ Sample Exercise B, Sample Exercise C');
  assert.deepEqual(swap.substitutes, ['Sample Exercise B', 'Sample Exercise C']);
  const drop = parseNotes('Lower Weight 25% No Rest, Immediately Into Next Set (Drop Set)');
  assert.equal(drop.drop, true);
  assert.equal(drop.noRest, true);
  const superset = parseNotes('Superset with the next movement. Rest 2 min after both.');
  assert.equal(superset.superset, true);
  const exercise = { name: 'Sample', sets: 3, reps: ['8'], notes: drop.text };
  assert.equal(classifyExercise(exercise).dropSetIndex, 2);
});

test('warm-up sets stay out of PRs and a swap keeps its own history', () => {
  const entries = buildEntries(sample);
  const logs = emptyLogs();
  const monday = entries[0];
  setLoggedSet(logs, monday, 'Sample Exercise A', 0, 'weight', '300', 1_000);
  setLoggedSet(logs, monday, 'Sample Exercise A', 0, 'reps', '5', 1_000);
  annotateLoggedExercise(logs, monday, 'Sample Exercise A', { warmup: true, dropSetIndex: -1 });
  assert.equal(historySeries(logs, 'Sample Exercise A').length, 0);
  assert.equal(bestEffort(logs, 'Sample Exercise A'), null);

  setLoggedSet(logs, monday, 'Sample Exercise B', 0, 'weight', '100', 1_000);
  setLoggedSet(logs, monday, 'Sample Exercise B', 0, 'reps', '8', 1_000);
  const best = bestEffort(logs, 'Sample Exercise B');
  assert.equal(best.weight, '100');
  assert.equal(best.reps, '8');
  assert.ok(best.e1rm > 100);

  const tuesday = entries[1];
  const previous = findPrevious(logs, tuesday, 'Sample Exercise B');
  assert.equal(applySame(logs, tuesday, 'Sample Exercise A', previous, 'lb', 2_000), true);
  const copied = logs.sessions['1-2'].exercises['sample exercise a'].sets[0];
  assert.equal(copied.weight, '100');
  assert.equal(copied.reps, '8');
});

test('rest strings and plate math', () => {
  assert.equal(parseRest('90 sec').seconds, 90);
  assert.equal(parseRest('2 min').seconds, 120);
  assert.equal(parseRest('2-5 Min').seconds, 120);
  assert.equal(parseRest('2-5 Min').high, 300);
  assert.equal(parseRest(null).seconds, null);
  const plates = platePlan(185, 'lb');
  assert.equal(plates.bar, 45);
  assert.deepEqual(plates.perSide, [45, 25]);
  assert.equal(plates.remainder, 0);
  assert.equal(platePlan(40, 'lb').underBar, true);
});

test('v1 logs migrate without dropping sets', () => {
  const legacy = {
    sessions: {
      '1-1': {
        week: 1,
        day: 1,
        date: '2026-10-01',
        startedAt: 50,
        completed: true,
        exercises: {
          'sample exercise a': {
            name: 'Sample Exercise A',
            sets: [{ weight: '100', reps: '12' }],
          },
        },
      },
    },
  };
  const logs = migrateLogs(legacy);
  assert.equal(logs.sessions['1-1'].exercises['sample exercise a'].sets[0].weight, '100');
  const previous = findPrevious(logs, { week: 1, day: 2 }, 'Sample Exercise A');
  assert.equal(previous.sets[0].weight, '100');
  assert.equal(previous.sets[0].unit, 'lb');
  assert.equal(previous.date, '2026-10-01');
});

test('the install hash keeps the key beside the route', () => {
  assert.deepEqual(parseHash('#k=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'), {
    key: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
    route: '/',
  });
  assert.equal(parseHash('#k=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&/day/1/2').route, '/day/1/2');
  assert.equal(parseHash('#/settings').key, '');
  assert.equal(parseHash('#/settings').route, '/settings');
});

test('validation rejects a program with no days and tolerates extra fields', () => {
  assert.throws(() => validateProgram({ days: [] }), /no days/);
  assert.throws(() => validateProgram({ days: [{ week: 1, day: 1, exercises: [{ name: '', sets: 1, reps: [] }] }] }), /name/);
  const extra = structuredClone(sample);
  extra.unused = { anything: true };
  extra.days[0].exercises[0].coach = 'ignored';
  assert.doesNotThrow(() => validateProgram(extra));
});

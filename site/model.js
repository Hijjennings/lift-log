/** Pure program/log helpers. No DOM, no network. */

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function displayName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/** Case- and whitespace-insensitive exercise identity. */
export function normalizeName(name) {
  return displayName(name).toLowerCase();
}

export function emptyLogs() {
  return { sessions: {} };
}

export function sessionId(entry) {
  return `${entry.week}-${entry.day}`;
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function cleanText(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function validateProgram(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Program must be a JSON object.');
  }
  if (!Array.isArray(data.days)) {
    throw new Error('Program is missing a days array.');
  }
  if (data.days.length === 0 && !(Array.isArray(data.schedule) && data.schedule.length > 0)) {
    throw new Error('Program has no days.');
  }
  data.days.forEach((day, index) => {
    if (!day || typeof day !== 'object' || Array.isArray(day)) {
      throw new Error(`Day ${index + 1} is not an object.`);
    }
    const week = finiteNumber(day.week);
    const dayNum = finiteNumber(day.day);
    if (week == null || dayNum == null) {
      throw new Error(`Day ${index + 1} needs a numeric week and day.`);
    }
    if (!Array.isArray(day.exercises)) {
      throw new Error(`Week ${week} Day ${dayNum} is missing an exercises array.`);
    }
    day.exercises.forEach((exercise, exerciseIndex) => {
      if (!exercise || typeof exercise !== 'object') {
        throw new Error(`Week ${week} Day ${dayNum} exercise ${exerciseIndex + 1} is not an object.`);
      }
      if (!displayName(exercise.name)) {
        throw new Error(`Week ${week} Day ${dayNum} exercise ${exerciseIndex + 1} needs a name.`);
      }
      if (finiteNumber(exercise.sets) == null || finiteNumber(exercise.sets) < 0) {
        throw new Error(`Week ${week} Day ${dayNum} exercise ${exerciseIndex + 1} needs a numeric sets count.`);
      }
      const reps = exercise.reps;
      const repsOk = typeof reps === 'string'
        || (Array.isArray(reps) && reps.every((item) => typeof item === 'string'));
      if (!repsOk) {
        throw new Error(`Week ${week} Day ${dayNum} exercise ${exerciseIndex + 1} reps must be a string or an array of strings.`);
      }
    });
    if (day.restText != null && !Array.isArray(day.restText)) {
      throw new Error(`Week ${week} Day ${dayNum} restText must be an array.`);
    }
  });
  return data;
}

function weekdayNumber(name) {
  if (name == null) return null;
  const found = WEEKDAYS.findIndex((day) => day.toLowerCase() === String(name).trim().toLowerCase());
  return found === -1 ? null : found + 1;
}

export function buildEntries(program) {
  const entries = [];
  const seen = new Set();
  for (const day of program?.days || []) {
    const week = finiteNumber(day?.week);
    const dayNum = finiteNumber(day?.day);
    if (week == null || dayNum == null) continue;
    const id = `${week}-${dayNum}`;
    seen.add(id);
    entries.push({
      week,
      day: dayNum,
      dayOfWeek: day.dayOfWeek || WEEKDAYS[dayNum - 1] || '',
      source: 'day',
      record: day,
    });
  }
  for (const row of program?.schedule || []) {
    const week = finiteNumber(row?.week);
    const dayNum = weekdayNumber(row?.dayOfWeek);
    if (week == null || dayNum == null) continue;
    const id = `${week}-${dayNum}`;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({
      week,
      day: dayNum,
      dayOfWeek: WEEKDAYS[dayNum - 1],
      source: 'schedule',
      schedule: row,
    });
  }
  entries.sort((a, b) => a.week - b.week || a.day - b.day);
  return entries;
}

export function isRestEntry(entry) {
  return entry?.source === 'day' && entry.record?.isRest === true;
}

export function isScheduleOnly(entry) {
  return entry?.source === 'schedule';
}

export function entryWorkout(entry) {
  if (!entry) return '';
  if (entry.source === 'schedule') return cleanText(entry.schedule?.workout);
  return cleanText(entry.record?.workout) || cleanText(entry.record?.scheduleWorkout);
}

export function entryTitle(entry) {
  if (entry?.source === 'day' && cleanText(entry.record?.titlePrinted)) {
    return cleanText(entry.record.titlePrinted);
  }
  const workout = entryWorkout(entry);
  const base = `Week ${entry.week} Day ${entry.day}`;
  return workout ? `${base}: ${workout}` : base;
}

export function entryFocus(entry) {
  if (entry?.source !== 'day') return '';
  return cleanText(entry.record?.focus);
}

/** Optional warning string on a day. Missing, blank, and non-strings are ignored. */
export function entryFlag(entry) {
  const raw = entry?.source === 'schedule' ? entry.schedule?.flag : entry?.record?.flag;
  return typeof raw === 'string' ? cleanText(raw) : '';
}

export function entryPage(entry) {
  if (entry?.source !== 'day') return null;
  return entry.record?.page ?? null;
}

export function isComplete(logs, entry) {
  return logs?.sessions?.[sessionId(entry)]?.completed === true;
}

/** Next workout skips rest days. Schedule-only days (deload) remain eligible. */
export function nextUp(entries, logs) {
  return entries.find((entry) => !isRestEntry(entry) && !isComplete(logs, entry)) || null;
}

export function repsArray(exercise) {
  const reps = exercise?.reps;
  if (Array.isArray(reps)) return reps.filter((item) => typeof item === 'string');
  if (typeof reps === 'string' && reps.trim()) return [reps];
  return [];
}

export function prescribedSets(exercise) {
  const count = finiteNumber(exercise?.sets);
  if (count == null || count < 0) return 0;
  return Math.floor(count);
}

/**
 * One label per set row. A per-set string wins. A one-element array is the
 * range for every set, including when sets exceed reps.length.
 */
export function repForSet(exercise, index) {
  const reps = repsArray(exercise);
  if (reps.length === 0) return '';
  if (index < reps.length) return reps[index];
  if (reps.length === 1) return reps[0];
  return '';
}

export function visibleSetCount(exercise, loggedLength) {
  return Math.max(prescribedSets(exercise), loggedLength || 0);
}

function filledSet(set) {
  return cleanText(set?.weight) !== '' || cleanText(set?.reps) !== '';
}

export function ensureSession(logs, entry) {
  if (!logs.sessions) logs.sessions = {};
  const id = sessionId(entry);
  if (!logs.sessions[id]) {
    logs.sessions[id] = {
      week: entry.week,
      day: entry.day,
      date: null,
      startedAt: null,
      completed: false,
      exercises: {},
    };
  }
  return logs.sessions[id];
}

export function isoDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDisplayDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '';
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

export function sanitizeWeight(raw) {
  let value = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = value.indexOf('.');
  if (dot !== -1) {
    value = value.slice(0, dot + 1) + value.slice(dot + 1).replace(/\./g, '');
    const [whole, fraction = ''] = value.split('.');
    value = `${whole}.${fraction.slice(0, 2)}`;
  }
  return value.slice(0, 8);
}

export function sanitizeReps(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 4);
}

export function formatNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  if (!Number.isFinite(rounded)) return '';
  if (Object.is(rounded, -0)) return '0';
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function stepWeight(current, delta, placeholder) {
  const typed = cleanText(current);
  const source = typed === '' ? cleanText(placeholder) : typed;
  const base = source === '' || !Number.isFinite(Number(source)) ? 0 : Number(source);
  return formatNumber(Math.max(0, base + delta));
}

export function stepReps(current, delta, placeholder) {
  const typed = cleanText(current);
  const source = typed === '' ? cleanText(placeholder) : typed;
  const parsed = parseInt(source, 10);
  const base = source === '' || !Number.isFinite(parsed) ? 0 : parsed;
  return String(Math.max(0, base + delta));
}

function touchLogged(session, now) {
  const any = Object.values(session.exercises).some((exercise) => exercise.sets.some(filledSet));
  if (!any) return;
  if (!session.startedAt) session.startedAt = now;
  if (!session.date) session.date = isoDate(new Date(now));
}

export function setLoggedSet(logs, entry, exerciseName, setIndex, field, value, now = Date.now(), unit = 'lb') {
  const session = ensureSession(logs, entry);
  const key = normalizeName(exerciseName);
  if (!key) return session;
  if (!session.exercises[key]) {
    session.exercises[key] = { name: displayName(exerciseName), sets: [] };
  }
  const exercise = session.exercises[key];
  while (exercise.sets.length <= setIndex) exercise.sets.push({ weight: '', reps: '' });
  if (field === 'weight') {
    exercise.sets[setIndex].weight = sanitizeWeight(value);
    exercise.sets[setIndex].unit = unit === 'kg' ? 'kg' : 'lb';
  }
  if (field === 'reps') exercise.sets[setIndex].reps = sanitizeReps(value);
  if (field === 'rpe') exercise.sets[setIndex].rpe = sanitizeRpe(value);
  touchLogged(session, now);
  return session;
}

export function sanitizeRpe(raw) {
  let value = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = value.indexOf('.');
  if (dot !== -1) {
    value = `${value.slice(0, dot + 1)}${value.slice(dot + 1).replace(/\./g, '').slice(0, 1)}`;
  }
  value = value.slice(0, 4);
  if (value === '' || value === '.') return '';
  const number = Number(value);
  if (Number.isFinite(number) && number > 10) return '10';
  return value;
}

export function addEmptySet(logs, entry, exerciseName, prescribed) {
  const session = ensureSession(logs, entry);
  const key = normalizeName(exerciseName);
  if (!session.exercises[key]) {
    session.exercises[key] = { name: displayName(exerciseName), sets: [] };
  }
  const exercise = session.exercises[key];
  const visible = Math.max(prescribed, exercise.sets.length);
  while (exercise.sets.length < visible + 1) exercise.sets.push({ weight: '', reps: '' });
  return exercise.sets.length;
}

export function removeLastExtraSet(logs, entry, exerciseName, prescribed) {
  const exercise = logs.sessions?.[sessionId(entry)]?.exercises?.[normalizeName(exerciseName)];
  if (!exercise) return;
  if (exercise.sets.length > prescribed) exercise.sets.pop();
}

export function setSessionDate(logs, entry, iso) {
  const session = ensureSession(logs, entry);
  session.date = iso || null;
  return session;
}

export function setCompleted(logs, entry, completed, now = Date.now()) {
  const session = ensureSession(logs, entry);
  session.completed = Boolean(completed);
  if (session.completed && !session.date) session.date = isoDate(new Date(now));
  return session;
}

/** Calendar day the sets were actually performed. An edited date wins over the log timestamp. */
export function performedDate(session) {
  if (session?.date && /^\d{4}-\d{2}-\d{2}$/.test(session.date)) return session.date;
  if (session?.startedAt) return isoDate(new Date(session.startedAt));
  return '';
}

/**
 * Most recent other session of this exercise by the date it was performed.
 * Program order and the time the row was typed do not decide "last time".
 * A back-dated session counts. A session dated after the one on screen does not.
 * Same-day ties break on startedAt, then program position.
 */
export function findPrevious(logs, entry, exerciseName) {
  const target = normalizeName(exerciseName);
  if (!target || !entry) return null;
  const current = logs?.sessions?.[sessionId(entry)];
  const currentDate = current ? performedDate(current) : '';
  const currentStarted = current?.startedAt ?? null;
  let best = null;
  for (const session of Object.values(logs?.sessions || {})) {
    if (session.week === entry.week && session.day === entry.day) continue;
    let exercise = null;
    for (const [key, item] of Object.entries(session.exercises || {})) {
      const name = normalizeName(item?.name) || key;
      if (name === target) {
        exercise = item;
        break;
      }
    }
    if (!exercise?.sets?.some(filledSet)) continue;
    const date = performedDate(session);
    if (!date) continue;
    if (currentDate) {
      if (date > currentDate) continue;
      if (date === currentDate) {
        const otherStarted = session.startedAt ?? 0;
        const mine = currentStarted ?? Number.POSITIVE_INFINITY;
        if (otherStarted >= mine) continue;
      }
    }
    const candidate = {
      startedAt: session.startedAt || 0,
      date,
      week: session.week,
      day: session.day,
      name: exercise.name,
      sets: exercise.sets.map((set) => ({
        weight: String(set?.weight ?? ''),
        reps: String(set?.reps ?? ''),
        unit: set?.unit === 'kg' ? 'kg' : 'lb',
        rpe: String(set?.rpe ?? ''),
        drop: set?.drop === true,
      })),
    };
    const better = !best
      || candidate.date > best.date
      || (candidate.date === best.date && candidate.startedAt > best.startedAt)
      || (candidate.date === best.date && candidate.startedAt === best.startedAt
        && (candidate.week > best.week || (candidate.week === best.week && candidate.day > best.day)));
    if (better) best = candidate;
  }
  return best;
}

export function formatPerformed(set, displayUnit) {
  const from = set?.unit === 'kg' ? 'kg' : 'lb';
  const unit = displayUnit === 'kg' || (!displayUnit && from === 'kg') ? 'kg' : 'lb';
  const weight = cleanText(set?.weight);
  const reps = cleanText(set?.reps);
  const shown = weight ? (displayUnit && displayUnit !== from ? convertWeight(weight, from, displayUnit) : weight) : '';
  const label = unit === 'kg' ? 'kg' : 'lb';
  if (shown && reps) return `${shown} ${label} × ${reps}`;
  if (shown) return `${shown} ${label}`;
  if (reps) return `${reps} reps`;
  return '';
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function pushLoggedRows(lines, session, workout, orderedNames) {
  if (!session) return false;
  const completed = session.completed ? 'true' : 'false';
  const date = session.date || '';
  let any = false;
  const seen = new Set();
  const emit = (name, sets) => {
    sets.forEach((set, index) => {
      if (!filledSet(set)) return;
      any = true;
      lines.push([
        date,
        session.week,
        session.day,
        workout,
        name,
        index + 1,
        set.weight ?? '',
        set.reps ?? '',
        completed,
      ].map(csvCell).join(','));
    });
  };
  for (const name of orderedNames) {
    const key = normalizeName(name);
    seen.add(key);
    emit(displayName(name), session.exercises?.[key]?.sets || []);
  }
  for (const exercise of Object.values(session.exercises || {})) {
    const key = normalizeName(exercise.name);
    if (seen.has(key)) continue;
    emit(exercise.name, exercise.sets || []);
  }
  if (!any && session.completed) {
    lines.push([date, session.week, session.day, workout, '', '', '', '', 'true'].map(csvCell).join(','));
    return true;
  }
  return any;
}

export function buildCsv(entries, logs) {
  const header = ['date', 'week', 'day', 'workout', 'exercise', 'set', 'weight', 'reps', 'completed_day'];
  const lines = [header.join(',')];
  const seen = new Set();
  for (const entry of entries) {
    const id = sessionId(entry);
    seen.add(id);
    const names = entry.source === 'day' ? (entry.record.exercises || []).map((exercise) => exercise.name) : [];
    pushLoggedRows(lines, logs?.sessions?.[id], entryWorkout(entry), names);
  }
  for (const [id, session] of Object.entries(logs?.sessions || {})) {
    if (seen.has(id)) continue;
    pushLoggedRows(lines, session, '', Object.values(session.exercises || {}).map((exercise) => exercise.name));
  }
  return `${lines.join('\n')}\n`;
}

export function glossaryEntries(program) {
  if (!Array.isArray(program?.glossary)) return [];
  return program.glossary
    .filter((item) => item && typeof item.term === 'string' && item.term.trim())
    .map((item) => ({ term: item.term.trim(), text: item.text == null ? '' : String(item.text) }));
}

export function deloadView(program) {
  const deload = program?.deload;
  if (!deload || typeof deload !== 'object') return { title: '', page: null, blocks: [] };
  let blocks = [];
  if (Array.isArray(deload.paragraphs) && deload.paragraphs.some((item) => cleanText(item))) {
    blocks = deload.paragraphs.map((item) => String(item)).filter((item) => item.trim());
  } else if (cleanText(deload.text)) {
    blocks = String(deload.text).split(/\n/).map((item) => item.trim()).filter(Boolean);
  }
  return {
    title: cleanText(deload.title) || 'Deload',
    page: deload.page ?? null,
    blocks,
  };
}

export function restLines(entry) {
  if (entry?.source !== 'day' || !Array.isArray(entry.record?.restText)) return [];
  return entry.record.restText.map((line) => String(line)).filter((line) => line.trim());
}

export function programLabel(program) {
  const source = program?.source;
  if (typeof source === 'string' && source.trim()) return source.trim();
  if (source && typeof source === 'object') {
    return cleanText(source.title) || cleanText(source.file) || 'Loaded program';
  }
  return 'Loaded program';
}

export function parseBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Backup must be a JSON object.');
  }
  if (!data.program) throw new Error('Backup is missing the program.');
  validateProgram(data.program);
  const logs = data.logs && typeof data.logs === 'object' && data.logs.sessions && typeof data.logs.sessions === 'object'
    ? data.logs
    : emptyLogs();
  const prefs = data.prefs && typeof data.prefs === 'object' && !Array.isArray(data.prefs) ? data.prefs : null;
  return { program: data.program, logs: { sessions: logs.sessions }, prefs };
}

export function workoutProgress(entries, logs) {
  const workouts = entries.filter((entry) => !isRestEntry(entry));
  const done = workouts.filter((entry) => isComplete(logs, entry)).length;
  return { done, total: workouts.length };
}

const LB_PER_KG = 2.2046226218;
const PLATES = {
  lb: [45, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
};
const BAR = { lb: 45, kg: 20 };

export function weightStep(unit) {
  return unit === 'kg' ? 1.25 : 2.5;
}

export function convertWeight(value, fromUnit, toUnit) {
  const from = fromUnit === 'kg' ? 'kg' : 'lb';
  const to = toUnit === 'kg' ? 'kg' : 'lb';
  const text = cleanText(value);
  if (!text || !Number.isFinite(Number(text))) return '';
  if (from === to) return formatNumber(Number(text));
  const pounds = from === 'kg' ? Number(text) * LB_PER_KG : Number(text);
  const out = to === 'kg' ? pounds / LB_PER_KG : pounds;
  return formatNumber(out);
}

export function displayWeight(set, unit) {
  const stored = cleanText(set?.weight);
  if (!stored) return '';
  const from = set?.unit === 'kg' ? 'kg' : 'lb';
  const to = unit === 'kg' ? 'kg' : 'lb';
  if (from === to) return stored;
  return convertWeight(stored, from, to);
}

/** v1 logs are already { sessions }. Extra fields are kept. Missing units mean pounds. */
export function migrateLogs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLogs();
  const sessions = raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)
    ? raw.sessions
    : {};
  return { sessions };
}

export function isInProgress(logs, entry) {
  const session = logs?.sessions?.[sessionId(entry)];
  if (!session || session.completed) return false;
  return Object.values(session.exercises || {}).some((exercise) => (exercise.sets || []).some(filledSet));
}

export function parseNotes(notes) {
  const text = cleanText(notes);
  const substitutes = [];
  const pattern = /can substitute w\/\s*([^.;\n]+)/gi;
  let match = pattern.exec(text);
  while (match) {
    for (const part of match[1].split(/\s*,\s*|\s+or\s+/i)) {
      const name = cleanText(part);
      if (name) substitutes.push(name);
    }
    match = pattern.exec(text);
  }
  return {
    text,
    warmup: /warm[\s-]*up/i.test(text),
    drop: /drop\s*set/i.test(text),
    noRest: /no\s*rest/i.test(text),
    superset: /super\s*set/i.test(text),
    substitutes,
  };
}

export function classifyExercise(exercise) {
  const notes = parseNotes(exercise?.notes);
  const count = prescribedSets(exercise);
  return {
    ...notes,
    dropSetIndex: notes.drop && count > 0 ? count - 1 : -1,
  };
}

export function parseRest(rest) {
  const text = cleanText(rest);
  if (!text) return { seconds: null, label: '' };
  const toSeconds = (amount, unitToken) => {
    const unit = unitToken && /^s(ec(ond)?s?)?$/i.test(unitToken) ? 'sec' : 'min';
    const value = Number(amount);
    if (!Number.isFinite(value)) return null;
    return Math.round(unit === 'sec' ? value : value * 60);
  };
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|sec(?:ond)?s?|m|s)?/i);
  if (range) {
    const low = toSeconds(range[1], range[3]);
    const high = toSeconds(range[2], range[3]);
    if (low == null || high == null) return { seconds: null, label: text };
    return { seconds: Math.min(low, high), label: text, low: Math.min(low, high), high: Math.max(low, high) };
  }
  const single = text.match(/(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|sec(?:ond)?s?|m|s)/i);
  if (single) {
    return { seconds: toSeconds(single[1], single[2]), label: text };
  }
  return { seconds: null, label: text };
}

/** No timer on the set that drops straight into the next one. */
export function restAfterSet(exercise, setIndex) {
  const info = classifyExercise(exercise);
  const count = prescribedSets(exercise);
  if (info.drop && info.noRest && setIndex === count - 2) return null;
  const timing = parseRest(exercise?.rest);
  if (!timing.seconds) return null;
  return timing;
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, '0')}`;
}

export function platePlan(weight, unit = 'lb') {
  const chosen = unit === 'kg' ? 'kg' : 'lb';
  const target = Number(weight);
  const bar = BAR[chosen];
  if (!Number.isFinite(target)) {
    return { unit: chosen, bar, perSide: [], remainder: 0, underBar: false, empty: true };
  }
  if (target < bar) {
    return { unit: chosen, bar, perSide: [], remainder: 0, underBar: true, empty: false };
  }
  let remaining = (target - bar) / 2;
  const perSide = [];
  for (const plate of PLATES[chosen]) {
    while (remaining + 1e-6 >= plate) {
      perSide.push(plate);
      remaining -= plate;
    }
  }
  return {
    unit: chosen,
    bar,
    perSide,
    remainder: Math.round(remaining * 100) / 100,
    underBar: false,
    empty: false,
  };
}

export function estimated1RM(weight, reps) {
  const pounds = Number(weight);
  const count = Number(reps);
  if (!Number.isFinite(pounds) || pounds <= 0) return null;
  if (!Number.isFinite(count) || count < 1 || count > 12) return null;
  if (count === 1) return pounds;
  return pounds * (1 + count / 30);
}

export function setPerformedName(logs, entry, programmedName, performedName) {
  const session = ensureSession(logs, entry);
  const key = normalizeName(programmedName);
  if (!key) return session;
  if (!session.exercises[key]) {
    session.exercises[key] = { name: displayName(performedName), sets: [] };
  }
  session.exercises[key].programmed = displayName(programmedName);
  session.exercises[key].name = displayName(performedName || programmedName);
  return session;
}

export function setDayNote(logs, entry, note) {
  const session = ensureSession(logs, entry);
  session.note = String(note ?? '').slice(0, 2000);
  return session;
}

export function setExerciseNote(logs, entry, exerciseName, note) {
  const session = ensureSession(logs, entry);
  const key = normalizeName(exerciseName);
  if (!key) return session;
  if (!session.exercises[key]) session.exercises[key] = { name: displayName(exerciseName), sets: [] };
  session.exercises[key].note = String(note ?? '').slice(0, 2000);
  return session;
}

export function setSetDone(logs, entry, exerciseName, setIndex, done, now = Date.now()) {
  const session = ensureSession(logs, entry);
  const key = normalizeName(exerciseName);
  if (!key) return session;
  if (!session.exercises[key]) session.exercises[key] = { name: displayName(exerciseName), sets: [] };
  const exercise = session.exercises[key];
  while (exercise.sets.length <= setIndex) exercise.sets.push({ weight: '', reps: '' });
  exercise.sets[setIndex].done = Boolean(done);
  if (done) touchLogged(session, now);
  return session;
}

export function annotateLoggedExercise(logs, entry, programmedName, info) {
  const exercise = logs?.sessions?.[sessionId(entry)]?.exercises?.[normalizeName(programmedName)];
  if (!exercise || !info) return false;
  let changed = false;
  if (info.warmup && exercise.warmup !== true) {
    exercise.warmup = true;
    changed = true;
  }
  if (info.dropSetIndex >= 0) {
    const set = exercise.sets?.[info.dropSetIndex];
    if (set && set.drop !== true) {
      set.drop = true;
      changed = true;
    }
  }
  return changed;
}

export function applySame(logs, entry, exerciseName, previous, unit = 'lb', now = Date.now()) {
  if (!previous?.sets?.length) return false;
  let any = false;
  previous.sets.forEach((set, index) => {
    const weight = cleanText(set.weight);
    const reps = cleanText(set.reps);
    if (!weight && !reps) return;
    if (weight) {
      setLoggedSet(logs, entry, exerciseName, index, 'weight', convertWeight(weight, set.unit || 'lb', unit), now, unit);
    }
    if (reps) setLoggedSet(logs, entry, exerciseName, index, 'reps', reps, now, unit);
    any = true;
  });
  return any;
}

export function historySeries(logs, exerciseName) {
  const target = normalizeName(exerciseName);
  const points = [];
  if (!target) return points;
  for (const session of Object.values(logs?.sessions || {})) {
    const date = performedDate(session);
    if (!date) continue;
    for (const [key, exercise] of Object.entries(session.exercises || {})) {
      const name = normalizeName(exercise?.name) || key;
      if (name !== target || exercise?.warmup === true) continue;
      const sets = (exercise.sets || []).map((set, index) => ({
        index,
        weight: String(set?.weight ?? ''),
        reps: String(set?.reps ?? ''),
        unit: set?.unit === 'kg' ? 'kg' : 'lb',
        rpe: String(set?.rpe ?? ''),
        drop: set?.drop === true,
        filled: filledSet(set),
      }));
      const working = sets.filter((set) => set.filled && !set.drop);
      if (!working.length) continue;
      let best = null;
      for (const set of working) {
        const estimate = estimated1RM(set.weight, set.reps);
        const asPounds = estimate == null ? Number(convertWeight(set.weight, set.unit, 'lb')) : Number(convertWeight(estimate, set.unit, 'lb'));
        if (!Number.isFinite(asPounds)) continue;
        if (!best || asPounds > best.score) {
          best = { score: asPounds, e1rm: estimate, weight: set.weight, reps: set.reps, unit: set.unit };
        }
      }
      points.push({
        date,
        week: session.week,
        day: session.day,
        startedAt: session.startedAt || 0,
        sets,
        best,
      });
    }
  }
  points.sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt || a.week - b.week || a.day - b.day);
  return points;
}

export function bestEffort(logs, exerciseName) {
  let best = null;
  for (const point of historySeries(logs, exerciseName)) {
    if (!point.best) continue;
    if (!best || point.best.score > best.score) {
      best = { ...point.best, date: point.date, week: point.week, day: point.day };
    }
  }
  return best;
}

export function parseHash(hash) {
  let raw = String(hash || '').replace(/^#/, '');
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw fragment */ }
  const match = raw.match(/^k=([A-Za-z0-9_-]{8,128})(?:&(.*))?$/);
  if (match) {
    const route = match[2] && match[2].startsWith('/') ? match[2] : '/';
    return { key: match[1], route };
  }
  if (!raw) return { key: '', route: '/' };
  return { key: '', route: raw.startsWith('/') ? raw : `/${raw}` };
}

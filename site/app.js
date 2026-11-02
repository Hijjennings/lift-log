import * as model from './model.js';
import { decryptProgram } from './crypto.js';

const PROGRAM_KEY = 'liftlog.program.v1';
const LOGS_KEY = 'liftlog.logs.v1';
const PREFS_KEY = 'liftlog.prefs.v1';
const KEY_KEY = 'liftlog.key.v1';
const FETCH_ERROR = 'The program could not be downloaded. Connect once, then open your link again.';
const KEY_ERROR = "This link didn't unlock the program.";

const app = document.getElementById('app');
const state = {
  program: null,
  logs: model.emptyLogs(),
  prefs: { unit: 'lb', rpe: false, sound: true, notify: false },
  key: '',
  error: '',
  unlockError: '',
  draft: '',
  ready: false,
  sheet: null,
  timer: null,
};
let shownRoute = '';
let timerHandle = 0;
let wakeLock = null;
let lastFocused = '';

function readStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  if (state.program) localStorage.setItem(PROGRAM_KEY, JSON.stringify(state.program));
  localStorage.setItem(LOGS_KEY, JSON.stringify(state.logs));
  localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
  if (state.key) localStorage.setItem(KEY_KEY, state.key);
  state.error = state.error === 'Could not save on this phone (storage is blocked or full).' ? '' : state.error;
}

function loadStored() {
  const program = readStored(PROGRAM_KEY);
  const logs = readStored(LOGS_KEY);
  const prefs = readStored(PREFS_KEY);
  try {
    state.key = localStorage.getItem(KEY_KEY) || '';
  } catch {
    state.key = '';
  }
  if (program) {
    try {
      model.validateProgram(program);
      state.program = program;
    } catch {
      state.unlockError = 'The saved program could not be read.';
    }
  }
  state.logs = model.migrateLogs(logs);
  if (prefs && typeof prefs === 'object') {
    if (prefs.unit === 'kg' || prefs.unit === 'lb') state.prefs.unit = prefs.unit;
    if (typeof prefs.rpe === 'boolean') state.prefs.rpe = prefs.rpe;
    if (typeof prefs.sound === 'boolean') state.prefs.sound = prefs.sound;
    if (typeof prefs.notify === 'boolean') state.prefs.notify = prefs.notify;
  }
}

function entries() {
  return state.program ? model.buildEntries(state.program) : [];
}

function findEntry(week, day) {
  return entries().find((entry) => entry.week === week && entry.day === day) || null;
}

function formatHash(path) {
  const route = path.startsWith('/') ? path : `/${path}`;
  return state.key ? `#k=${state.key}&${route}` : `#${route}`;
}

function currentRoute() {
  const parsed = model.parseHash(location.hash);
  const parts = parsed.route.split('/').filter(Boolean);
  if (parts[0] === 'day') return { name: 'day', week: Number(parts[1]), day: Number(parts[2]) };
  if (parts[0] === 'program') return { name: 'program' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'glossary') return { name: 'glossary' };
  if (parts[0] === 'deload') return { name: 'deload' };
  return { name: 'train' };
}

function hashMatches(path) {
  const want = model.parseHash(formatHash(path));
  const have = model.parseHash(location.hash);
  return want.key === have.key && want.route === have.route;
}

function replaceHash(path) {
  if (hashMatches(path)) return false;
  location.replace(formatHash(path));
  return true;
}

function go(path) {
  if (hashMatches(path)) {
    render();
    return false;
  }
  location.hash = formatHash(path);
  return true;
}

function h(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  const list = Array.isArray(kids) ? kids.flat() : [kids];
  for (const kid of list) {
    if (kid == null || kid === false || kid === '') continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function icon(name) {
  const paths = {
    train: '<path d="M4 10h16M7 10v8M17 10v8M6 18h4M14 18h4M8 6h8l1 4H7z"/>',
    program: '<path d="M5 6h14M5 12h14M5 18h10"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths[name] || '';
  return svg;
}

function tabbar(active) {
  const tabs = [
    ['train', '/', 'Train', 'train'],
    ['program', '/program', 'Program', 'program'],
    ['settings', '/settings', 'Settings', 'settings'],
  ];
  return h('nav', { class: 'tabbar', 'aria-label': 'Primary' }, tabs.map(([name, path, label, glyph]) => (
    h('a', {
      class: 'tab',
      href: formatHash(path),
      'aria-current': active === name ? 'page' : false,
    }, [icon(glyph), label])
  )));
}

function errorBlock() {
  const message = state.error || (!state.program ? state.unlockError : '');
  return message ? h('p', { class: 'alert', role: 'alert' }, message) : null;
}

function remember() {
  try {
    persist();
  } catch {
    state.error = 'Could not save on this phone (storage is blocked or full).';
    const save = document.getElementById('save-state');
    if (save) save.textContent = 'Not saved';
    return false;
  }
  const save = document.getElementById('save-state');
  if (save) save.textContent = 'Saved';
  return true;
}

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function renderEmpty() {
  document.title = 'Lift Log';
  return h('main', { class: 'screen', 'data-screen': 'empty' }, [
    h('h1', { class: 'screen-title' }, 'Lift Log'),
    h('p', {}, 'Open your personal link on this iPhone. The program stays on this device.'),
    errorBlock(),
    tabbar(''),
  ]);
}

function renderProgram() {
  document.title = 'Program · Lift Log';
  const list = entries();
  const next = model.nextUp(list, state.logs);
  const progress = model.workoutProgress(list, state.logs);
  const weeks = new Map();
  for (const entry of list) {
    if (!weeks.has(entry.week)) weeks.set(entry.week, []);
    weeks.get(entry.week).push(entry);
  }
  const hero = next
    ? h('section', { class: 'hero', 'data-testid': 'next-workout' }, [
      h('p', { class: 'eyebrow' }, 'Up next'),
      h('h2', {}, model.entryTitle(next)),
      model.entryFocus(next) ? h('p', { class: 'focus' }, model.entryFocus(next)) : null,
      h('p', { class: 'progress' }, `${progress.done} of ${progress.total} workouts checked off`),
      h('a', { class: 'btn primary wide', id: 'start-workout', href: formatHash(`/day/${next.week}/${next.day}`) }, 'Start'),
    ])
    : h('section', { class: 'hero', 'data-testid': 'next-workout' }, [
      h('p', { class: 'eyebrow' }, 'Up next'),
      h('h2', {}, 'All workouts are checked off'),
      h('p', { class: 'muted' }, 'Rest days stay in the list below.'),
    ]);
  const weekNodes = [...weeks.entries()].map(([week, days]) => {
    const done = days.filter((entry) => model.isComplete(state.logs, entry)).length;
    const details = h('details', { class: 'week' }, [
      h('summary', {}, [
        h('span', {}, `Week ${week}`),
        h('span', { class: 'faint' }, `${done}/${days.length}`),
      ]),
    ]);
    details.open = Boolean(next && next.week === week) || (!next && week === days[0]?.week);
    const links = h('div', { class: 'day-list' });
    for (const entry of days) {
      const complete = model.isComplete(state.logs, entry);
      const progressDay = model.isInProgress(state.logs, entry);
      const title = model.entryTitle(entry);
      const flag = model.entryFlag(entry);
      const session = state.logs.sessions[model.sessionId(entry)];
      const when = session?.date && (complete || progressDay) ? model.formatDisplayDate(session.date) : '';
      links.append(h('a', {
        class: 'day-link',
        href: formatHash(`/day/${entry.week}/${entry.day}`),
        'data-week': entry.week,
        'data-day': entry.day,
        'data-rest': model.isRestEntry(entry) ? 'true' : 'false',
        'data-schedule': model.isScheduleOnly(entry) ? 'true' : 'false',
        'data-flag': flag ? 'true' : 'false',
        'aria-label': `${title}${flag ? `, warning: ${flag}` : ''}${complete ? ', completed' : ''}${progressDay ? ', in progress' : ''}`,
      }, [
        h('span', { class: 'dow' }, (entry.dayOfWeek || '').slice(0, 3)),
        h('span', {}, [
          h('span', { class: 'day-name' }, [
            h('strong', {}, title),
            flag ? h('span', { class: 'flag-mark', 'data-testid': 'flag-mark', 'aria-hidden': 'true' }, '!') : null,
          ]),
          model.entryFocus(entry) ? h('small', {}, model.entryFocus(entry)) : null,
          when ? h('small', {}, when) : null,
          model.isRestEntry(entry) ? h('span', { class: 'pill' }, 'Rest') : null,
          model.isScheduleOnly(entry) ? h('span', { class: 'pill' }, 'Schedule') : null,
          progressDay ? h('span', { class: 'pill progress' }, 'In progress') : null,
        ]),
        h('span', { class: complete ? 'check on' : 'check', 'aria-hidden': 'true' }, complete ? '✓' : ''),
      ]));
    }
    details.append(links);
    return details;
  });
  return h('main', { class: 'screen', 'data-screen': 'home' }, [
    h('h1', { class: 'screen-title' }, 'Lift Log'),
    errorBlock(),
    hero,
    h('div', { class: 'links' }, [
      h('a', { class: 'btn', href: formatHash('/glossary') }, 'Glossary'),
      h('a', { class: 'btn', href: formatHash('/deload') }, 'Deload'),
    ]),
    h('section', { 'aria-label': 'All weeks' }, weekNodes),
    tabbar('program'),
  ]);
}

function loggedExercise(entry, exercise) {
  return state.logs.sessions[model.sessionId(entry)]?.exercises?.[model.normalizeName(exercise.name)] || null;
}

function exerciseCard(entry, exercise) {
  const info = model.classifyExercise(exercise);
  if (model.annotateLoggedExercise(state.logs, entry, exercise.name, info)) {
    try { persist(); } catch { /* shown on the next save */ }
  }
  const programmed = exercise.name;
  const record = loggedExercise(entry, exercise);
  const performed = record?.name || programmed;
  const logged = record?.sets || [];
  const count = model.visibleSetCount(exercise, logged.length);
  const previous = model.findPrevious(state.logs, entry, performed);
  const reps = model.repsArray(exercise);
  const tempo = model.cleanText(exercise.tempo);
  const rest = model.cleanText(exercise.rest);
  const card = h('article', {
    class: 'exercise',
    'data-exercise': model.normalizeName(programmed),
    'data-warmup': info.warmup ? 'true' : 'false',
  });
  const badges = [];
  if (info.warmup) badges.push(h('span', { class: 'badge' }, 'Warm-up'));
  if (info.drop) badges.push(h('span', { class: 'badge warn' }, 'Drop set'));
  if (info.superset) badges.push(h('span', { class: 'badge' }, 'Superset'));
  card.append(
    h('h2', { class: 'ex-title' }, [
      h('button', {
        class: 'ex-name',
        type: 'button',
        'data-action': 'history',
        'data-name': performed,
        'aria-label': `History for ${model.displayName(performed)}`,
      }, model.displayName(performed)),
    ]),
  );
  if (performed !== programmed && model.normalizeName(performed) !== model.normalizeName(programmed)) {
    card.append(h('p', { class: 'meta' }, `Programmed: ${model.displayName(programmed)}`));
  }
  if (badges.length) card.append(h('p', { class: 'badges' }, badges));
  card.append(h('p', { class: 'meta' }, [
    `${model.prescribedSets(exercise)} sets`,
    tempo ? `Tempo ${tempo}` : '',
    rest ? `Rest ${rest}` : '',
  ].filter(Boolean).join(' · ')));
  if (reps.length) card.append(h('ul', { class: 'prescription reps' }, reps.map((line) => h('li', {}, line))));
  if (info.text) card.append(h('p', { class: 'notes' }, info.text));
  const banner = previous
    ? h('p', { class: 'last-time', 'data-testid': 'last-time', 'data-date': previous.date }, `Last time · ${model.formatDisplayDate(previous.date)}`)
    : h('p', { class: 'last-time empty', 'data-testid': 'last-time' }, 'No previous log');
  card.append(banner);
  if (previous?.sets?.some((set) => model.cleanText(set.weight) || model.cleanText(set.reps))) {
    card.append(h('button', {
      class: 'btn wide',
      type: 'button',
      'data-action': 'same',
      'data-name': programmed,
      'data-performed': performed,
      'data-week': entry.week,
      'data-day': entry.day,
      'data-testid': 'same',
      'aria-label': `Same as last time, ${model.displayName(performed)}`,
    }, 'Same'));
  }
  for (let index = 0; index < count; index += 1) {
    card.append(setBlock(entry, exercise, index, logged[index], previous?.sets?.[index], info));
  }
  const actions = h('div', { class: 'actions' }, [
    h('button', {
      class: 'btn',
      type: 'button',
      'data-action': 'add-set',
      'data-name': programmed,
      'data-week': entry.week,
      'data-day': entry.day,
      'data-prescribed': model.prescribedSets(exercise),
    }, 'Add set'),
    h('button', {
      class: 'btn',
      type: 'button',
      'data-action': 'plates',
      'data-name': programmed,
      'data-performed': performed,
      'data-week': entry.week,
      'data-day': entry.day,
    }, 'Plates'),
  ]);
  if (info.substitutes.length) {
    actions.append(h('button', {
      class: 'btn',
      type: 'button',
      'data-action': 'swap',
      'data-name': programmed,
      'data-performed': performed,
      'data-week': entry.week,
      'data-day': entry.day,
      'aria-label': `Swap ${model.displayName(programmed)}`,
    }, 'Swap'));
  }
  if (logged.length > model.prescribedSets(exercise)) {
    actions.append(h('button', {
      class: 'btn ghost',
      type: 'button',
      'data-action': 'remove-set',
      'data-name': programmed,
      'data-week': entry.week,
      'data-day': entry.day,
      'data-prescribed': model.prescribedSets(exercise),
    }, 'Remove extra set'));
  }
  card.append(actions);
  const note = h('textarea', {
    'aria-label': `Note for ${model.displayName(performed)}`,
    'data-field': 'exercise-note',
    'data-name': programmed,
    'data-week': entry.week,
    'data-day': entry.day,
    rows: '2',
  });
  note.value = record?.note || '';
  const noteBlock = h('details', { class: 'note-block' }, [
    h('summary', {}, 'Exercise note'),
    note,
  ]);
  if (record?.note) noteBlock.open = true;
  card.append(noteBlock);
  return card;
}

function setBlock(entry, exercise, index, loggedSet = { weight: '', reps: '' }, prevSet, info) {
  const name = model.displayName(exercise.name);
  const unit = state.prefs.unit;
  const label = model.repForSet(exercise, index);
  const performedText = prevSet ? model.formatPerformed(prevSet, unit) : '';
  const weight = h('input', {
    inputmode: 'decimal',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    'aria-label': `Weight in ${unit === 'kg' ? 'kilograms' : 'pounds'}, set ${index + 1}, ${name}`,
    placeholder: model.displayWeight(prevSet, unit),
    'data-field': 'weight',
    'data-index': index,
    'data-name': exercise.name,
    'data-week': entry.week,
    'data-day': entry.day,
  });
  weight.value = model.displayWeight(loggedSet, unit);
  const repsInput = h('input', {
    inputmode: 'numeric',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    'aria-label': `Reps, set ${index + 1}, ${name}`,
    placeholder: model.cleanText(prevSet?.reps),
    'data-field': 'reps',
    'data-index': index,
    'data-name': exercise.name,
    'data-week': entry.week,
    'data-day': entry.day,
  });
  repsInput.value = loggedSet?.reps || '';
  const step = model.weightStep(unit);
  const kids = [
    h('div', { class: 'set-label' }, [
      h('span', {}, info.dropSetIndex === index ? `Set ${index + 1} · Drop` : `Set ${index + 1}`),
      label ? h('span', { class: 'rep-label' }, label) : null,
    ]),
    h('p', { class: 'prev', 'data-testid': 'prev-set' }, [
      h('span', {}, 'Last '),
      h('strong', {}, performedText || '—'),
    ]),
    h('div', { class: 'stepper' }, [
      stepButton('−', 'weight', -step, index, exercise, entry, 'Decrease weight'),
      weight,
      h('span', { class: 'unit' }, unit),
      stepButton('+', 'weight', step, index, exercise, entry, 'Increase weight'),
    ]),
    h('div', { class: 'stepper' }, [
      stepButton('−', 'reps', -1, index, exercise, entry, 'Decrease reps'),
      repsInput,
      stepButton('+', 'reps', 1, index, exercise, entry, 'Increase reps'),
      h('button', {
        class: 'set-done',
        type: 'button',
        'data-action': 'toggle-set',
        'data-index': index,
        'data-name': exercise.name,
        'data-week': entry.week,
        'data-day': entry.day,
        'aria-pressed': loggedSet?.done ? 'true' : 'false',
        'aria-label': `${loggedSet?.done ? 'Completed' : 'Mark'} set ${index + 1} done, ${name}`,
      }, loggedSet?.done ? 'Done' : 'Done'),
    ]),
  ];
  if (state.prefs.rpe) {
    const rpe = h('input', {
      inputmode: 'decimal',
      autocomplete: 'off',
      'aria-label': `RPE, set ${index + 1}, ${name}`,
      placeholder: 'RPE',
      'data-field': 'rpe',
      'data-index': index,
      'data-name': exercise.name,
      'data-week': entry.week,
      'data-day': entry.day,
    });
    rpe.value = loggedSet?.rpe || '';
    kids.push(h('div', { class: 'stepper' }, [
      h('span', { class: 'unit' }, 'RPE'),
      rpe,
    ]));
  }
  return h('div', { class: 'set-block' }, kids);
}

function stepButton(symbol, field, delta, index, exercise, entry, label) {
  return h('button', {
    class: 'step',
    type: 'button',
    'data-step': delta,
    'data-field': field,
    'data-index': index,
    'data-name': exercise.name,
    'data-week': entry.week,
    'data-day': entry.day,
    'aria-label': `${label}, set ${index + 1}, ${model.displayName(exercise.name)}`,
  }, symbol);
}

function renderDay(route) {
  const entry = findEntry(route.week, route.day);
  if (!entry) {
    document.title = 'Day · Lift Log';
    return h('main', { class: 'screen', 'data-screen': 'day' }, [
      h('h1', {}, 'That day is not in the program.'),
      h('a', { class: 'btn', href: formatHash('/program') }, 'Program'),
      tabbar('train'),
    ]);
  }
  const title = model.entryTitle(entry);
  document.title = `${title} · Lift Log`;
  const session = state.logs.sessions[model.sessionId(entry)] || null;
  const complete = session?.completed === true;
  const dateInput = h('input', {
    type: 'date',
    'aria-label': 'Performed date',
    'data-field': 'date',
    'data-week': entry.week,
    'data-day': entry.day,
  });
  dateInput.value = session?.date || model.isoDate();
  const page = model.entryPage(entry);
  const pageNote = entry.source === 'day' ? model.cleanText(entry.record.pageNote) : '';
  const footerNote = entry.source === 'day' ? model.cleanText(entry.record.footerNote) : '';
  const flag = model.entryFlag(entry);
  const classes = ['screen', 'with-dock'];
  if (state.timer) classes.push('with-timer');
  const children = [
    h('header', { class: 'nav' }, [
      h('a', { class: 'nav-back', href: formatHash('/program') }, 'Program'),
    ]),
    h('p', { class: 'eyebrow' }, entry.dayOfWeek || `Day ${entry.day}`),
    h('h1', { class: 'screen-title', id: 'day-title' }, title),
    flag ? h('p', { class: 'day-flag', 'data-testid': 'day-flag' }, flag) : null,
    model.entryFocus(entry) ? h('p', { class: 'focus' }, model.entryFocus(entry)) : null,
    h('p', { class: 'meta' }, [page != null ? `Page ${page}` : '', entry.dayOfWeek || ''].filter(Boolean).join(' · ')),
    errorBlock(),
    h('label', { class: 'field-label' }, ['Performed', dateInput]),
    h('p', { class: 'save-state', id: 'save-state', 'aria-live': 'polite' }, ''),
  ];
  const dayNote = h('textarea', {
    'aria-label': 'Note for this day',
    'data-field': 'day-note',
    'data-week': entry.week,
    'data-day': entry.day,
    rows: '2',
  });
  dayNote.value = session?.note || '';
  const dayNoteBlock = h('details', { class: 'note-block' }, [h('summary', {}, 'Day note'), dayNote]);
  if (session?.note) dayNoteBlock.open = true;
  if (pageNote) children.push(h('section', { class: 'callout', 'data-testid': 'page-note' }, [h('p', {}, pageNote)]));
  if (model.isRestEntry(entry)) {
    const lines = model.restLines(entry);
    children.push(h('section', { class: 'rest-copy card', 'data-testid': 'rest-text' }, (
      lines.length ? lines.map((line) => h('p', {}, line)) : [h('p', { class: 'muted' }, 'Rest day.')]
    )));
  } else if (model.isScheduleOnly(entry)) {
    const deload = model.deloadView(state.program);
    children.push(h('section', { class: 'deload-copy card', 'data-testid': 'schedule-deload' }, [
      h('p', { class: 'eyebrow' }, deload.title || 'Deload'),
      deload.page != null ? h('p', { class: 'meta' }, `Page ${deload.page}`) : null,
      ...(deload.blocks.length ? deload.blocks.map((block) => h('p', {}, block)) : [h('p', { class: 'muted' }, 'No deload text in this program.')]),
    ]));
  } else {
    const exercises = entry.record.exercises || [];
    const groups = [];
    for (let i = 0; i < exercises.length; i += 1) {
      const info = model.classifyExercise(exercises[i]);
      const nextInfo = exercises[i + 1] ? model.classifyExercise(exercises[i + 1]) : null;
      if (info.superset && nextInfo?.superset) {
        groups.push([exercises[i], exercises[i + 1]]);
        i += 1;
      } else groups.push([exercises[i]]);
    }
    if (!exercises.length) children.push(h('p', { class: 'muted' }, 'No exercises on this day.'));
    for (const group of groups) {
      const cards = group.map((exercise) => exerciseCard(entry, exercise));
      if (group.length > 1) {
        children.push(h('section', { class: 'superset', 'aria-label': 'Superset' }, [
          h('p', { class: 'badge' }, 'Superset'),
          ...cards,
        ]));
      } else children.push(cards[0]);
    }
  }
  children.push(dayNoteBlock);
  if (footerNote) children.push(h('section', { class: 'callout', 'data-testid': 'footer-note' }, [h('p', {}, footerNote)]));
  const main = h('main', {
    class: classes.join(' '),
    'data-screen': 'day',
    'data-week': entry.week,
    'data-day': entry.day,
  }, children);
  if (state.timer) main.append(timerView());
  main.append(h('div', { class: 'dock' }, [
    h('button', {
      class: 'btn primary wide',
      type: 'button',
      id: 'toggle-complete',
      'data-action': 'toggle-complete',
      'data-week': entry.week,
      'data-day': entry.day,
      'aria-pressed': complete ? 'true' : 'false',
    }, complete ? 'Completed · Undo' : 'Mark day complete'),
  ]));
  main.append(tabbar('train'));
  if (state.sheet) main.append(sheetView(entry));
  return main;
}

function timerView() {
  const timer = state.timer;
  const left = timer.running ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000)) : Math.ceil(timer.remaining / 1000);
  const ratio = timer.total ? Math.max(0, Math.min(1, (timer.running ? timer.endsAt - Date.now() : timer.remaining) / (timer.total * 1000))) : 0;
  const bar = h('span', { id: 'rest-progress' });
  bar.style.transform = `scaleX(${ratio})`;
  return h('section', { class: 'timer', 'data-testid': 'rest-timer', 'aria-label': 'Rest timer' }, [
    h('div', { class: 'timer-top' }, [
      h('p', { id: 'rest-status' }, timer.fired ? 'Rest complete' : (timer.label || 'Rest')),
      h('p', { id: 'rest-time' }, model.formatClock(left)),
    ]),
    h('div', { class: 'timer-track' }, bar),
    h('p', { id: 'rest-live', class: 'sr', 'aria-live': 'assertive' }, timer.fired ? 'Rest complete' : ''),
    h('div', { class: 'timer-actions' }, [
      h('button', { class: 'btn', type: 'button', 'data-action': 'timer-pause' }, timer.running ? 'Pause' : 'Resume'),
      h('button', { class: 'btn', type: 'button', 'data-action': 'timer-add' }, '+30s'),
      h('button', { class: 'btn', type: 'button', 'data-action': 'timer-dismiss' }, 'Dismiss'),
    ]),
  ]);
}

function renderGlossary() {
  document.title = 'Glossary · Lift Log';
  const items = model.glossaryEntries(state.program);
  return h('main', { class: 'screen glossary', 'data-screen': 'glossary' }, [
    h('a', { class: 'nav-back', href: formatHash('/program') }, 'Program'),
    h('h1', { class: 'screen-title' }, 'Glossary'),
    items.length
      ? h('div', { class: 'stack' }, items.map((item) => h('article', { class: 'card' }, [
        h('h2', {}, item.term),
        h('p', {}, item.text),
      ])))
      : h('p', { class: 'muted' }, 'No glossary in this program.'),
    tabbar('program'),
  ]);
}

function renderDeload() {
  document.title = 'Deload · Lift Log';
  const deload = model.deloadView(state.program);
  return h('main', { class: 'screen', 'data-screen': 'deload' }, [
    h('a', { class: 'nav-back', href: formatHash('/program') }, 'Program'),
    h('h1', { class: 'screen-title' }, deload.title || 'Deload'),
    deload.page != null ? h('p', { class: 'meta' }, `Page ${deload.page}`) : null,
    deload.blocks.length
      ? h('section', { class: 'card' }, deload.blocks.map((block) => h('p', {}, block)))
      : h('p', { class: 'muted' }, 'No deload text in this program.'),
    tabbar('program'),
  ]);
}

function renderSettings() {
  document.title = 'Settings · Lift Log';
  const backup = h('input', { id: 'backup-file', type: 'file', accept: 'application/json,.json', 'aria-label': 'Choose backup JSON' });
  const programFile = h('input', { id: 'program-file', type: 'file', accept: 'application/json,.json', 'aria-label': 'Choose a program JSON file' });
  const paste = h('textarea', { id: 'paste-json', 'aria-label': 'Paste program JSON', spellcheck: 'false' });
  paste.value = state.draft;
  return h('main', { class: 'screen settings', 'data-screen': 'settings' }, [
    h('h1', { class: 'screen-title' }, 'Settings'),
    errorBlock(),
    h('section', { class: 'card stack' }, [
      h('h2', {}, 'Units'),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Weight unit' }, [
        h('button', { type: 'button', 'data-action': 'unit', 'data-unit': 'lb', 'aria-pressed': state.prefs.unit === 'lb' ? 'true' : 'false' }, 'lb'),
        h('button', { type: 'button', 'data-action': 'unit', 'data-unit': 'kg', 'aria-pressed': state.prefs.unit === 'kg' ? 'true' : 'false' }, 'kg'),
      ]),
      h('button', {
        class: 'switch-row',
        type: 'button',
        role: 'switch',
        'aria-checked': state.prefs.rpe ? 'true' : 'false',
        'data-action': 'toggle-rpe',
      }, [h('span', {}, 'Log RPE'), h('span', { class: 'switch', 'aria-hidden': 'true' })]),
      h('p', { class: 'small muted' }, 'Off by default, so a set stays one tap. Turn it on when you want RPE on each set.'),
    ]),
    h('section', { class: 'card stack' }, [
      h('h2', {}, 'Rest timer'),
      h('button', {
        class: 'switch-row',
        type: 'button',
        role: 'switch',
        'aria-checked': state.prefs.sound ? 'true' : 'false',
        'data-action': 'toggle-sound',
      }, [h('span', {}, 'Sound'), h('span', { class: 'switch', 'aria-hidden': 'true' })]),
      h('button', {
        class: 'switch-row',
        type: 'button',
        role: 'switch',
        'aria-checked': state.prefs.notify ? 'true' : 'false',
        'data-action': 'toggle-notify',
      }, [h('span', {}, 'Background alert'), h('span', { class: 'switch', 'aria-hidden': 'true' })]),
      h('p', { class: 'small muted' }, 'The timer plays a sound while Lift Log is on screen. iPhone doesn’t vibrate for a Home Screen web app, and it won’t reliably alert you if you leave or lock the phone.'),
    ]),
    h('section', { class: 'card stack' }, [
      h('h2', {}, 'Export'),
      h('p', { class: 'small muted' }, 'CSV columns: date, week, day, workout, exercise, set, weight, reps, completed_day. The JSON backup also keeps notes, RPE, and units.'),
      h('button', { class: 'btn primary wide', type: 'button', id: 'export-csv', 'data-action': 'export-csv' }, 'Download CSV'),
      h('button', { class: 'btn wide', type: 'button', id: 'share-csv', 'data-action': 'share-csv' }, 'Share CSV'),
      h('button', { class: 'btn wide', type: 'button', id: 'export-json', 'data-action': 'export-json' }, 'Download backup'),
    ]),
    h('section', { class: 'card stack' }, [
      h('h2', {}, 'Restore'),
      h('p', { class: 'small muted' }, 'A backup replaces the program and the logs stored on this phone.'),
      h('label', { class: 'btn wide file-btn' }, [backup, 'Restore backup']),
    ]),
    h('section', { class: 'card stack' }, [
      h('h2', {}, 'Home Screen'),
      h('p', { class: 'small muted' }, 'In Safari, open your personal link, tap Share, then Add to Home Screen. The program loads into the Home Screen app the first time you open the icon.'),
    ]),
    h('details', { class: 'card', 'data-testid': 'advanced' }, [
      h('summary', {}, 'Advanced'),
      h('div', { class: 'stack' }, [
        h('p', { class: 'small muted' }, state.program ? model.programLabel(state.program) : 'No program on this phone yet.'),
        h('p', { class: 'small muted' }, 'Replacing the program keeps the sets already logged on this phone.'),
        h('label', { class: 'btn wide file-btn' }, [programFile, 'Choose a program file']),
        paste,
        h('button', { class: 'btn wide', type: 'button', 'data-action': 'paste-program' }, 'Load pasted JSON'),
      ]),
    ]),
    h('p', { class: 'small muted' }, 'Lift Log does not create an account or send analytics. The program and logs stay on this phone, including offline.'),
    tabbar('settings'),
  ]);
}

function sheetView(entry) {
  const sheet = state.sheet;
  if (!sheet) return null;
  let body = [];
  let title = '';
  if (sheet.kind === 'history') {
    title = model.displayName(sheet.name);
    const series = model.historySeries(state.logs, sheet.name);
    const best = model.bestEffort(state.logs, sheet.name);
    const warmup = sheet.warmup === true;
    body = [
      warmup ? h('p', {}, 'Warm-up sets stay out of PRs.') : null,
      best ? h('p', { class: 'meta' }, [
        best.e1rm ? `Est. 1RM ${model.convertWeight(best.e1rm, best.unit, state.prefs.unit)} ${state.prefs.unit}` : `Best set ${model.formatPerformed(best, state.prefs.unit)}`,
        model.formatDisplayDate(best.date),
      ].filter(Boolean).join(' · ')) : null,
      series.length ? historyChart(series) : null,
      series.length ? historyTable(series) : h('p', { class: 'muted' }, warmup ? 'No working sets yet.' : 'No working sets logged yet.'),
    ];
  } else if (sheet.kind === 'plates') {
    title = 'Plates per side';
    const plan = model.platePlan(sheet.weight, state.prefs.unit);
    body = [
      h('p', { class: 'meta' }, Number.isFinite(Number(sheet.weight)) ? `${sheet.weight} ${state.prefs.unit}` : 'Enter a weight first.'),
      plan.empty ? h('p', {}, 'Enter a weight, then open Plates.') : null,
      plan.underBar ? h('p', {}, `Under a ${plan.bar} ${plan.unit} bar.`) : null,
      !plan.empty && !plan.underBar ? h('p', {}, `${plan.bar} ${plan.unit} bar`) : null,
      !plan.empty && !plan.underBar ? h('div', { class: 'plates' }, plan.perSide.length
        ? plan.perSide.map((plate) => h('span', { class: 'plate' }, String(plate)))
        : [h('span', {}, 'Bar only')]) : null,
      plan.remainder ? h('p', {}, `${plan.remainder} ${plan.unit} left over per side.`) : null,
    ];
  } else if (sheet.kind === 'swap') {
    title = 'Swap exercise';
    const options = [sheet.programmed, ...sheet.options.filter((option) => model.normalizeName(option) !== model.normalizeName(sheet.programmed))];
    body = [
      h('div', { class: 'sheet-list' }, options.map((option) => h('button', {
        class: 'sheet-option',
        type: 'button',
        'data-action': 'choose-swap',
        'data-name': sheet.programmed,
        'data-choice': option,
        'data-week': entry?.week,
        'data-day': entry?.day,
        'aria-pressed': model.normalizeName(option) === model.normalizeName(sheet.performed) ? 'true' : 'false',
      }, model.displayName(option)))),
    ];
  }
  return h('dialog', { class: 'sheet', 'data-testid': `${sheet.kind}-sheet`, 'aria-labelledby': 'sheet-title' }, [
    h('div', { class: 'grabber', 'aria-hidden': 'true' }),
    h('h2', { id: 'sheet-title' }, title),
    ...body,
    h('button', { class: 'btn primary wide', type: 'button', 'data-action': 'close-sheet' }, 'Done'),
  ]);
}

function historyChart(series) {
  const values = series.map((point) => Number(model.convertWeight(point.best?.weight || 0, point.best?.unit || 'lb', state.prefs.unit)) || 0);
  const max = Math.max(...values, 1);
  const width = 320;
  const height = 96;
  const gap = values.length > 1 ? 8 : 0;
  const barW = Math.min(28, Math.max(8, (width - gap * (values.length - 1)) / values.length));
  const offset = (width - (values.length * barW + gap * Math.max(0, values.length - 1))) / 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chart');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  values.forEach((value, index) => {
    const barH = Math.max(4, (value / max) * (height - 8));
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(offset + index * (barW + gap)));
    rect.setAttribute('y', String(height - barH));
    rect.setAttribute('width', String(barW));
    rect.setAttribute('height', String(barH));
    rect.setAttribute('rx', '3');
    svg.append(rect);
  });
  return svg;
}

function historyTable(series) {
  return h('div', { class: 'stack' }, series.slice().reverse().map((point) => {
    const sets = point.sets.filter((set) => set.filled && !set.drop)
      .map((set) => model.formatPerformed(set, state.prefs.unit))
      .filter(Boolean)
      .join(', ');
    const estimate = point.best?.e1rm
      ? `Est. 1RM ${model.convertWeight(point.best.e1rm, point.best.unit, state.prefs.unit)} ${state.prefs.unit}`
      : '';
    return h('article', { class: 'card' }, [
      h('h3', { class: 'meta' }, model.formatDisplayDate(point.date)),
      h('p', {}, sets || '—'),
      estimate ? h('p', { class: 'meta' }, estimate) : null,
    ]);
  }));
}

function render() {
  const route = currentRoute();
  const routeKey = `${route.name}:${route.week || ''}:${route.day || ''}`;
  if (shownRoute && shownRoute !== routeKey) state.error = '';
  const focus = routeKey !== lastFocused;
  shownRoute = routeKey;
  lastFocused = routeKey;
  let view;
  try {
    if (!state.program && route.name !== 'settings') view = renderEmpty();
    else if (route.name === 'train') {
      if (state.program) {
        const next = model.nextUp(entries(), state.logs);
        if (next && replaceHash(`/day/${next.week}/${next.day}`)) return;
        if (!next && replaceHash('/program')) return;
      }
      view = renderEmpty();
    } else if (route.name === 'program') view = renderProgram();
    else if (route.name === 'day') view = renderDay(route);
    else if (route.name === 'glossary') view = renderGlossary();
    else if (route.name === 'deload') view = renderDeload();
    else view = renderSettings();
  } catch (error) {
    console.error(error);
    view = h('main', { class: 'screen', 'data-screen': 'empty' }, [
      h('h1', { class: 'screen-title' }, 'Lift Log'),
      h('p', { class: 'alert', role: 'alert' }, 'Lift Log hit a problem and recovered. Your logs are still on this phone.'),
    ]);
  }
  app.replaceChildren(view);
  const dialog = app.querySelector('dialog.sheet');
  if (dialog && !dialog.open) {
    try { dialog.showModal(); } catch { /* the dialog was already removed */ }
  }
  if (focus) window.scrollTo(0, 0);
  if (focus && !dialog) {
    const heading = app.querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }
}

function entryFrom(node) {
  return findEntry(Number(node.dataset.week), Number(node.dataset.day));
}

function onSetEdit(input, value) {
  const entry = entryFrom(input);
  if (!entry) return;
  model.setLoggedSet(
    state.logs,
    entry,
    input.dataset.name,
    Number(input.dataset.index),
    input.dataset.field,
    value,
    Date.now(),
    state.prefs.unit,
  );
  const sanitized = input.dataset.field === 'weight'
    ? model.sanitizeWeight(value)
    : input.dataset.field === 'reps'
      ? model.sanitizeReps(value)
      : model.sanitizeRpe(value);
  if (input.value !== sanitized) input.value = sanitized;
  remember();
}

function weightForPlates(entry, programmed, performed) {
  const sets = loggedExercise(entry, { name: programmed })?.sets || [];
  const filled = sets.find((set) => model.cleanText(set.weight));
  if (filled) return model.displayWeight(filled, state.prefs.unit);
  const previous = model.findPrevious(state.logs, entry, performed || programmed);
  const prev = previous?.sets?.find((set) => model.cleanText(set.weight));
  return prev ? model.displayWeight(prev, state.prefs.unit) : '';
}

function startTimer(exercise, setIndex) {
  const timing = model.restAfterSet(exercise, setIndex);
  if (!timing?.seconds) return;
  state.timer = {
    endsAt: Date.now() + timing.seconds * 1000,
    total: timing.seconds,
    remaining: timing.seconds * 1000,
    running: true,
    fired: false,
    label: timing.label || 'Rest',
  };
  try { sessionStorage.setItem('liftlog.timer', JSON.stringify(state.timer)); } catch { /* ignore */ }
  requestWake();
  ensureTimerLoop();
}

function ensureTimerLoop() {
  if (timerHandle) return;
  timerHandle = window.setInterval(tickTimer, 250);
}

function tickTimer() {
  const timer = state.timer;
  if (!timer || !timer.running) return;
  const leftMs = timer.endsAt - Date.now();
  const left = Math.max(0, Math.ceil(leftMs / 1000));
  const time = document.getElementById('rest-time');
  if (time) time.textContent = model.formatClock(left);
  const bar = document.getElementById('rest-progress');
  if (bar && timer.total) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, leftMs / (timer.total * 1000)))})`;
  if (left <= 0 && !timer.fired) {
    timer.fired = true;
    timer.running = false;
    try { sessionStorage.setItem('liftlog.timer', JSON.stringify(timer)); } catch { /* ignore */ }
    releaseWake();
    const status = document.getElementById('rest-status');
    if (status) status.textContent = 'Rest complete';
    const live = document.getElementById('rest-live');
    if (live) live.textContent = 'Rest complete';
    chime();
  }
}

function chime() {
  if (state.prefs.sound) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
        osc.onended = () => ctx.close();
      }
    } catch { /* sound is optional */ }
  }
  try { navigator.vibrate?.([180, 80, 180]); } catch { /* iOS does not vibrate */ }
  if (state.prefs.notify && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready.then((reg) => {
      reg.showNotification('Rest complete', { body: 'Next set.', tag: 'liftlog-rest' }).catch(() => {});
    }).catch(() => {});
  }
}

async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not available */ }
}

function releaseWake() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function restoreTimer() {
  try {
    const raw = sessionStorage.getItem('liftlog.timer');
    if (!raw) return;
    const timer = JSON.parse(raw);
    if (!timer || typeof timer.endsAt !== 'number') return;
    if (timer.running && timer.endsAt <= Date.now()) return;
    state.timer = timer;
    if (timer.running) requestWake();
  } catch { /* ignore a bad timer blob */ }
}

async function readTextFile(file) {
  return (await file.text()).replace(/^\uFEFF/, '');
}

async function ingestProgramText(text, replacing) {
  let data;
  try { data = JSON.parse(String(text).trim()); }
  catch {
    state.error = 'That is not valid JSON.';
    render();
    return;
  }
  try { model.validateProgram(data); }
  catch (error) {
    state.error = error.message || 'That program could not be read.';
    render();
    return;
  }
  if (replacing && state.program && !window.confirm('Replace the program stored on this phone? Your logged sets are kept.')) return;
  state.program = data;
  state.error = '';
  state.unlockError = '';
  state.draft = '';
  try { persist(); }
  catch {
    state.error = 'Could not save on this phone (storage is blocked or full).';
    render();
    return;
  }
  const next = model.nextUp(entries(), state.logs);
  go(next ? `/day/${next.week}/${next.day}` : '/program');
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportPayload() {
  return {
    kind: 'lift-log-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    program: state.program,
    logs: state.logs,
    prefs: state.prefs,
  };
}

async function shareCsv() {
  const csv = model.buildCsv(entries(), state.logs);
  const name = `lift-log-${model.isoDate()}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Lift log' });
      return;
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return;
  }
  download(name, csv, 'text/csv');
}

async function loadEnvelope() {
  // Tests inject the ciphertext because a controlling service worker on WebKit
  // serves site/program.enc.json from its own cache, which route mocks cannot replace.
  const injected = window.__LIFTLOG_ENVELOPE__;
  if (injected && typeof injected === 'object' && injected.ct) return injected;
  let response;
  try {
    response = await fetch('./program.enc.json');
  } catch {
    if (!state.program) state.unlockError = FETCH_ERROR;
    return null;
  }
  if (!response.ok) {
    if (!state.program) state.unlockError = FETCH_ERROR;
    return null;
  }
  try {
    return await response.json();
  } catch {
    if (!state.program) state.unlockError = FETCH_ERROR;
    return null;
  }
}

async function unlock(key) {
  const envelope = await loadEnvelope();
  if (!envelope) return Boolean(state.program);
  try {
    const program = await decryptProgram(envelope, key);
    model.validateProgram(program);
    state.program = program;
    state.unlockError = '';
    state.error = '';
    persist();
    return true;
  } catch {
    if (!state.program) state.unlockError = KEY_ERROR;
    return Boolean(state.program);
  }
}

function notifyInstallKey(key) {
  if (!('serviceWorker' in navigator) || !/^[A-Za-z0-9_-]{43}$/.test(key)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    navigator.serviceWorker.ready.then((reg) => {
      const worker = reg.active;
      if (!worker) {
        clearTimeout(timer);
        resolve();
        return;
      }
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve();
      };
      worker.postMessage({ type: 'install-key', key }, [channel.port2]);
    }).catch(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function prepareInstall(key) {
  if (!('serviceWorker' in navigator)) return 'ready';
  const had = !!navigator.serviceWorker.controller;
  try {
    await navigator.serviceWorker.register('./sw.js');
    await notifyInstallKey(key);
  } catch {
    return 'ready';
  }
  let reloaded = false;
  try { reloaded = sessionStorage.getItem('liftlog.reloadedForInstall') === '1'; }
  catch { reloaded = true; }
  if (!had && !reloaded) {
    try { sessionStorage.setItem('liftlog.reloadedForInstall', '1'); }
    catch { return 'ready'; }
    location.reload();
    return 'reloading';
  }
  return 'ready';
}

function exerciseByName(entry, name) {
  return (entry?.record?.exercises || []).find((exercise) => exercise.name === name)
    || (entry?.record?.exercises || []).find((exercise) => model.normalizeName(exercise.name) === model.normalizeName(name));
}

app.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'paste-json') {
    state.draft = target.value;
    return;
  }
  if (target.dataset.field === 'weight' || target.dataset.field === 'reps' || target.dataset.field === 'rpe') {
    onSetEdit(target, target.value);
  }
  if (target.dataset.field === 'day-note') {
    const entry = entryFrom(target);
    if (!entry) return;
    model.setDayNote(state.logs, entry, target.value);
    remember();
  }
  if (target.dataset.field === 'exercise-note') {
    const entry = entryFrom(target);
    if (!entry) return;
    model.setExerciseNote(state.logs, entry, target.dataset.name, target.value);
    remember();
  }
});

app.addEventListener('change', async (event) => {
  const target = event.target;
  if (target.id === 'program-file' && target.files?.[0]) {
    const text = await readTextFile(target.files[0]);
    target.value = '';
    await ingestProgramText(text, Boolean(state.program));
    return;
  }
  if (target.id === 'backup-file' && target.files?.[0]) {
    const text = await readTextFile(target.files[0]);
    target.value = '';
    let data;
    try { data = JSON.parse(text.trim()); }
    catch {
      state.error = 'That backup is not valid JSON.';
      render();
      return;
    }
    let parsed;
    try { parsed = model.parseBackup(data); }
    catch (error) {
      state.error = error.message || 'That backup could not be read.';
      render();
      return;
    }
    if (!window.confirm('Restore this backup? It replaces the program and logs on this phone.')) return;
    state.program = parsed.program;
    state.logs = model.migrateLogs(parsed.logs);
    if (parsed.prefs?.unit === 'lb' || parsed.prefs?.unit === 'kg') state.prefs.unit = parsed.prefs.unit;
    state.error = '';
    state.unlockError = '';
    try { persist(); }
    catch { state.error = 'Could not save on this phone (storage is blocked or full).'; }
    go('/');
    return;
  }
  if (target.dataset.field === 'date') {
    const entry = entryFrom(target);
    if (!entry) return;
    model.setSessionDate(state.logs, entry, target.value);
    remember();
    render();
  }
});

app.addEventListener('click', async (event) => {
  const dialog = event.target.closest('dialog.sheet');
  if (dialog && event.target === dialog) {
    state.sheet = null;
    render();
    return;
  }
  const step = event.target.closest('[data-step]');
  if (step) {
    const field = step.dataset.field;
    const candidates = app.querySelectorAll(
      `input[data-field="${field}"][data-index="${step.dataset.index}"][data-week="${step.dataset.week}"][data-day="${step.dataset.day}"]`,
    );
    const input = [...candidates].find((item) => item.dataset.name === step.dataset.name);
    if (!input) return;
    const next = field === 'weight'
      ? model.stepWeight(input.value, Number(step.dataset.step), input.placeholder)
      : model.stepReps(input.value, Number(step.dataset.step), input.placeholder);
    input.value = next;
    onSetEdit(input, next);
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const name = action.dataset.action;
  if (name === 'paste-program') {
    const field = document.getElementById('paste-json');
    await ingestProgramText(field ? field.value : state.draft, Boolean(state.program));
    return;
  }
  if (name === 'unit') {
    state.prefs.unit = action.dataset.unit === 'kg' ? 'kg' : 'lb';
    remember();
    render();
    return;
  }
  if (name === 'toggle-rpe') {
    state.prefs.rpe = !state.prefs.rpe;
    remember();
    render();
    return;
  }
  if (name === 'toggle-sound') {
    state.prefs.sound = !state.prefs.sound;
    remember();
    render();
    return;
  }
  if (name === 'toggle-notify') {
    if (!state.prefs.notify) {
      if (typeof Notification === 'undefined' || !navigator.serviceWorker) {
        state.error = 'Background alerts are not available on this iPhone. The timer still rings while Lift Log is open.';
        render();
        return;
      }
      const result = await Notification.requestPermission();
      state.prefs.notify = result === 'granted';
      state.error = result === 'granted' ? '' : 'Notifications stay off. The timer still rings while Lift Log is open.';
    } else state.prefs.notify = false;
    remember();
    render();
    return;
  }
  if (name === 'add-set' || name === 'remove-set') {
    const entry = entryFrom(action);
    if (!entry) return;
    const prescribed = Number(action.dataset.prescribed);
    if (name === 'add-set') model.addEmptySet(state.logs, entry, action.dataset.name, prescribed);
    else model.removeLastExtraSet(state.logs, entry, action.dataset.name, prescribed);
    remember();
    render();
    return;
  }
  if (name === 'toggle-set') {
    const entry = entryFrom(action);
    if (!entry) return;
    const exercise = exerciseByName(entry, action.dataset.name);
    if (!exercise) return;
    const index = Number(action.dataset.index);
    const record = loggedExercise(entry, exercise);
    const current = record?.sets?.[index];
    const done = !current?.done;
    if (done && !model.cleanText(current?.weight) && !model.cleanText(current?.reps)) {
      const previous = model.findPrevious(state.logs, entry, record?.name || exercise.name);
      const prevSet = previous?.sets?.[index];
      if (prevSet) {
        if (model.cleanText(prevSet.weight)) {
          model.setLoggedSet(state.logs, entry, exercise.name, index, 'weight', model.convertWeight(prevSet.weight, prevSet.unit || 'lb', state.prefs.unit), Date.now(), state.prefs.unit);
        }
        if (model.cleanText(prevSet.reps)) model.setLoggedSet(state.logs, entry, exercise.name, index, 'reps', prevSet.reps);
      }
    }
    model.setSetDone(state.logs, entry, exercise.name, index, done);
    if (done) startTimer(exercise, index);
    remember();
    render();
    return;
  }
  if (name === 'same') {
    const entry = entryFrom(action);
    if (!entry) return;
    const previous = model.findPrevious(state.logs, entry, action.dataset.performed || action.dataset.name);
    model.applySame(state.logs, entry, action.dataset.name, previous, state.prefs.unit);
    if (action.dataset.performed && model.normalizeName(action.dataset.performed) !== model.normalizeName(action.dataset.name)) {
      model.setPerformedName(state.logs, entry, action.dataset.name, action.dataset.performed);
    }
    remember();
    render();
    return;
  }
  if (name === 'toggle-complete') {
    const entry = entryFrom(action);
    if (!entry) return;
    const session = state.logs.sessions[model.sessionId(entry)];
    model.setCompleted(state.logs, entry, !session?.completed);
    remember();
    render();
    return;
  }
  if (name === 'history') {
    const entry = findEntry(Number(currentRoute().week), Number(currentRoute().day));
    const exercise = entry ? exerciseByName(entry, action.dataset.name) : null;
    const info = exercise ? model.classifyExercise(exercise) : null;
    state.sheet = { kind: 'history', name: action.dataset.name, warmup: info?.warmup === true };
    render();
    return;
  }
  if (name === 'plates') {
    const entry = entryFrom(action);
    state.sheet = {
      kind: 'plates',
      weight: entry ? weightForPlates(entry, action.dataset.name, action.dataset.performed) : '',
    };
    render();
    return;
  }
  if (name === 'swap') {
    const entry = entryFrom(action);
    const exercise = exerciseByName(entry, action.dataset.name);
    const info = model.classifyExercise(exercise);
    state.sheet = {
      kind: 'swap',
      programmed: exercise?.name || action.dataset.name,
      performed: action.dataset.performed || action.dataset.name,
      options: info.substitutes,
    };
    render();
    return;
  }
  if (name === 'choose-swap') {
    const entry = entryFrom(action);
    if (entry) {
      model.setPerformedName(state.logs, entry, action.dataset.name, action.dataset.choice);
      remember();
    }
    state.sheet = null;
    render();
    return;
  }
  if (name === 'close-sheet') {
    state.sheet = null;
    render();
    return;
  }
  if (name === 'timer-pause' && state.timer) {
    if (state.timer.running) {
      state.timer.remaining = Math.max(0, state.timer.endsAt - Date.now());
      state.timer.running = false;
      releaseWake();
    } else if (!state.timer.fired) {
      state.timer.endsAt = Date.now() + state.timer.remaining;
      state.timer.running = true;
      requestWake();
    }
    try { sessionStorage.setItem('liftlog.timer', JSON.stringify(state.timer)); } catch { /* ignore */ }
    render();
    return;
  }
  if (name === 'timer-add' && state.timer) {
    state.timer.total += 30;
    state.timer.fired = false;
    if (state.timer.running) state.timer.endsAt += 30000;
    else {
      state.timer.remaining += 30000;
      state.timer.endsAt = Date.now() + state.timer.remaining;
      state.timer.running = true;
      requestWake();
    }
    try { sessionStorage.setItem('liftlog.timer', JSON.stringify(state.timer)); } catch { /* ignore */ }
    render();
    return;
  }
  if (name === 'timer-dismiss') {
    state.timer = null;
    try { sessionStorage.removeItem('liftlog.timer'); } catch { /* ignore */ }
    releaseWake();
    render();
    return;
  }
  if (name === 'export-csv') {
    download(`lift-log-${model.isoDate()}.csv`, model.buildCsv(entries(), state.logs), 'text/csv');
    return;
  }
  if (name === 'share-csv') {
    shareCsv();
    return;
  }
  if (name === 'export-json') {
    download(`lift-log-backup-${model.isoDate()}.json`, JSON.stringify(exportPayload(), null, 2), 'application/json');
  }
});

window.addEventListener('hashchange', () => {
  if (state.ready) render();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.timer?.running) requestWake();
});

async function boot() {
  loadStored();
  restoreTimer();
  const parsed = model.parseHash(location.hash);
  if (parsed.key) state.key = parsed.key;
  if (state.key && state.key.length === 43) {
    const install = await prepareInstall(state.key);
    if (install === 'reloading') return;
  } else if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (parsed.key) await unlock(parsed.key);
  state.ready = true;
  document.documentElement.dataset.standalone = isStandalone() ? 'true' : 'false';
  ensureTimerLoop();
  const route = model.parseHash(location.hash);
  if (state.key && !route.key && route.route !== '/') {
    if (replaceHash(route.route)) return;
  }
  if (route.route === '/' && state.program) {
    const next = model.nextUp(entries(), state.logs);
    if (next && replaceHash(`/day/${next.week}/${next.day}`)) return;
    if (replaceHash('/program')) return;
  }
  render();
}

boot();

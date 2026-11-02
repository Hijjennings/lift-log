import * as model from './model.js';

const PROGRAM_KEY = 'liftlog.program.v1';
const LOGS_KEY = 'liftlog.logs.v1';
const WEIGHT_STEP = 2.5;

const app = document.getElementById('app');
const state = {
  program: null,
  logs: model.emptyLogs(),
  error: '',
  draft: '',
  storageError: '',
};

function readStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  localStorage.setItem(PROGRAM_KEY, JSON.stringify(state.program));
  localStorage.setItem(LOGS_KEY, JSON.stringify(state.logs));
  state.storageError = '';
}

function loadStored() {
  const program = readStored(PROGRAM_KEY);
  const logs = readStored(LOGS_KEY);
  if (program) {
    try {
      model.validateProgram(program);
      state.program = program;
    } catch (error) {
      state.error = error.message;
    }
  }
  if (logs && typeof logs === 'object' && logs.sessions) state.logs = logs;
}

function entries() {
  return state.program ? model.buildEntries(state.program) : [];
}

function findEntry(week, day) {
  return entries().find((entry) => entry.week === week && entry.day === day) || null;
}

function parseRoute() {
  const parts = (location.hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
  if (!state.program && parts[0] !== 'replace') return { name: 'load' };
  if (parts[0] === 'day') {
    return { name: 'day', week: Number(parts[1]), day: Number(parts[2]) };
  }
  if (parts[0] === 'glossary') return { name: 'glossary' };
  if (parts[0] === 'deload') return { name: 'deload' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'replace') return state.program ? { name: 'replace' } : { name: 'load' };
  if (!state.program) return { name: 'load' };
  return { name: 'home' };
}

function h(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of Array.isArray(kids) ? kids : [kids]) {
    if (kid == null || kid === false || kid === '') continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function mark(svgKids) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = svgKids;
  return svg;
}

function brand() {
  return h('div', { class: 'brand' }, [
    mark('<rect width="28" height="28" rx="8" fill="#10241c"/><rect x="6" y="12" width="16" height="4" rx="2" fill="#8ef0c2"/><circle cx="7" cy="14" r="4" fill="#8ef0c2"/><circle cx="21" cy="14" r="4" fill="#8ef0c2"/>'),
    h('div', {}, [
      h('p', { class: 'eyebrow' }, 'On this phone'),
      h('h1', {}, 'Lift Log'),
    ]),
  ]);
}

function tabbar(route) {
  const tabs = [
    ['home', '#/', 'Home'],
    ['glossary', '#/glossary', 'Glossary'],
    ['deload', '#/deload', 'Deload'],
    ['settings', '#/settings', 'Settings'],
  ];
  return h('nav', { class: 'tabbar', 'aria-label': 'Primary' }, tabs.map(([name, href, label]) => (
    h('a', {
      class: 'tab',
      href,
      'aria-current': route.name === name ? 'page' : false,
    }, label)
  )));
}

function errorBlock() {
  return state.error ? h('p', { class: 'alert', role: 'alert' }, state.error) : null;
}

function renderLoad(replacing) {
  document.title = replacing ? 'Replace program · Lift Log' : 'Load program · Lift Log';
  const file = h('input', {
    id: 'program-file',
    type: 'file',
    accept: 'application/json,.json',
  });
  const backup = h('input', {
    id: 'backup-file',
    type: 'file',
    accept: 'application/json,.json',
  });
  const paste = h('textarea', {
    id: 'paste-json',
    placeholder: '{ "days": [ … ] }',
    'aria-label': 'Paste program JSON',
    spellcheck: 'false',
  });
  paste.value = state.draft;
  return h('main', { class: 'screen', 'data-screen': replacing ? 'replace' : 'load' }, [
    replacing ? h('a', { class: 'btn ghost', href: '#/settings' }, 'Back to settings') : brand(),
    h('h2', { class: 'screen-title', style: 'margin-top:18px' }, replacing ? 'Replace program' : 'Load program'),
    h('p', { class: 'muted' }, 'Pick the program.json file from Files, or paste the JSON. It is stored in this browser and never uploaded.'),
    errorBlock(),
    state.storageError ? h('p', { class: 'alert', role: 'alert' }, state.storageError) : null,
    h('label', { class: 'btn primary wide file-btn' }, [file, 'Choose program.json']),
    h('p', { class: 'faint small' }, 'or paste JSON'),
    paste,
    h('button', { class: 'btn wide', type: 'button', 'data-action': 'paste-program' }, 'Load pasted JSON'),
    h('label', { class: 'btn ghost wide file-btn' }, [backup, 'Restore backup']),
  ]);
}

function checkSpan(on) {
  return h('span', { class: on ? 'check on' : 'check', 'aria-hidden': 'true' }, on ? '✓' : '');
}

function renderHome() {
  document.title = 'Lift Log';
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
      h('p', { class: 'eyebrow' }, 'Next workout'),
      h('h2', {}, model.entryTitle(next)),
      model.entryFocus(next) ? h('p', { class: 'focus' }, model.entryFocus(next)) : null,
      h('p', { class: 'progress' }, `${progress.done} of ${progress.total} workouts checked off`),
      h('a', {
        class: 'btn primary start',
        id: 'start-workout',
        href: `#/day/${next.week}/${next.day}`,
      }, 'Start'),
    ])
    : h('section', { class: 'hero', 'data-testid': 'next-workout' }, [
      h('p', { class: 'eyebrow' }, 'Next workout'),
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
    details.open = Boolean(next && next.week === week);
    const links = h('div', { class: 'day-list' });
    for (const entry of days) {
      const complete = model.isComplete(state.logs, entry);
      const title = model.entryTitle(entry);
      const link = h('a', {
        class: 'day-link',
        href: `#/day/${entry.week}/${entry.day}`,
        'data-week': entry.week,
        'data-day': entry.day,
        'data-rest': model.isRestEntry(entry) ? 'true' : 'false',
        'data-schedule': model.isScheduleOnly(entry) ? 'true' : 'false',
        'aria-label': `${title}${complete ? ', completed' : ''}`,
      }, [
        h('span', { class: 'dow' }, (entry.dayOfWeek || '').slice(0, 3)),
        h('span', {}, [
          h('strong', {}, title),
          model.entryFocus(entry) ? h('small', {}, model.entryFocus(entry)) : null,
          model.isRestEntry(entry) ? h('span', { class: 'pill' }, 'Rest') : null,
          model.isScheduleOnly(entry) ? h('span', { class: 'pill' }, 'Schedule') : null,
        ]),
        checkSpan(complete),
      ]);
      links.append(link);
    }
    details.append(links);
    return details;
  });

  return h('main', { class: 'screen', 'data-screen': 'home' }, [
    h('header', { class: 'topbar' }, brand()),
    hero,
    h('section', { 'aria-label': 'All weeks' }, weekNodes),
    tabbar({ name: 'home' }),
  ]);
}

function exerciseCard(entry, exercise) {
  const key = model.normalizeName(exercise.name);
  const session = state.logs.sessions[model.sessionId(entry)];
  const logged = session?.exercises?.[key]?.sets || [];
  const count = model.visibleSetCount(exercise, logged.length);
  const previous = model.findPrevious(state.logs, entry, exercise.name);
  const reps = model.repsArray(exercise);
  const tempo = model.cleanText(exercise.tempo);
  const rest = model.cleanText(exercise.rest);
  const notes = model.cleanText(exercise.notes);
  const card = h('article', { class: 'exercise', 'data-exercise': key });
  card.append(
    h('h3', {}, model.displayName(exercise.name)),
    h('p', { class: 'meta' }, `${model.prescribedSets(exercise)} sets`),
    h('ul', { class: 'prescription reps' }, reps.map((line) => h('li', {}, line))),
  );
  const metaBits = [];
  if (tempo) metaBits.push(`Tempo ${tempo}`);
  if (rest) metaBits.push(`Rest ${rest}`);
  if (metaBits.length) card.append(h('p', { class: 'meta' }, metaBits.join(' · ')));
  if (notes) card.append(h('p', { class: 'notes' }, notes));

  const banner = previous
    ? h('p', {
      class: 'last-time',
      'data-testid': 'last-time',
      'data-date': previous.date,
    }, `Last time · ${model.formatDisplayDate(previous.date)}`)
    : h('p', { class: 'last-time empty', 'data-testid': 'last-time' }, 'No previous log');

  card.append(h('div', { class: 'log-head' }, [h('h4', {}, 'Today'), banner]));

  for (let index = 0; index < count; index += 1) {
    const set = logged[index] || { weight: '', reps: '' };
    const prevSet = previous?.sets?.[index];
    const performed = prevSet ? model.formatPerformed(prevSet) : '';
    const label = model.repForSet(exercise, index);
    const weight = h('input', {
      inputmode: 'decimal',
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      'aria-label': `Weight in pounds, set ${index + 1}, ${model.displayName(exercise.name)}`,
      placeholder: model.cleanText(prevSet?.weight),
      'data-field': 'weight',
      'data-index': index,
      'data-name': exercise.name,
      'data-week': entry.week,
      'data-day': entry.day,
    });
    weight.value = set.weight || '';
    const repsInput = h('input', {
      inputmode: 'numeric',
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      'aria-label': `Reps, set ${index + 1}, ${model.displayName(exercise.name)}`,
      placeholder: model.cleanText(prevSet?.reps),
      'data-field': 'reps',
      'data-index': index,
      'data-name': exercise.name,
      'data-week': entry.week,
      'data-day': entry.day,
    });
    repsInput.value = set.reps || '';
    const block = h('div', { class: 'set-block' }, [
      h('div', { class: 'set-label' }, [
        h('span', {}, `Set ${index + 1}`),
        label ? h('span', { class: 'rep-label' }, label) : null,
      ]),
      h('div', { class: 'set-grid' }, [
        h('div', { class: 'fields' }, [
          h('div', { class: 'field' }, [
            stepButton('−', 'weight', -WEIGHT_STEP, index, exercise.name, entry, 'Decrease weight'),
            weight,
            h('span', { class: 'unit' }, 'lb'),
            stepButton('+', 'weight', WEIGHT_STEP, index, exercise.name, entry, 'Increase weight'),
          ]),
          h('div', { class: 'field reps' }, [
            stepButton('−', 'reps', -1, index, exercise.name, entry, 'Decrease reps'),
            repsInput,
            stepButton('+', 'reps', 1, index, exercise.name, entry, 'Increase reps'),
          ]),
        ]),
        h('div', { class: 'prev', 'data-testid': 'prev-set' }, [
          h('span', {}, 'Last'),
          h('strong', {}, performed || '—'),
        ]),
      ]),
    ]);
    card.append(block);
  }

  const actions = h('div', {}, [
    h('button', {
      class: 'btn ghost add-set',
      type: 'button',
      'data-action': 'add-set',
      'data-name': exercise.name,
      'data-week': entry.week,
      'data-day': entry.day,
      'data-prescribed': model.prescribedSets(exercise),
    }, 'Add set'),
  ]);
  if (logged.length > model.prescribedSets(exercise)) {
    actions.append(h('button', {
      class: 'btn ghost add-set',
      type: 'button',
      'data-action': 'remove-set',
      'data-name': exercise.name,
      'data-week': entry.week,
      'data-day': entry.day,
      'data-prescribed': model.prescribedSets(exercise),
    }, 'Remove extra set'));
  }
  card.append(actions);
  return card;
}

function stepButton(symbol, field, delta, index, name, entry, label) {
  return h('button', {
    class: 'step',
    type: 'button',
    'data-step': delta,
    'data-field': field,
    'data-index': index,
    'data-name': name,
    'data-week': entry.week,
    'data-day': entry.day,
    'aria-label': `${label}, set ${index + 1}, ${model.displayName(name)}`,
  }, symbol);
}

function renderDay(route) {
  const entry = findEntry(route.week, route.day);
  if (!entry) {
    document.title = 'Day · Lift Log';
    return h('main', { class: 'screen', 'data-screen': 'day' }, [
      h('h2', {}, 'That day is not in the program.'),
      h('a', { class: 'btn', href: '#/' }, 'Home'),
      tabbar({ name: 'day' }),
    ]);
  }
  const title = model.entryTitle(entry);
  document.title = `${title} · Lift Log`;
  const session = state.logs.sessions[model.sessionId(entry)];
  const complete = session?.completed === true;
  const dateInput = h('input', {
    type: 'date',
    'aria-label': 'Session date',
    'data-field': 'date',
    'data-week': entry.week,
    'data-day': entry.day,
    value: session?.date || model.isoDate(),
  });
  const page = model.entryPage(entry);
  const pageNote = entry.source === 'day' ? model.cleanText(entry.record.pageNote) : '';
  const footerNote = entry.source === 'day' ? model.cleanText(entry.record.footerNote) : '';
  const children = [
    h('header', { class: 'topbar' }, [
      h('div', {}, [
        h('p', { class: 'eyebrow' }, entry.dayOfWeek || `Day ${entry.day}`),
        h('h2', { class: 'screen-title', id: 'day-title' }, title),
      ]),
    ]),
    model.entryFocus(entry) ? h('p', { class: 'focus' }, model.entryFocus(entry)) : null,
    h('p', { class: 'meta' }, [
      page != null ? `Page ${page}` : '',
      entry.dayOfWeek || '',
    ].filter(Boolean).join(' · ')),
    h('label', { class: 'field-label' }, ['Session date', dateInput]),
    h('p', { class: 'save-state', id: 'save-state', 'aria-live': 'polite' }, ''),
  ];

  if (pageNote) children.push(h('section', { class: 'callout', 'data-testid': 'page-note' }, [h('p', {}, pageNote)]));

  if (model.isRestEntry(entry)) {
    const lines = model.restLines(entry);
    children.push(h('section', { class: 'rest-copy', 'data-testid': 'rest-text' }, (
      lines.length ? lines.map((line) => h('p', {}, line)) : [h('p', { class: 'muted' }, 'Rest day.')]
    )));
  } else if (model.isScheduleOnly(entry)) {
    const deload = model.deloadView(state.program);
    children.push(h('section', { class: 'deload-copy', 'data-testid': 'schedule-deload' }, [
      h('p', { class: 'eyebrow' }, deload.title || 'Deload'),
      deload.page != null ? h('p', { class: 'meta' }, `Page ${deload.page}`) : null,
      ...(deload.blocks.length
        ? deload.blocks.map((block) => h('p', {}, block))
        : [h('p', { class: 'muted' }, 'No deload text in this program.')]),
    ]));
  } else {
    children.push(h('p', { class: 'small faint' }, 'Weights are in lb.'));
    for (const exercise of entry.record.exercises || []) children.push(exerciseCard(entry, exercise));
    if (!(entry.record.exercises || []).length) {
      children.push(h('p', { class: 'muted' }, 'No exercises on this day.'));
    }
  }

  if (footerNote) children.push(h('section', { class: 'callout', 'data-testid': 'footer-note' }, [h('p', {}, footerNote)]));

  const main = h('main', {
    class: 'screen with-dock',
    'data-screen': 'day',
    'data-week': entry.week,
    'data-day': entry.day,
  }, children);
  main.append(h('div', { class: 'dock' }, [
    h('a', { class: 'btn ghost', href: '#/' }, 'Home'),
    h('button', {
      class: 'btn primary',
      type: 'button',
      id: 'toggle-complete',
      'data-action': 'toggle-complete',
      'data-week': entry.week,
      'data-day': entry.day,
      'aria-pressed': complete ? 'true' : 'false',
    }, complete ? 'Completed · Undo' : 'Mark day complete'),
  ]));
  main.append(tabbar({ name: 'day' }));
  return main;
}

function renderGlossary() {
  document.title = 'Glossary · Lift Log';
  const items = model.glossaryEntries(state.program);
  return h('main', { class: 'screen glossary', 'data-screen': 'glossary' }, [
    h('h2', { class: 'screen-title' }, 'Glossary'),
    items.length
      ? h('div', { class: 'stack' }, items.map((item) => h('article', { class: 'card' }, [
        h('h3', {}, item.term),
        h('p', {}, item.text),
      ])))
      : h('p', { class: 'muted' }, 'No glossary in this program.'),
    tabbar({ name: 'glossary' }),
  ]);
}

function renderDeload() {
  document.title = 'Deload · Lift Log';
  const deload = model.deloadView(state.program);
  return h('main', { class: 'screen', 'data-screen': 'deload' }, [
    h('h2', { class: 'screen-title' }, deload.title || 'Deload'),
    deload.page != null ? h('p', { class: 'meta' }, `Page ${deload.page}`) : null,
    deload.blocks.length
      ? h('section', { class: 'deload-copy card' }, deload.blocks.map((block) => h('p', {}, block)))
      : h('p', { class: 'muted' }, 'No deload text in this program.'),
    tabbar({ name: 'deload' }),
  ]);
}

function renderSettings() {
  document.title = 'Settings · Lift Log';
  const backup = h('input', {
    id: 'backup-file',
    type: 'file',
    accept: 'application/json,.json',
    'aria-label': 'Choose backup JSON',
  });
  const programFile = h('input', {
    id: 'program-file',
    type: 'file',
    accept: 'application/json,.json',
    'aria-label': 'Choose a replacement program.json',
  });
  return h('main', { class: 'screen settings', 'data-screen': 'settings' }, [
    h('h2', { class: 'screen-title' }, 'Settings'),
    errorBlock(),
    h('section', { class: 'card stack' }, [
      h('h3', {}, 'Program'),
      h('p', { class: 'muted small' }, model.programLabel(state.program)),
      h('p', { class: 'small' }, 'Replace program keeps the sets already logged on this phone.'),
      h('label', { class: 'btn wide file-btn' }, [programFile, 'Replace program']),
      h('a', { class: 'btn ghost wide', href: '#/replace' }, 'Paste a replacement'),
    ]),
    h('section', { class: 'card stack' }, [
      h('h3', {}, 'Export'),
      h('p', { class: 'small muted' }, 'Weights are in lb. CSV columns: date, week, day, workout, exercise, set, weight, reps, completed_day.'),
      h('button', { class: 'btn primary wide', type: 'button', id: 'export-csv', 'data-action': 'export-csv' }, 'Download CSV'),
      h('button', { class: 'btn wide', type: 'button', id: 'share-csv', 'data-action': 'share-csv' }, 'Share CSV'),
      h('button', { class: 'btn wide', type: 'button', id: 'export-json', 'data-action': 'export-json' }, 'Download backup'),
    ]),
    h('section', { class: 'card stack' }, [
      h('h3', {}, 'Restore'),
      h('p', { class: 'small muted' }, 'A backup replaces both the program and the logs stored on this phone.'),
      h('label', { class: 'btn wide file-btn' }, [backup, 'Restore backup']),
    ]),
    h('p', { class: 'small muted' }, 'Lift Log does not create an account, send analytics, or upload your program. Everything stays in this browser, including offline.'),
    tabbar({ name: 'settings' }),
  ]);
}

function render() {
  const route = parseRoute();
  const scroll = document.querySelector('.screen')?.scrollTop || 0;
  let view;
  if (route.name === 'load') view = renderLoad(false);
  else if (route.name === 'replace') view = renderLoad(true);
  else if (route.name === 'home') view = renderHome();
  else if (route.name === 'day') view = renderDay(route);
  else if (route.name === 'glossary') view = renderGlossary();
  else if (route.name === 'deload') view = renderDeload();
  else view = renderSettings();
  app.replaceChildren(view);
  const screen = app.querySelector('.screen');
  if (screen) screen.scrollTop = scroll;
}

function currentEntryFrom(node) {
  const week = Number(node.dataset.week);
  const day = Number(node.dataset.day);
  return findEntry(week, day);
}

function remember() {
  try {
    persist();
  } catch {
    state.storageError = 'Could not save on this phone (storage is blocked or full).';
    state.error = state.storageError;
    const save = document.getElementById('save-state');
    if (save) save.textContent = 'Not saved';
    return false;
  }
  const save = document.getElementById('save-state');
  if (save) save.textContent = 'Saved';
  return true;
}

function onSetEdit(input, value) {
  const entry = currentEntryFrom(input);
  if (!entry) return;
  model.setLoggedSet(state.logs, entry, input.dataset.name, Number(input.dataset.index), input.dataset.field, value);
  const sanitized = input.dataset.field === 'weight' ? model.sanitizeWeight(value) : model.sanitizeReps(value);
  if (input.value !== sanitized) input.value = sanitized;
  remember();
}

async function readTextFile(file) {
  return (await file.text()).replace(/^\uFEFF/, '');
}

async function ingestProgramText(text, replacing) {
  let data;
  try {
    data = JSON.parse(String(text).trim());
  } catch {
    state.error = 'That is not valid JSON.';
    render();
    return;
  }
  try {
    model.validateProgram(data);
  } catch (error) {
    state.error = error.message || 'Program did not validate.';
    render();
    return;
  }
  if (replacing && !window.confirm('Replace the program stored on this phone? Your logged sets are kept.')) return;
  state.program = data;
  state.error = '';
  state.draft = '';
  try {
    persist();
  } catch {
    state.storageError = 'Could not save on this phone (storage is blocked or full).';
    state.error = state.storageError;
    render();
    return;
  }
  if (location.hash !== '#/') location.hash = '#/';
  else render();
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
    version: 1,
    exportedAt: new Date().toISOString(),
    program: state.program,
    logs: state.logs,
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

app.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'paste-json') {
    state.draft = target.value;
    return;
  }
  if (target.dataset.field === 'weight' || target.dataset.field === 'reps') onSetEdit(target, target.value);
});

app.addEventListener('change', async (event) => {
  const target = event.target;
  if (target.id === 'program-file' && target.files?.[0]) {
    const replacing = parseRoute().name === 'replace' || parseRoute().name === 'settings';
    const text = await readTextFile(target.files[0]);
    target.value = '';
    await ingestProgramText(text, replacing && Boolean(state.program));
    return;
  }
  if (target.id === 'backup-file' && target.files?.[0]) {
    const text = await readTextFile(target.files[0]);
    target.value = '';
    let data;
    try {
      data = JSON.parse(text.trim());
    } catch {
      state.error = 'That backup is not valid JSON.';
      render();
      return;
    }
    let parsed;
    try {
      parsed = model.parseBackup(data);
    } catch (error) {
      state.error = error.message || 'Backup did not validate.';
      render();
      return;
    }
    if (!window.confirm('Restore this backup? It replaces the program and logs on this phone.')) return;
    state.program = parsed.program;
    state.logs = parsed.logs;
    state.error = '';
    try {
      persist();
    } catch {
      state.error = 'Could not save on this phone (storage is blocked or full).';
    }
    location.hash = '#/';
    render();
    return;
  }
  if (target.dataset.field === 'date') {
    const entry = currentEntryFrom(target);
    if (!entry) return;
    model.setSessionDate(state.logs, entry, target.value);
    remember();
  }
});

app.addEventListener('click', (event) => {
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
  if (action.dataset.action === 'paste-program') {
    const replacing = parseRoute().name === 'replace';
    ingestProgramText(state.draft, replacing);
    return;
  }
  if (action.dataset.action === 'add-set' || action.dataset.action === 'remove-set') {
    const entry = currentEntryFrom(action);
    if (!entry) return;
    const prescribed = Number(action.dataset.prescribed);
    if (action.dataset.action === 'add-set') model.addEmptySet(state.logs, entry, action.dataset.name, prescribed);
    else model.removeLastExtraSet(state.logs, entry, action.dataset.name, prescribed);
    remember();
    render();
    return;
  }
  if (action.dataset.action === 'toggle-complete') {
    const entry = currentEntryFrom(action);
    if (!entry) return;
    const session = state.logs.sessions[model.sessionId(entry)];
    model.setCompleted(state.logs, entry, !(session?.completed));
    remember();
    render();
    return;
  }
  if (action.dataset.action === 'export-csv') {
    download(`lift-log-${model.isoDate()}.csv`, model.buildCsv(entries(), state.logs), 'text/csv');
    return;
  }
  if (action.dataset.action === 'share-csv') {
    shareCsv();
    return;
  }
  if (action.dataset.action === 'export-json') {
    download(`lift-log-backup-${model.isoDate()}.json`, JSON.stringify(exportPayload(), null, 2), 'application/json');
  }
});

window.addEventListener('hashchange', render);

loadStored();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

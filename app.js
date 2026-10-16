'use strict';

/* =========================================================
   FitnessTrack · Phase 1
   Tägliche Ziele, Training, Kalender, Datensicherung.
   Alle Daten liegen lokal auf dem Gerät (localStorage).
   ========================================================= */

const APP_VERSION = '0.1.0';
const STORAGE_KEY = 'fitnesstrack.v1';

/* ---------- Daten ---------- */

function defaultData() {
  return {
    schema: 1,
    startedOn: null,
    habits: [
      { id: 'physio', name: 'Physioübungen', emoji: '🧘', since: null },
      { id: 'kreatin', name: 'Kreatin', emoji: '💊', since: null },
      { id: 'protein', name: 'Proteinpulver', emoji: '🥤', since: null },
    ],
    workoutTypes: [
      { id: 'upper', name: 'Upper Body', emoji: '💪' },
      { id: 'lower', name: 'Lower Body', emoji: '🦵' },
      { id: 'gym', name: 'Gym', emoji: '🏋️' },
      { id: 'laufen', name: 'Laufen', emoji: '🏃' },
      { id: 'sonstiges', name: 'Sonstiges', emoji: '⚡' },
    ],
    days: {},
    settings: { weeklyGoal: 4, lastBackup: null, hideInstallHint: false },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (err) {
    console.error('Laden fehlgeschlagen', err);
  }
  const fresh = defaultData();
  fresh.startedOn = todayKey();
  fresh.habits.forEach(h => { h.since = fresh.startedOn; });
  save(fresh);
  return fresh;
}

function migrate(d) {
  const def = defaultData();
  const out = { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) } };
  out.startedOn = out.startedOn || todayKey();
  out.habits = (out.habits || []).map(h => ({ ...h, since: h.since || out.startedOn }));
  out.days = out.days || {};
  return out;
}

function save(d = data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch (err) {
    console.error(err);
    toast('Speichern fehlgeschlagen');
  }
}

/* ---------- Hilfsfunktionen ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const pad = n => String(n).padStart(2, '0');
const keyOf = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const todayKey = () => keyOf(new Date());
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const weekStart = k => { const d = parseKey(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d); };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().slice(0, 12);
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function firstGrapheme(s) {
  s = (s || '').trim();
  if (!s) return '';
  if (window.Intl && Intl.Segmenter) {
    const it = new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next();
    return it.value ? it.value.segment : '';
  }
  return Array.from(s)[0];
}

const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const ICON_UP = '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/* ---------- Tage & Auswertung ---------- */

function day(k) {
  const d = data.days[k];
  return { habits: (d && d.habits) || {}, workouts: (d && d.workouts) || [] };
}

function dayMut(k) {
  if (!data.days[k]) data.days[k] = { habits: {}, workouts: [] };
  const d = data.days[k];
  d.habits = d.habits || {};
  d.workouts = d.workouts || [];
  return d;
}

function cleanupDay(k) {
  const d = data.days[k];
  if (d && !Object.keys(d.habits || {}).length && !(d.workouts || []).length) delete data.days[k];
}

// Ziele, die an diesem Tag angezeigt werden (nicht vorher archiviert)
function shownHabits(k) {
  return data.habits.filter(h => !h.archivedOn || h.archivedOn > k);
}

// Ziele, die für das Tagesziel zählen
function relevantHabits(k) {
  const d = day(k);
  const anyEntry = Object.keys(d.habits).length > 0;
  return shownHabits(k).filter(h => anyEntry || h.since <= k);
}

function dayStatus(k) {
  const t = todayKey();
  if (k > t) return 'future';
  const hs = relevantHabits(k);
  if (!hs.length) return 'none';
  const d = day(k);
  const done = hs.filter(h => d.habits[h.id]).length;
  if (done === hs.length) return 'full';
  if (done > 0) return 'partial';
  if (k === t) return 'open';
  if (k < data.startedOn) return 'none';
  return 'missed';
}

function statusLabel(st) {
  return { full: 'Tagesziel erreicht', partial: 'teilweise erledigt', missed: 'verpasst', open: 'offen', none: 'keine Daten', future: 'Zukunft' }[st] || '';
}

function currentStreak() {
  let k = todayKey();
  if (dayStatus(k) !== 'full') k = addDays(k, -1);
  let n = 0;
  while (dayStatus(k) === 'full' && n < 3660) { n++; k = addDays(k, -1); }
  return n;
}

function bestStreak() {
  const keys = Object.keys(data.days).sort();
  let k = keys.length && keys[0] < data.startedOn ? keys[0] : data.startedOn;
  const t = todayKey();
  let best = 0, run = 0;
  while (k <= t) {
    if (dayStatus(k) === 'full') { run++; best = Math.max(best, run); } else run = 0;
    k = addDays(k, 1);
  }
  return best;
}

function weekWorkouts(k) {
  let s = weekStart(k), n = 0;
  for (let i = 0; i < 7; i++) { n += day(s).workouts.length; s = addDays(s, 1); }
  return n;
}

/* ---------- Zustand & Rendern ---------- */

let data = load();
const state = { tab: 'today', openDay: null, calMonth: null, renderedFor: todayKey() };

function render() {
  const view = $('#view');
  if (state.tab === 'today') view.innerHTML = viewDay(todayKey(), false);
  else if (state.tab === 'calendar') view.innerHTML = state.openDay ? viewDay(state.openDay, true) : viewCalendar();
  else if (state.tab === 'recipes') view.innerHTML = viewRecipes();
  else view.innerHTML = viewSettings();
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.tab === state.tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });
  state.renderedFor = todayKey();
}

/* ---------- Ansicht: Tag ---------- */

function viewDay(k, back) {
  const t = todayKey();
  const isToday = k === t;
  const d = day(k);
  const hs = shownHabits(k);
  const done = hs.filter(h => d.habits[h.id]).length;
  const st = dayStatus(k);
  const dt = parseKey(k);
  const weekday = dt.toLocaleDateString('de-DE', { weekday: 'long' });
  const dateStr = dt.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: dt.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  const wk = weekWorkouts(k);
  const goal = data.settings.weeklyGoal;
  const thisWeek = weekStart(k) === weekStart(t);
  const streak = currentStreak();

  const installHint = isToday && !isStandalone() && !data.settings.hideInstallHint ? `
    <section class="card install-hint">
      <p><b>Tipp:</b> In Safari auf <b>Teilen</b> und dann <b>„Zum Home-Bildschirm“</b> tippen. Dann läuft FitnessTrack wie eine eigene App.</p>
      <button class="icon-btn" data-action="hide-install-hint" aria-label="Hinweis ausblenden">${ICON_CLOSE}</button>
    </section>` : '';

  return `
    <header class="page-head">
      ${back ? '<button class="back" data-action="close-day">‹ Kalender</button>' : ''}
      <p class="eyebrow">${isToday ? 'Heute · ' : ''}${esc(weekday)}</p>
      <h1>${esc(dateStr)}</h1>
      <div class="chips">
        ${isToday ? `<span class="chip ${streak > 0 ? 'good' : ''}">🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'} Serie</span>` : ''}
        <span class="chip ${wk >= goal ? 'good' : ''}">🏋️ ${wk}/${goal} Trainings ${thisWeek ? 'diese Woche' : 'in der Woche'}</span>
      </div>
    </header>
    ${installHint}
    <section class="card">
      <div class="card-head"><h2>Tägliche Ziele</h2><span class="count">${done}/${hs.length}</span></div>
      <div class="bar"><span style="width:${hs.length ? (done / hs.length) * 100 : 0}%"></span></div>
      ${st === 'full' ? '<p class="done-banner">✓ Tagesziel erreicht</p>' : ''}
      <div class="habits">
        ${hs.map(h => habitRow(h, d, k)).join('') || '<p class="empty">Keine Ziele angelegt. Unter „Mehr“ kannst du welche hinzufügen.</p>'}
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Training</h2>${d.workouts.length ? `<span class="count">${d.workouts.length}</span>` : ''}</div>
      ${d.workouts.length
        ? `<ul class="workouts">${d.workouts.map(w => workoutRow(w, k)).join('')}</ul>`
        : `<p class="empty">${isToday ? 'Heute noch kein Training eingetragen.' : 'Kein Training eingetragen.'}</p>`}
      <div class="type-grid">
        ${data.workoutTypes.map(ty => `
          <button class="type-btn" data-action="add-workout" data-type="${esc(ty.id)}" data-key="${k}">
            <span>${esc(ty.emoji)}</span>${esc(ty.name)}
          </button>`).join('')}
      </div>
    </section>`;
}

function habitRow(h, d, k) {
  const v = d.habits[h.id];
  let sub = 'Offen';
  if (v) {
    sub = 'Erledigt';
    if (typeof v === 'string') {
      const at = new Date(v);
      if (!isNaN(at) && keyOf(at) === k) sub += ' · ' + at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
  }
  return `
    <button class="habit ${v ? 'is-done' : ''}" data-action="toggle-habit" data-id="${esc(h.id)}" data-key="${k}" aria-pressed="${!!v}">
      <span class="habit-emoji">${esc(h.emoji)}</span>
      <span class="habit-text"><span class="habit-name">${esc(h.name)}</span><span class="habit-sub">${sub}</span></span>
      <span class="check" aria-hidden="true">${ICON_CHECK}</span>
    </button>`;
}

function workoutRow(w, k) {
  const meta = [w.duration ? `${w.duration} Min` : '', w.note ? esc(w.note) : ''].filter(Boolean).join(' · ');
  return `
    <li class="workout">
      <span class="w-emoji">${esc(w.emoji)}</span>
      <span class="w-text"><b>${esc(w.name)}</b>${meta ? `<small>${meta}</small>` : ''}</span>
      <button class="icon-btn" data-action="delete-workout" data-key="${k}" data-id="${esc(w.id)}" aria-label="${esc(w.name)} löschen">${ICON_TRASH}</button>
    </li>`;
}

/* ---------- Ansicht: Kalender ---------- */

function viewCalendar() {
  const t = todayKey();
  const m = state.calMonth || t.slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, mo, 0).getDate();

  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<span class="cal-cell blank"></span>';

  let full = 0, counted = 0, trainings = 0;
  for (let dn = 1; dn <= daysIn; dn++) {
    const k = `${y}-${pad(mo)}-${pad(dn)}`;
    const st = dayStatus(k);
    const w = day(k).workouts.length;
    trainings += w;
    if (st === 'full' || st === 'partial' || st === 'missed') { counted++; if (st === 'full') full++; }
    cells += `
      <button class="cal-cell st-${st} ${k === t ? 'is-today' : ''}" data-action="open-day" data-key="${k}"
        ${st === 'future' ? 'disabled' : ''} aria-label="${dn}. ${statusLabel(st)}${w ? ', Training' : ''}">
        <span>${dn}</span>${w ? '<i class="dot"></i>' : ''}
      </button>`;
  }

  const monthName = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const isCurrent = m === t.slice(0, 7);

  return `
    <header class="page-head">
      <p class="eyebrow">Verlauf</p>
      <div class="cal-nav">
        <button class="icon-btn" data-action="cal-prev" aria-label="Vorheriger Monat">‹</button>
        <h1>${esc(monthName)}</h1>
        <button class="icon-btn" data-action="cal-next" aria-label="Nächster Monat" ${isCurrent ? 'disabled' : ''}>›</button>
      </div>
    </header>
    <section class="card">
      <div class="cal-week">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="legend">
        <span><i class="lg full"></i>Ziel erreicht</span>
        <span><i class="lg partial"></i>Teilweise</span>
        <span><i class="lg missed"></i>Verpasst</span>
        <span><i class="dot"></i>Training</span>
      </div>
    </section>
    <section class="stats">
      <div class="stat"><b>${full}<small>/${counted}</small></b><span>Tage mit Tagesziel</span></div>
      <div class="stat"><b>${trainings}</b><span>Trainings im Monat</span></div>
      <div class="stat"><b>${bestStreak()}</b><span>Beste Serie (Tage)</span></div>
    </section>
    <p class="footer-note">Tippe auf einen Tag, um ihn nachzutragen oder zu ändern.</p>`;
}

/* ---------- Ansicht: Rezepte (Platzhalter) ---------- */

function viewRecipes() {
  return `
    <header class="page-head"><p class="eyebrow">Küche</p><h1>Rezepte</h1></header>
    <section class="card placeholder">
      <span class="big">🍳</span>
      <h2>Kommt in Phase 3 und 4</h2>
      <ul>
        <li>Rezepte mit Kurzanleitung speichern</li>
        <li>Sortieren nach Kochdauer und Aufwand</li>
        <li>Vorrat abhaken und passende Rezepte vorschlagen lassen</li>
      </ul>
    </section>`;
}

/* ---------- Ansicht: Mehr / Einstellungen ---------- */

function viewSettings() {
  const habits = data.habits.filter(h => !h.archivedOn);
  const lb = data.settings.lastBackup;
  const lbText = lb ? parseKey(lb).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'noch nie';
  const backupOld = !lb || (parseKey(todayKey()) - parseKey(lb)) / 864e5 > 14;

  return `
    <header class="page-head"><p class="eyebrow">Einstellungen</p><h1>Mehr</h1></header>

    <section class="card">
      <div class="card-head"><h2>Tägliche Ziele</h2></div>
      <ul class="list">
        ${habits.map((h, i) => `
          <li>
            <span class="l-emoji">${esc(h.emoji)}</span>
            <span class="l-name">${esc(h.name)}</span>
            <button class="icon-btn" data-action="move-habit" data-id="${esc(h.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">${ICON_UP}</button>
            <button class="icon-btn" data-action="remove-habit" data-id="${esc(h.id)}" aria-label="${esc(h.name)} entfernen">${ICON_TRASH}</button>
          </li>`).join('') || '<li><span class="l-name empty">Keine Ziele</span></li>'}
      </ul>
      <button class="btn add" data-action="add-habit">＋ Ziel hinzufügen</button>
      <p class="hint">Entfernte Ziele bleiben im Verlauf erhalten.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Trainingsarten</h2></div>
      <ul class="list">
        ${data.workoutTypes.map(ty => `
          <li>
            <span class="l-emoji">${esc(ty.emoji)}</span>
            <span class="l-name">${esc(ty.name)}</span>
            <button class="icon-btn" data-action="remove-type" data-id="${esc(ty.id)}" aria-label="${esc(ty.name)} entfernen">${ICON_TRASH}</button>
          </li>`).join('') || '<li><span class="l-name empty">Keine Trainingsarten</span></li>'}
      </ul>
      <button class="btn add" data-action="add-type">＋ Trainingsart hinzufügen</button>
    </section>

    <section class="card">
      <div class="row-between">
        <div><h2>Wochenziel</h2><p class="hint">Trainings pro Woche</p></div>
        <div class="stepper">
          <button class="icon-btn" data-action="goal-dec" aria-label="Weniger">−</button>
          <b>${data.settings.weeklyGoal}</b>
          <button class="icon-btn" data-action="goal-inc" aria-label="Mehr">+</button>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Erinnerungen <span class="soon">Phase 2</span></h2>
      <p class="hint">Push-Erinnerungen für die Physio, Kreatin und Protein mit Verschieben um 15 Min, 1 Std oder auf den Abend.</p>
    </section>

    <section class="card">
      <h2>Datensicherung</h2>
      <p class="hint">Deine Daten liegen nur auf diesem iPhone. Wenn du die App vom Home-Bildschirm löschst, sind sie weg. Sichere sie deshalb regelmäßig in iCloud Drive.</p>
      <p class="hint">Letztes Backup: <b style="color:${backupOld ? 'var(--danger)' : 'var(--ink)'}">${esc(lbText)}</b></p>
      <div class="btn-row">
        <button class="btn primary" data-action="export">Sichern</button>
        <button class="btn secondary" data-action="import">Wiederherstellen</button>
      </div>
    </section>

    <p class="footer-note">FitnessTrack ${APP_VERSION}</p>`;
}

/* ---------- Sheet & Toast ---------- */

function openSheet(html, mount) {
  const s = $('#sheet');
  $('#sheet-body').innerHTML = html;
  s.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add('open')));
  if (mount) mount($('#sheet-body'));
}

function closeSheet() {
  const s = $('#sheet');
  s.classList.remove('open');
  setTimeout(() => { s.hidden = true; $('#sheet-body').innerHTML = ''; }, 220);
}

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" id="toast-act">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  if (action) $('#toast-act').onclick = () => { action.fn(); el.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
}

function nameEmojiSheet({ title, placeholder, emoji, button, onSave }) {
  openSheet(`
    <h3>${esc(title)}</h3>
    <label class="field-label" for="ne-name">Name</label>
    <input id="ne-name" class="input" maxlength="40" placeholder="${esc(placeholder)}" autocomplete="off">
    <label class="field-label" for="ne-emoji">Symbol</label>
    <input id="ne-emoji" class="input emoji-input" maxlength="12" value="${esc(emoji)}" autocomplete="off">
    <div class="sheet-actions">
      <button class="btn ghost" data-action="close-sheet">Abbrechen</button>
      <button class="btn primary" id="ne-save">${esc(button)}</button>
    </div>`, root => {
    const nameEl = $('#ne-name', root);
    $('#ne-save', root).onclick = () => {
      const name = nameEl.value.trim();
      if (!name) { nameEl.focus(); return; }
      onSave(name, firstGrapheme($('#ne-emoji', root).value) || emoji);
      save(); closeSheet(); render();
    };
    setTimeout(() => nameEl.focus(), 260);
  });
}

function openWorkoutSheet(k, typeId) {
  const ty = data.workoutTypes.find(x => x.id === typeId);
  if (!ty) return;
  openSheet(`
    <h3>${esc(ty.emoji)} ${esc(ty.name)}</h3>
    <label class="field-label">Dauer</label>
    <div class="seg" role="radiogroup">
      ${[0, 30, 45, 60, 90].map(m => `<button type="button" class="seg-btn ${m === 0 ? 'on' : ''}" data-min="${m}" role="radio" aria-checked="${m === 0}">${m ? m + ' Min' : 'ohne'}</button>`).join('')}
    </div>
    <label class="field-label" for="w-note">Notiz (optional)</label>
    <input id="w-note" class="input" maxlength="140" placeholder="z.B. Rudern 3×10 mit 16 kg" autocomplete="off">
    <div class="sheet-actions">
      <button class="btn ghost" data-action="close-sheet">Abbrechen</button>
      <button class="btn primary" id="w-save">Eintragen</button>
    </div>`, root => {
    let minutes = 0;
    root.querySelectorAll('.seg-btn').forEach(b => {
      b.onclick = () => {
        minutes = Number(b.dataset.min);
        root.querySelectorAll('.seg-btn').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      };
    });
    $('#w-save', root).onclick = () => {
      dayMut(k).workouts.push({
        id: uid(), type: ty.id, name: ty.name, emoji: ty.emoji,
        duration: minutes || null, note: $('#w-note', root).value.trim(), at: new Date().toISOString(),
      });
      save(); closeSheet(); render();
      toast(`${ty.name} eingetragen`);
    };
  });
}

/* ---------- Datensicherung ---------- */

async function exportData() {
  const json = JSON.stringify({ ...data, exportedAt: new Date().toISOString(), appVersion: APP_VERSION }, null, 2);
  const name = `fitnesstrack-backup-${todayKey()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const markDone = () => { data.settings.lastBackup = todayKey(); save(); render(); toast('Backup erstellt'); };

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'FitnessTrack Backup' });
      markDone();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  markDone();
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.habits) || typeof parsed.days !== 'object') throw new Error('Ungültig');
      const n = Object.keys(parsed.days).length;
      if (!confirm(`Backup mit ${n} Tagen laden? Die aktuellen Daten auf diesem Gerät werden ersetzt.`)) return;
      delete parsed.exportedAt; delete parsed.appVersion;
      data = migrate(parsed);
      save(); render();
      toast('Backup wiederhergestellt');
    } catch (err) {
      console.error(err);
      toast('Datei ist kein gültiges Backup');
    }
  };
  reader.readAsText(file);
}

/* ---------- Aktionen ---------- */

const actions = {
  'tab'(el) {
    state.tab = el.dataset.tab;
    if (state.tab !== 'calendar') state.openDay = null;
    render();
    window.scrollTo(0, 0);
  },

  'toggle-habit'(el) {
    const k = el.dataset.key, id = el.dataset.id;
    const d = dayMut(k);
    if (d.habits[id]) delete d.habits[id];
    else d.habits[id] = k === todayKey() ? new Date().toISOString() : true;
    const reached = dayStatus(k) === 'full';
    cleanupDay(k); save(); render();
    if (reached && d.habits[id]) toast('Tagesziel erreicht 🎉');
  },

  'add-workout'(el) { openWorkoutSheet(el.dataset.key, el.dataset.type); },

  'delete-workout'(el) {
    const k = el.dataset.key, id = el.dataset.id;
    const d = dayMut(k);
    const idx = d.workouts.findIndex(w => w.id === id);
    if (idx < 0) return;
    const [removed] = d.workouts.splice(idx, 1);
    cleanupDay(k); save(); render();
    toast(`${removed.name} gelöscht`, {
      label: 'Rückgängig',
      fn: () => { dayMut(k).workouts.splice(idx, 0, removed); save(); render(); },
    });
  },

  'open-day'(el) { state.openDay = el.dataset.key; render(); window.scrollTo(0, 0); },
  'close-day'() { state.openDay = null; render(); },

  'cal-prev'() { shiftMonth(-1); },
  'cal-next'() { shiftMonth(1); },

  'hide-install-hint'() { data.settings.hideInstallHint = true; save(); render(); },

  'add-habit'() {
    nameEmojiSheet({
      title: 'Neues Tagesziel', placeholder: 'z.B. Dehnen', emoji: '✅', button: 'Hinzufügen',
      onSave: (name, emoji) => data.habits.push({ id: uid(), name, emoji, since: todayKey() }),
    });
  },

  'move-habit'(el) {
    const active = data.habits.filter(h => !h.archivedOn);
    const i = active.findIndex(h => h.id === el.dataset.id);
    if (i <= 0) return;
    const a = data.habits.indexOf(active[i - 1]), b = data.habits.indexOf(active[i]);
    [data.habits[a], data.habits[b]] = [data.habits[b], data.habits[a]];
    save(); render();
  },

  'remove-habit'(el) {
    const h = data.habits.find(x => x.id === el.dataset.id);
    if (!h || !confirm(`„${h.name}“ entfernen? Der bisherige Verlauf bleibt erhalten.`)) return;
    const used = Object.values(data.days).some(d => d.habits && d.habits[h.id]);
    if (used) h.archivedOn = todayKey();
    else data.habits = data.habits.filter(x => x !== h);
    save(); render();
  },

  'add-type'() {
    nameEmojiSheet({
      title: 'Neue Trainingsart', placeholder: 'z.B. Schwimmen', emoji: '🏊', button: 'Hinzufügen',
      onSave: (name, emoji) => data.workoutTypes.push({ id: uid(), name, emoji }),
    });
  },

  'remove-type'(el) {
    const ty = data.workoutTypes.find(x => x.id === el.dataset.id);
    if (!ty || !confirm(`„${ty.name}“ entfernen? Bereits eingetragene Trainings bleiben erhalten.`)) return;
    data.workoutTypes = data.workoutTypes.filter(x => x !== ty);
    save(); render();
  },

  'goal-dec'() { data.settings.weeklyGoal = Math.max(1, data.settings.weeklyGoal - 1); save(); render(); },
  'goal-inc'() { data.settings.weeklyGoal = Math.min(14, data.settings.weeklyGoal + 1); save(); render(); },

  'export'() { exportData(); },
  'import'() { $('#import-file').click(); },

  'close-sheet'() { closeSheet(); },
};

function shiftMonth(delta) {
  const t = todayKey();
  const [y, m] = (state.calMonth || t.slice(0, 7)).split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const next = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (next > t.slice(0, 7)) return;
  state.calMonth = next;
  render();
}

/* ---------- Start ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

$('#import-file').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) importData(f);
  e.target.value = '';
});

// Neu zeichnen, wenn die App nach Mitternacht wieder geöffnet wird
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.renderedFor !== todayKey()) render();
});

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW', err)));
}

render();

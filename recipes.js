'use strict';

/* =========================================================
   FitnessTrack · Rezepte, Vorrat & Einkaufsliste
   Wird vor app.js geladen. Nutzt deren Hilfsfunktionen
   (data, save, render, esc, uid, toast, openSheet, …) erst
   zur Laufzeit.
   ========================================================= */

const EFFORT = { 1: 'Leicht', 2: 'Mittel', 3: 'Aufwendig' };
const TAG_PRESETS = ['proteinreich', 'vegetarisch', 'vegan', 'schnell', 'Meal Prep', 'Frühstück', 'Snack', 'Süß'];
const MINUTE_PRESETS = [10, 20, 30, 45, 60, 90];
const ALWAYS_AVAILABLE = ['wasser', 'eiswürfel'];
const PANTRY_CATS = ['Basis', 'Kühlschrank', 'Vorrat', 'Gemüse & Obst', 'Gewürze', 'Sonstiges'];
const BASIS = 'Basis';
const isBasis = item => item.cat === BASIS;
const isAvailable = item => !!item && (item.have || isBasis(item));

const CLAUDE_TEMPLATE = `Schreib mir das Rezept für [GERICHT] genau in diesem Format, ohne weiteren Text:

[Name des Gerichts]
Dauer: 30 Min
Portionen: 2
Aufwand: leicht
Tags: proteinreich

Zutaten:
200 g Nudeln
1 Zwiebel

Zubereitung:
1. Erster Schritt
2. Zweiter Schritt`;

/* ---------- Standarddaten ---------- */

function defaultPantry() {
  const groups = {
    'Basis': ['Salz', 'Pfeffer', 'Öl', 'Olivenöl', 'Zucker', 'Mehl', 'Essig'],
    'Kühlschrank': ['Eier', 'Milch', 'Butter', 'Joghurt', 'Skyr', 'Quark', 'Käse', 'Parmesan', 'Mozzarella', 'Feta', 'Sahne', 'Hähnchenbrust', 'Hackfleisch', 'Lachs', 'Tofu'],
    'Vorrat': ['Nudeln', 'Reis', 'Haferflocken', 'Linsen', 'Kichererbsen', 'Thunfisch', 'Passierte Tomaten', 'Tomatenmark', 'Kokosmilch', 'Brühe', 'Brot', 'Wraps', 'Sojasauce', 'Honig', 'Erdnussbutter', 'Proteinpulver'],
    'Gemüse & Obst': ['Zwiebeln', 'Knoblauch', 'Tomaten', 'Paprika', 'Zucchini', 'Brokkoli', 'Spinat', 'Karotten', 'Kartoffeln', 'Süßkartoffeln', 'Avocado', 'Bananen', 'Beeren', 'Zitronen'],
    'Gewürze': ['Paprikapulver', 'Curry', 'Oregano', 'Basilikum', 'Chili', 'Kreuzkümmel', 'Zimt'],
  };
  const out = [];
  for (const [cat, names] of Object.entries(groups)) {
    names.forEach(name => out.push({ id: uid(), name, cat, have: cat === 'Basis' }));
  }
  return out;
}

function sampleRecipes() {
  const now = Date.now();
  return [
    {
      id: uid(), title: 'Hähnchen-Reis-Bowl', minutes: 25, effort: 1, servings: 2,
      tags: ['proteinreich', 'Meal Prep'], fav: false, createdAt: now - 3,
      ingredients: ['300 g Hähnchenbrust', '150 g Reis', '1 Paprika', '1 Zucchini', '2 EL Sojasauce', '1 EL Öl', 'Salz und Pfeffer'],
      steps: ['Reis nach Packungsanleitung kochen.', 'Hähnchen würfeln, salzen, pfeffern und in Öl 6 bis 8 Minuten anbraten.', 'Paprika und Zucchini klein schneiden und 3 Minuten mitbraten.', 'Mit Sojasauce ablöschen und mit dem Reis in Schüsseln anrichten.'],
      note: '',
    },
    {
      id: uid(), title: 'Skyr-Bowl mit Beeren', minutes: 5, effort: 1, servings: 1,
      tags: ['proteinreich', 'Frühstück', 'vegetarisch', 'schnell'], fav: false, createdAt: now - 2,
      ingredients: ['250 g Skyr', '40 g Haferflocken', '100 g Beeren', '1 TL Honig (optional)', '1 EL Erdnussbutter (optional)'],
      steps: ['Skyr in eine Schüssel geben.', 'Haferflocken und Beeren darauf verteilen.', 'Nach Belieben mit Honig und Erdnussbutter toppen.'],
      note: '',
    },
    {
      id: uid(), title: 'Pasta mit Tomaten-Thunfisch-Soße', minutes: 20, effort: 1, servings: 2,
      tags: ['proteinreich', 'schnell'], fav: false, createdAt: now - 1,
      ingredients: ['200 g Nudeln', '1 Dose Thunfisch', '400 g passierte Tomaten', '1 Zwiebel', '1 Zehe Knoblauch', '1 EL Olivenöl', '1 TL Oregano', 'Salz und Pfeffer', 'Parmesan (optional)'],
      steps: ['Nudeln in Salzwasser kochen.', 'Zwiebel und Knoblauch fein hacken und in Olivenöl glasig dünsten.', 'Passierte Tomaten und Oregano dazugeben, 5 Minuten köcheln lassen.', 'Thunfisch abtropfen lassen, unterrühren und abschmecken.', 'Mit den Nudeln mischen und nach Belieben Parmesan darüber reiben.'],
      note: '',
    },
  ];
}

/* ---------- Zutaten verstehen ---------- */

const UNIT_RE = /^(kg|mg|g|ml|cl|dl|l|liter|el|tl|msp\.?|prisen?|stück|stk\.?|dosen?|pck\.?|päckchen|packungen?|bund|zehen?|scheiben?|becher|tassen?|gläser|glas|handvoll|würfel|blätter|blatt|zweige?|spritzer|schuss)(?=[\s.]|$)\.?/i;
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const STOPWORDS = new Set(['und', 'oder', 'mit', 'etwas', 'frisch', 'frische', 'frischer', 'frischen', 'gehackt', 'gehackte', 'klein', 'kleine', 'große', 'groß', 'grosse', 'rote', 'roter', 'rotes', 'weiße', 'weißer', 'grüne', 'grüner', 'gelbe', 'geriebener', 'gerieben', 'gewürfelt', 'tiefgekühlt', 'tk', 'bio', 'ca', 'zum', 'zur', 'für', 'nach', 'belieben', 'geschmack', 'optional', 'von', 'der', 'die', 'das', 'ein', 'eine', 'einer', 'evtl']);

function toNumber(s) {
  if (!s) return null;
  s = s.trim();
  if (FRACTIONS[s] != null) return FRACTIONS[s];
  let extra = 0;
  const last = s.slice(-1);
  if (FRACTIONS[last] != null) { extra = FRACTIONS[last]; s = s.slice(0, -1); if (!s) return extra; }
  if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return b ? a / b + extra : null; }
  const n = Number(s.replace(',', '.'));
  return isNaN(n) ? null : n + extra;
}

function parseIngredient(raw) {
  const line = String(raw).trim();
  let rest = line.replace(/^(ca\.?|circa|etwa)\s+/i, '');
  let qty = null, qty2 = null, unit = '';
  const m = rest.match(/^(\d+(?:[.,]\d+)?[½¼¾⅓⅔⅛]?|\d+\s*\/\s*\d+|[½¼¾⅓⅔⅛])(?:\s*(?:-|–|bis)\s*(\d+(?:[.,]\d+)?))?\s*/);
  if (m) {
    qty = toNumber(m[1].replace(/\s/g, ''));
    qty2 = m[2] ? toNumber(m[2]) : null;
    rest = rest.slice(m[0].length);
    const u = rest.match(UNIT_RE);
    if (u) { unit = u[0].replace(/\.$/, '') + (u[0].endsWith('.') ? '.' : ''); rest = rest.slice(u[0].length).trim(); }
  }
  const optional = /optional|nach belieben|nach geschmack/i.test(line);
  const name = rest.replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim();
  const words = name.toLowerCase().split(/[^a-zäöüß]+/).filter(w => w && !STOPWORDS.has(w)).map(stem);
  return { raw: line, qty, qty2, unit, rest, name: name || line, optional, words };
}

function stem(w) {
  w = w.toLowerCase().replace(/[^a-zäöüß]/g, '');
  if (w.length > 3) {
    for (const suf of ['en', 'er', 'n', 'e', 's']) {
      if (w.endsWith(suf) && w.length - suf.length >= 2) return w.slice(0, -suf.length);
    }
  }
  return w;
}

function pantryWords(item) {
  if (!item._w || item._wName !== item.name) {
    Object.defineProperty(item, '_w', { value: item.name.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean).map(stem), writable: true, configurable: true, enumerable: false });
    Object.defineProperty(item, '_wName', { value: item.name, writable: true, configurable: true, enumerable: false });
  }
  return item._w;
}

function wordScore(rw, pw) {
  if (rw === pw) return 3;
  if (pw.length >= 4 && rw.startsWith(pw)) return 2;
  if (pw.length >= 4 && rw.endsWith(pw)) return 1;
  return 0;
}

// Findet den passenden Vorrats-Eintrag zu einer Zutat (oder null)
function matchPantry(ing) {
  if (!ing.words.length) return null;
  let best = null, bestScore = 0;
  for (const item of data.pantry) {
    const pws = pantryWords(item);
    if (!pws.length) continue;
    let score = 0, ok = true;
    for (const pw of pws) {
      const s = Math.max(0, ...ing.words.map(rw => wordScore(rw, pw)));
      if (!s) { ok = false; break; }
      score += s;
    }
    if (!ok) continue;
    score = score * 10 + pws.length + (isAvailable(item) ? 0.5 : 0);
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return best;
}

function hasIngredient(ing) {
  if (ing.words.some(w => ALWAYS_AVAILABLE.includes(w))) return true;
  return isAvailable(matchPantry(ing));
}

function recipeStatus(r) {
  const ings = r.ingredients.map(parseIngredient);
  const missing = ings.filter(i => !i.optional && !hasIngredient(i));
  return { ings, missing };
}

/* ---------- Formatierung ---------- */

function fmtQty(n, unit) {
  if (n == null) return '';
  const u = (unit || '').toLowerCase();
  if ((u === 'g' || u === 'ml') && n >= 50) return String(Math.round(n / 5) * 5);
  const whole = Math.floor(n + 1e-9), frac = n - whole;
  const fr = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']].find(([v]) => Math.abs(frac - v) < 0.04);
  if (frac < 0.04) return String(whole);
  if (fr && whole < 10) return (whole ? whole : '') + fr[1];
  return (Math.round(n * 10) / 10).toLocaleString('de-DE');
}

function scaledLine(ing, factor) {
  if (ing.qty == null || factor === 1) return ing.raw;
  const q = fmtQty(ing.qty * factor, ing.unit) + (ing.qty2 != null ? '–' + fmtQty(ing.qty2 * factor, ing.unit) : '');
  return [q, ing.unit, ing.rest].filter(Boolean).join(' ');
}

const effortDots = e => '●'.repeat(e) + '○'.repeat(3 - e);
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ---------- Zustand ---------- */

const recState = {
  section: 'recipes', view: 'list', id: null, servings: null,
  sort: 'new', q: '', fav: false, cookable: false, tag: null,
  draft: null, pantryEdit: false,
};

function resetRecipeView() {
  recState.view = 'list'; recState.id = null; recState.draft = null;
}

function getRecipe(id) { return data.recipes.find(r => r.id === id); }

/* ---------- Ansichten ---------- */

function viewRecipes() {
  if (recState.view === 'detail' && getRecipe(recState.id)) return viewRecipeDetail(getRecipe(recState.id));
  if (recState.view === 'edit' && recState.draft) return viewRecipeEditor();
  recState.view = 'list';

  const openShop = data.shopping.filter(s => !s.done).length;
  const tabs = [['recipes', 'Rezepte'], ['pantry', 'Vorrat'], ['shop', `Einkauf${openShop ? ` (${openShop})` : ''}`]];
  const body = recState.section === 'pantry' ? viewPantry() : recState.section === 'shop' ? viewShopping() : viewRecipeList();

  return `
    <header class="page-head"><p class="eyebrow">Küche</p><h1>Rezepte</h1></header>
    <div class="segtabs" role="tablist">
      ${tabs.map(([id, label]) => `<button role="tab" class="${recState.section === id ? 'on' : ''}" aria-selected="${recState.section === id}" data-action="rec-section" data-section="${id}">${label}</button>`).join('')}
    </div>
    ${body}`;
}

function filteredRecipes() {
  const q = recState.q.trim().toLowerCase();
  let list = data.recipes.map(r => ({ r, st: recipeStatus(r) }));
  if (q) list = list.filter(({ r }) => (r.title + ' ' + r.ingredients.join(' ') + ' ' + r.tags.join(' ')).toLowerCase().includes(q));
  if (recState.fav) list = list.filter(({ r }) => r.fav);
  if (recState.cookable) list = list.filter(({ st }) => st.missing.length === 0);
  if (recState.tag) list = list.filter(({ r }) => r.tags.includes(recState.tag));
  const by = {
    new: (a, b) => (b.r.createdAt || 0) - (a.r.createdAt || 0),
    name: (a, b) => a.r.title.localeCompare(b.r.title, 'de'),
    time: (a, b) => (a.r.minutes || 999) - (b.r.minutes || 999),
    effort: (a, b) => (a.r.effort || 2) - (b.r.effort || 2) || (a.r.minutes || 999) - (b.r.minutes || 999),
    missing: (a, b) => a.st.missing.length - b.st.missing.length || (a.r.minutes || 999) - (b.r.minutes || 999),
  }[recState.sort];
  return list.sort(by);
}

function recipeCardsHTML() {
  const list = filteredRecipes();
  if (!data.recipes.length) return '<p class="empty">Noch keine Rezepte. Leg dein erstes an.</p>';
  if (!list.length) return '<p class="empty">Keine Rezepte passen zu deiner Auswahl.</p>';
  return list.map(({ r, st }) => {
    const n = st.missing.length;
    const badge = n === 0
      ? '<span class="badge ok">Alles da</span>'
      : n <= 2
        ? `<span class="badge warn">Fehlt: ${esc(st.missing.map(i => i.name).join(', '))}</span>`
        : `<span class="badge miss">${n} Zutaten fehlen</span>`;
    return `
      <button class="rec-card" data-action="open-recipe" data-id="${esc(r.id)}">
        <span class="rec-title">${r.fav ? '<span class="star">★</span>' : ''}${esc(r.title)}</span>
        <span class="rec-meta">${r.minutes ? `⏱ ${r.minutes} Min · ` : ''}<span class="dots" title="Aufwand">${effortDots(r.effort || 2)}</span> ${EFFORT[r.effort || 2]}</span>
        ${badge}
      </button>`;
  }).join('');
}

function viewRecipeList() {
  const tags = [...new Set(data.recipes.flatMap(r => r.tags))].sort((a, b) => a.localeCompare(b, 'de'));
  const sorts = [['new', 'Neueste zuerst'], ['name', 'Name'], ['time', 'Kochdauer'], ['effort', 'Aufwand'], ['missing', 'Fehlende Zutaten']];
  return `
    <div class="btn-row top">
      <button class="btn primary" data-action="new-recipe">＋ Neues Rezept</button>
      <button class="btn secondary" data-action="random-recipe">🎲 Vorschlag</button>
    </div>
    <div class="toolbar">
      <input class="input search" type="search" placeholder="Suchen…" value="${esc(recState.q)}" data-input="rec-search" autocomplete="off">
      <select class="select" data-change="rec-sort" aria-label="Sortieren">
        ${sorts.map(([v, l]) => `<option value="${v}" ${recState.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="filter-chips">
      <button class="fchip ${recState.cookable ? 'on' : ''}" data-action="rec-filter" data-f="cookable">✅ Kann ich kochen</button>
      <button class="fchip ${recState.fav ? 'on' : ''}" data-action="rec-filter" data-f="fav">★ Favoriten</button>
      ${tags.map(t => `<button class="fchip ${recState.tag === t ? 'on' : ''}" data-action="rec-filter" data-f="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <div id="rec-list" class="rec-list">${recipeCardsHTML()}</div>`;
}

function viewRecipeDetail(r) {
  const base = r.servings || 2;
  const servings = recState.servings || base;
  const factor = servings / base;
  const st = recipeStatus(r);
  return `
    <header class="page-head">
      <button class="back" data-action="rec-back">‹ Rezepte</button>
      <h1>${esc(r.title)}</h1>
      <div class="chips">
        ${r.minutes ? `<span class="chip">⏱ ${r.minutes} Min</span>` : ''}
        <span class="chip"><span class="dots">${effortDots(r.effort || 2)}</span> ${EFFORT[r.effort || 2]}</span>
        ${r.tags.map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}
      </div>
    </header>

    <section class="card">
      <div class="row-between">
        <h2>Zutaten</h2>
        <div class="stepper small">
          <button class="icon-btn" data-action="rec-serv" data-d="-1" aria-label="Weniger Portionen" ${servings <= 1 ? 'disabled' : ''}>−</button>
          <span><b>${servings}</b> ${servings === 1 ? 'Portion' : 'Portionen'}</span>
          <button class="icon-btn" data-action="rec-serv" data-d="1" aria-label="Mehr Portionen">+</button>
        </div>
      </div>
      <ul class="ing-list">
        ${st.ings.map(i => {
          const have = hasIngredient(i);
          return `<li class="${have ? 'have' : i.optional ? 'opt' : 'miss'}">
            <span class="ing-mark" aria-label="${have ? 'vorhanden' : 'fehlt'}">${have ? '✓' : '○'}</span>
            <span>${esc(scaledLine(i, factor))}</span>
          </li>`;
        }).join('')}
      </ul>
      ${st.missing.length
        ? `<button class="btn add" data-action="rec-to-shop" data-id="${esc(r.id)}">🛒 ${st.missing.length} fehlende ${st.missing.length === 1 ? 'Zutat' : 'Zutaten'} auf die Einkaufsliste</button>`
        : '<p class="done-banner">✓ Du hast alles da</p>'}
    </section>

    <section class="card">
      <h2>Zubereitung</h2>
      <ol class="steps">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}
    </section>

    <div class="btn-row">
      <button class="btn secondary" data-action="rec-fav" data-id="${esc(r.id)}">${r.fav ? '★ Favorit' : '☆ Favorit'}</button>
      <button class="btn secondary" data-action="edit-recipe" data-id="${esc(r.id)}">Bearbeiten</button>
    </div>
    <button class="btn ghost danger full" data-action="delete-recipe" data-id="${esc(r.id)}">Rezept löschen</button>`;
}

function viewRecipeEditor() {
  const d = recState.draft;
  const isCustomMin = d.minutes && !MINUTE_PRESETS.includes(d.minutes);
  const allTags = [...new Set([...TAG_PRESETS, ...data.recipes.flatMap(r => r.tags), ...d.tags])];
  return `
    <header class="page-head">
      <button class="back" data-action="rec-cancel-edit">‹ Abbrechen</button>
      <h1>${d.id ? 'Rezept bearbeiten' : 'Neues Rezept'}</h1>
    </header>

    ${d.id ? '' : `
    <section class="card paste-card">
      <div>
        <h2>Schnell einfügen</h2>
        <p class="hint">Rezepttext aus Website, Notizen oder von Claude einfügen. Die Felder werden automatisch ausgefüllt.</p>
      </div>
      <button class="btn primary" data-action="rec-paste">Aus Text einfügen</button>
    </section>`}

    <section class="card form">
      <label class="field-label" for="rf-title">Name</label>
      <input id="rf-title" class="input" data-field="title" value="${esc(d.title)}" placeholder="z.B. Linsen-Curry" maxlength="80" autocomplete="off">

      <label class="field-label" for="rf-ing">Zutaten <span class="lbl-hint">eine pro Zeile</span></label>
      <textarea id="rf-ing" class="input area" data-field="ingredients" rows="7" placeholder="200 g Nudeln&#10;1 Zwiebel&#10;2 EL Olivenöl&#10;Parmesan (optional)">${esc(d.ingredients)}</textarea>

      <label class="field-label" for="rf-steps">Zubereitung <span class="lbl-hint">ein Schritt pro Zeile</span></label>
      <textarea id="rf-steps" class="input area" data-field="steps" rows="6" placeholder="Nudeln kochen.&#10;Zwiebel anbraten.&#10;Alles mischen.">${esc(d.steps)}</textarea>

      <label class="field-label">Dauer</label>
      <div class="seg">
        ${MINUTE_PRESETS.map(m => `<button type="button" class="seg-btn ${d.minutes === m ? 'on' : ''}" data-action="rf-min" data-min="${m}">${m}${m === 90 ? '+' : ''} Min</button>`).join('')}
        <button type="button" class="seg-btn ${isCustomMin || d.customMin ? 'on' : ''}" data-action="rf-min" data-min="custom">Eigene</button>
      </div>
      ${isCustomMin || d.customMin ? `
        <div class="custom-min">
          <input class="input" type="number" inputmode="numeric" min="1" max="999" data-field="minutes" value="${isCustomMin ? d.minutes : ''}" placeholder="z.B. 75">
          <span>Minuten</span>
        </div>` : ''}

      <label class="field-label">Aufwand</label>
      <div class="seg">
        ${[1, 2, 3].map(e => `<button type="button" class="seg-btn ${d.effort === e ? 'on' : ''}" data-action="rf-effort" data-e="${e}">${EFFORT[e]}</button>`).join('')}
      </div>

      <div class="row-between gap-top">
        <label class="field-label inline">Portionen</label>
        <div class="stepper small">
          <button class="icon-btn" data-action="rf-serv" data-d="-1" ${d.servings <= 1 ? 'disabled' : ''} aria-label="Weniger">−</button>
          <b>${d.servings}</b>
          <button class="icon-btn" data-action="rf-serv" data-d="1" aria-label="Mehr">+</button>
        </div>
      </div>

      <label class="field-label">Tags</label>
      <div class="filter-chips wrap">
        ${allTags.map(t => `<button type="button" class="fchip ${d.tags.includes(t) ? 'on' : ''}" data-action="rf-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
        <button type="button" class="fchip add" data-action="rf-newtag">＋ Tag</button>
      </div>

      <label class="field-label" for="rf-note">Notiz <span class="lbl-hint">optional</span></label>
      <textarea id="rf-note" class="input area" data-field="note" rows="2" placeholder="z.B. schmeckt auch kalt">${esc(d.note)}</textarea>
    </section>

    <button class="btn primary full big" data-action="rec-save">Rezept speichern</button>`;
}

function viewPantry() {
  const items = data.pantry;
  const haveCount = items.filter(isAvailable).length;
  const edit = recState.pantryEdit;
  // Zutaten aus Rezepten, die noch nicht im Vorrat stehen
  const seen = new Set();
  const unknown = [];
  data.recipes.forEach(r => r.ingredients.map(parseIngredient).forEach(i => {
    if (i.optional || !i.words.length || i.words.some(w => ALWAYS_AVAILABLE.includes(w)) || matchPantry(i)) return;
    const key = i.words.join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    unknown.push(cap(i.name));
  }));

  const cats = [...PANTRY_CATS, ...new Set(items.map(i => i.cat).filter(c => !PANTRY_CATS.includes(c)))];
  return `
    <section class="card">
      <div class="row-between">
        <p class="hint" style="margin:0 !important">${edit
          ? 'Tippe auf eine Zutat, um sie zur <b>Basiszutat</b> zu machen, zu verschieben oder zu löschen.'
          : `Tippe an, was du zuhause hast. <b>${haveCount}</b> vorhanden.`}</p>
        <button class="btn small ${edit ? 'primary' : 'secondary'}" data-action="pantry-edit">${edit ? 'Fertig' : 'Bearbeiten'}</button>
      </div>
    </section>

    ${unknown.length ? `
      <section class="card">
        <h2>Aus deinen Rezepten</h2>
        <p class="hint">Diese Zutaten kennt dein Vorrat noch nicht. Tippe an, um sie als vorhanden hinzuzufügen.</p>
        <div class="pantry-chips">
          ${unknown.map(n => `<button class="pchip add" data-action="pantry-add-known" data-name="${esc(n)}">＋ ${esc(n)}</button>`).join('')}
        </div>
      </section>` : ''}

    ${cats.map(cat => {
      const list = items.filter(i => i.cat === cat);
      const basis = cat === BASIS;
      if (!list.length && !basis) return '';
      return `
        <section class="card ${basis ? 'basis-card' : ''}">
          <div class="card-head"><h2>${basis ? '📌 Basiszutaten' : esc(cat)}</h2><span class="count">${basis ? list.length : `${list.filter(i => i.have).length}/${list.length}`}</span></div>
          ${basis ? '<p class="hint basis-hint">Gelten immer als vorhanden und landen nie auf der Einkaufsliste.</p>' : ''}
          <div class="pantry-chips">
            ${list.map(i => edit
              ? `<button class="pchip edit ${basis ? 'basis' : ''}" data-action="pantry-item" data-id="${esc(i.id)}">${esc(i.name)} <span aria-hidden="true">⋯</span></button>`
              : basis
                ? `<button class="pchip basis" data-action="pantry-basis-info" data-id="${esc(i.id)}">${esc(i.name)}</button>`
                : `<button class="pchip ${i.have ? 'on' : ''}" data-action="pantry-toggle" data-id="${esc(i.id)}" aria-pressed="${i.have}">${i.have ? '✓ ' : ''}${esc(i.name)}</button>`).join('')
              || '<p class="empty" style="padding:0">Noch keine. Unter „Bearbeiten“ kannst du Zutaten zur Basis machen.</p>'}
          </div>
        </section>`;
    }).join('')}

    <section class="card">
      <h2>Zutat hinzufügen</h2>
      <div class="toolbar gap-top">
        <input id="pantry-new" class="input" placeholder="z.B. Halloumi" maxlength="40" autocomplete="off">
        <select id="pantry-cat" class="select" aria-label="Kategorie">
          ${PANTRY_CATS.map(c => `<option value="${esc(c)}" ${c === 'Kühlschrank' ? 'selected' : ''}>${c === BASIS ? 'Basiszutat' : esc(c)}</option>`).join('')}
        </select>
      </div>
      <button class="btn add gap-top" data-action="pantry-add">＋ Hinzufügen</button>
    </section>`;
}

function viewShopping() {
  const list = data.shopping;
  const done = list.filter(s => s.done).length;
  return `
    <section class="card">
      <div class="toolbar">
        <input id="shop-new" class="input" placeholder="Artikel hinzufügen" maxlength="60" autocomplete="off" data-enter="shop-add">
        <button class="btn primary" data-action="shop-add">＋</button>
      </div>
      ${list.length ? `
        <ul class="shop-list">
          ${list.map(s => `
            <li class="${s.done ? 'done' : ''}">
              <button class="shop-item" data-action="shop-toggle" data-id="${esc(s.id)}" aria-pressed="${!!s.done}">
                <span class="check" aria-hidden="true">${ICON_CHECK}</span>
                <span class="shop-name">${esc(s.name)}</span>
                ${s.from ? `<small>${esc(s.from)}</small>` : ''}
              </button>
              <button class="icon-btn" data-action="shop-del" data-id="${esc(s.id)}" aria-label="${esc(s.name)} löschen">${ICON_CLOSE}</button>
            </li>`).join('')}
        </ul>` : '<p class="empty" style="padding-top:14px">Die Einkaufsliste ist leer. In einem Rezept kannst du fehlende Zutaten mit einem Tipp hinzufügen.</p>'}
    </section>
    ${list.length ? `
      <div class="btn-row">
        <button class="btn primary" data-action="shop-done" ${done ? '' : 'disabled'}>Gekauft → in Vorrat${done ? ` (${done})` : ''}</button>
        <button class="btn secondary" data-action="shop-share">Teilen</button>
      </div>` : ''}`;
}

// Kleine Karte für die Heute-Ansicht an Trainingstagen
function proteinRecipeHint() {
  const pr = data.recipes.filter(r => r.tags.includes('proteinreich'));
  if (!pr.length) return '';
  const ranked = pr.map(r => ({ r, n: recipeStatus(r).missing.length })).sort((a, b) => a.n - b.n);
  const pickFrom = ranked.filter(x => x.n === ranked[0].n);
  const { r, n } = pickFrom[new Date().getDate() % pickFrom.length];
  return `
    <section class="card hint-card">
      <p class="eyebrow">Nach dem Training</p>
      <button class="link-row" data-action="open-recipe" data-id="${esc(r.id)}">
        <span class="lr-emoji" aria-hidden="true">💪</span>
        <span class="lr-text"><b>${esc(r.title)}</b><small>${r.minutes ? r.minutes + ' Min · ' : ''}${n === 0 ? 'alles da' : n + ' Zutat' + (n === 1 ? '' : 'en') + ' fehlen'}</small></span>
        <span aria-hidden="true">›</span>
      </button>
    </section>`;
}

/* ---------- Text-Import ---------- */

function cleanLines(text, numbered) {
  return String(text || '').split('\n')
    .map(l => l.trim().replace(/^[-•*·–]\s*/, ''))
    .map(l => numbered ? l.replace(/^(schritt\s*)?\d+\s*[.):]\s*/i, '') : l)
    .filter(Boolean);
}

function parseRecipeText(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map(l => l.trim());
  const out = { title: '', ingredients: [], steps: [], minutes: null, servings: null, effort: null, tags: [], note: [] };
  let section = null, sawHeader = false;
  const loose = [];

  for (let line of lines) {
    if (!line) continue;
    const plain = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    const low = plain.toLowerCase();

    if (/^(zutaten|einkaufsliste|ingredients)\b/.test(low)) { section = 'ing'; sawHeader = true; continue; }
    if (/^(zubereitung|anleitung|schritte|vorgehen|vorgehensweise|so geht'?s|instructions|method)\b/.test(low)) { section = 'steps'; sawHeader = true; continue; }
    if (/^(notiz|tipp|hinweis|notes?)\b\s*:?/.test(low)) { section = 'note'; const rest = plain.replace(/^[^:]*:\s*/, ''); if (rest && rest !== plain) out.note.push(rest); continue; }

    let m;
    if ((m = low.match(/^(gesamt)?(dauer|zeit|kochzeit|zubereitungszeit|arbeitszeit)\s*:?\s*(?:ca\.?\s*)?(\d+)\s*(min|minuten|std|stunden|h)?/))) {
      out.minutes = Number(m[3]) * (/^(std|stunden|h)$/.test(m[4] || '') ? 60 : 1); continue;
    }
    if ((m = low.match(/^(portionen|portion|personen|für)\s*:?\s*(\d+)/))) { out.servings = Number(m[2]); continue; }
    if ((m = low.match(/^(aufwand|schwierigkeit)\s*:?\s*(\w+)/))) {
      out.effort = /leicht|einfach/.test(m[2]) ? 1 : /mittel|normal/.test(m[2]) ? 2 : 3; continue;
    }
    if ((m = plain.match(/^tags?\s*:\s*(.+)$/i))) { out.tags = m[1].split(/[,;]/).map(t => t.trim()).filter(Boolean); continue; }
    if (/^(titel|name)\s*:/i.test(plain)) { out.title = plain.replace(/^[^:]*:\s*/, ''); continue; }

    if (section === 'ing') out.ingredients.push(plain);
    else if (section === 'steps') out.steps.push(plain);
    else if (section === 'note') out.note.push(plain);
    else if (!out.title) out.title = plain.replace(/:$/, '');
    else loose.push(plain);
  }

  // Ohne Überschriften: Zeilen mit Mengenangabe sind Zutaten, der Rest Schritte
  if (!sawHeader) {
    loose.forEach(l => (/^(ca\.?\s*)?[\d½¼¾⅓⅔]/.test(l) && l.length < 60 ? out.ingredients : out.steps).push(l));
  } else {
    out.note.unshift(...loose);
  }
  out.ingredients = cleanLines(out.ingredients.join('\n'));
  out.steps = cleanLines(out.steps.join('\n'), true);
  return out;
}

function draftFrom(r) {
  return r ? {
    id: r.id, title: r.title, ingredients: r.ingredients.join('\n'), steps: r.steps.join('\n'),
    minutes: r.minutes || null, effort: r.effort || 2, servings: r.servings || 2, tags: [...r.tags], note: r.note || '', customMin: false,
  } : { id: null, title: '', ingredients: '', steps: '', minutes: null, effort: 1, servings: 2, tags: [], note: '', customMin: false };
}

function openPasteSheet() {
  openSheet(`
    <h3>Aus Text einfügen</h3>
    <p class="hint">Füge ein ganzes Rezept ein. Am besten klappt es mit den Überschriften <b>Zutaten</b> und <b>Zubereitung</b>.</p>
    <textarea id="paste-text" class="input area" rows="9" placeholder="Linsen-Curry&#10;Dauer: 30 Min&#10;&#10;Zutaten:&#10;200 g rote Linsen&#10;…&#10;&#10;Zubereitung:&#10;1. …"></textarea>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="close-sheet">Abbrechen</button>
      <button class="btn primary" id="paste-go">Übernehmen</button>
    </div>
    <div class="tip-box">
      <p><b>Tipp:</b> Lass dir Rezepte von Claude passend formatieren. Vorlage kopieren, [GERICHT] ersetzen, Antwort hier einfügen.</p>
      <button class="btn secondary small" id="copy-template">Vorlage kopieren</button>
    </div>`, root => {
    $('#copy-template', root).onclick = async () => {
      try { await navigator.clipboard.writeText(CLAUDE_TEMPLATE); toast('Vorlage kopiert'); }
      catch { toast('Kopieren nicht möglich'); }
    };
    $('#paste-go', root).onclick = () => {
      const txt = $('#paste-text', root).value;
      if (!txt.trim()) { $('#paste-text', root).focus(); return; }
      const p = parseRecipeText(txt);
      const d = recState.draft;
      if (p.title) d.title = p.title;
      if (p.ingredients.length) d.ingredients = p.ingredients.join('\n');
      if (p.steps.length) d.steps = p.steps.join('\n');
      if (p.minutes) { d.minutes = p.minutes; d.customMin = !MINUTE_PRESETS.includes(p.minutes); }
      if (p.servings) d.servings = p.servings;
      if (p.effort) d.effort = p.effort;
      if (p.tags.length) d.tags = [...new Set([...d.tags, ...p.tags])];
      if (p.note.length) d.note = p.note.join('\n');
      closeSheet(); render();
      toast(`${p.ingredients.length} Zutaten und ${p.steps.length} Schritte erkannt`);
    };
    setTimeout(() => $('#paste-text', root).focus(), 260);
  });
}

function openPantryItemSheet(item) {
  const basis = isBasis(item);
  const cats = PANTRY_CATS.filter(c => c !== BASIS);
  openSheet(`
    <h3>${esc(item.name)}</h3>
    <button class="btn ${basis ? 'secondary' : 'primary'} full" id="pi-basis">${basis ? 'Keine Basiszutat mehr' : '📌 Als Basiszutat festlegen'}</button>
    <p class="hint">${basis ? 'Danach musst du sie wieder selbst abhaken.' : 'Basiszutaten gelten immer als vorhanden.'}</p>
    ${basis ? '' : `
      <label class="field-label" for="pi-cat">Kategorie</label>
      <select id="pi-cat" class="select wide">
        ${cats.map(c => `<option ${c === item.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>`}
    <div class="sheet-actions">
      <button class="btn ghost danger" id="pi-del">Löschen</button>
      <button class="btn secondary" data-action="close-sheet">Fertig</button>
    </div>`, root => {
    $('#pi-basis', root).onclick = () => {
      if (basis) { item.cat = item.prevCat && item.prevCat !== BASIS ? item.prevCat : 'Sonstiges'; item.have = true; delete item.prevCat; }
      else { item.prevCat = item.cat; item.cat = BASIS; item.have = true; }
      save(); closeSheet(); render();
      toast(basis ? `${item.name} ist keine Basiszutat mehr` : `${item.name} ist jetzt eine Basiszutat`);
    };
    const sel = $('#pi-cat', root);
    if (sel) sel.onchange = () => { item.cat = sel.value; save(); render(); };
    $('#pi-del', root).onclick = () => {
      if (!confirm(`„${item.name}“ aus dem Vorrat löschen?`)) return;
      data.pantry = data.pantry.filter(x => x !== item);
      save(); closeSheet(); render();
    };
  });
}

/* ---------- Aktionen ---------- */

function openRecipe(id) {
  state.tab = 'recipes';
  recState.view = 'detail'; recState.id = id; recState.servings = null;
  render(); window.scrollTo(0, 0);
}

function addToPantry(name, have = true, cat = 'Sonstiges') {
  const probe = parseIngredient(name);
  const existing = matchPantry(probe);
  if (existing && pantryWords(existing).join(' ') === probe.words.join(' ')) {
    existing.have = have || existing.have;
    if (cat === BASIS && !isBasis(existing)) { existing.prevCat = existing.cat; existing.cat = BASIS; }
    return existing;
  }
  const item = { id: uid(), name: cap(name.trim()), cat, have };
  data.pantry.push(item);
  return item;
}

const recipeActions = {
  'rec-section'(el) { recState.section = el.dataset.section; resetRecipeView(); render(); },
  'open-recipe'(el) { openRecipe(el.dataset.id); },
  'rec-back'() { resetRecipeView(); render(); },

  'rec-filter'(el) {
    const f = el.dataset.f;
    if (f === 'tag') recState.tag = recState.tag === el.dataset.tag ? null : el.dataset.tag;
    else recState[f] = !recState[f];
    render();
  },

  'random-recipe'() {
    if (!data.recipes.length) { toast('Noch keine Rezepte vorhanden'); return; }
    const scored = data.recipes.map(r => ({ r, n: recipeStatus(r).missing.length }));
    const min = Math.min(...scored.map(x => x.n));
    let pool = scored.filter(x => x.n === min);
    const favs = pool.filter(x => x.r.fav);
    if (favs.length && Math.random() < 0.6) pool = favs;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    openRecipe(pick.r.id);
    toast(min === 0 ? 'Dafür hast du alles da' : `Dafür fehlen ${min} Zutat${min === 1 ? '' : 'en'}`);
  },

  'rec-serv'(el) {
    const r = getRecipe(recState.id); if (!r) return;
    recState.servings = Math.max(1, (recState.servings || r.servings || 2) + Number(el.dataset.d));
    render();
  },

  'rec-fav'(el) { const r = getRecipe(el.dataset.id); if (!r) return; r.fav = !r.fav; save(); render(); },

  'rec-to-shop'(el) {
    const r = getRecipe(el.dataset.id); if (!r) return;
    const { missing } = recipeStatus(r);
    let added = 0;
    missing.forEach(i => {
      const name = cap(i.name);
      if (data.shopping.some(s => !s.done && s.name.toLowerCase() === name.toLowerCase())) return;
      data.shopping.push({ id: uid(), name, from: r.title, done: false });
      added++;
    });
    save(); render();
    toast(added ? `${added} auf die Einkaufsliste gesetzt` : 'Steht schon auf der Einkaufsliste');
  },

  'new-recipe'() { recState.view = 'edit'; recState.draft = draftFrom(null); render(); window.scrollTo(0, 0); },
  'edit-recipe'(el) { const r = getRecipe(el.dataset.id); if (!r) return; recState.view = 'edit'; recState.draft = draftFrom(r); render(); window.scrollTo(0, 0); },
  'rec-cancel-edit'() {
    const d = recState.draft;
    recState.draft = null;
    recState.view = d && d.id ? 'detail' : 'list';
    render();
  },
  'rec-paste'() { openPasteSheet(); },

  'rf-min'(el) {
    const d = recState.draft;
    if (el.dataset.min === 'custom') { d.customMin = true; if (MINUTE_PRESETS.includes(d.minutes)) d.minutes = null; }
    else { d.customMin = false; const m = Number(el.dataset.min); d.minutes = d.minutes === m ? null : m; }
    render();
  },
  'rf-effort'(el) { recState.draft.effort = Number(el.dataset.e); render(); },
  'rf-serv'(el) { const d = recState.draft; d.servings = Math.max(1, Math.min(20, d.servings + Number(el.dataset.d))); render(); },
  'rf-tag'(el) {
    const d = recState.draft, t = el.dataset.tag;
    d.tags = d.tags.includes(t) ? d.tags.filter(x => x !== t) : [...d.tags, t];
    render();
  },
  'rf-newtag'() {
    const t = (prompt('Neuer Tag') || '').trim().slice(0, 24);
    if (!t) return;
    if (!recState.draft.tags.includes(t)) recState.draft.tags.push(t);
    render();
  },

  'rec-save'() {
    const d = recState.draft;
    const title = d.title.trim();
    const ingredients = cleanLines(d.ingredients);
    const steps = cleanLines(d.steps, true);
    if (!title) { toast('Bitte einen Namen eingeben'); $('#rf-title') && $('#rf-title').focus(); return; }
    if (!ingredients.length) { toast('Bitte mindestens eine Zutat eintragen'); $('#rf-ing') && $('#rf-ing').focus(); return; }
    const minutes = Number(d.minutes) > 0 ? Math.round(Number(d.minutes)) : null;
    const rec = { title, ingredients, steps, minutes, effort: d.effort || 2, servings: d.servings || 2, tags: d.tags, note: d.note.trim() };
    let id = d.id;
    if (id) Object.assign(getRecipe(id), rec);
    else { id = uid(); data.recipes.push({ id, fav: false, createdAt: Date.now(), ...rec }); }
    save();
    recState.draft = null;
    openRecipe(id);
    toast('Rezept gespeichert');
  },

  'delete-recipe'(el) {
    const r = getRecipe(el.dataset.id);
    if (!r || !confirm(`„${r.title}“ wirklich löschen?`)) return;
    const idx = data.recipes.indexOf(r);
    data.recipes.splice(idx, 1);
    save(); resetRecipeView(); render();
    toast('Rezept gelöscht', { label: 'Rückgängig', fn: () => { data.recipes.splice(idx, 0, r); save(); render(); } });
  },

  'pantry-toggle'(el) { const i = data.pantry.find(x => x.id === el.dataset.id); if (!i) return; i.have = !i.have; save(); render(); },
  'pantry-edit'() { recState.pantryEdit = !recState.pantryEdit; render(); },
  'pantry-item'(el) { const i = data.pantry.find(x => x.id === el.dataset.id); if (i) openPantryItemSheet(i); },
  'pantry-basis-info'(el) {
    const i = data.pantry.find(x => x.id === el.dataset.id);
    if (i) toast(`${i.name} ist Basiszutat. Ändern unter „Bearbeiten“`);
  },
  'pantry-add-known'(el) { addToPantry(el.dataset.name, true); save(); render(); toast(`${el.dataset.name} ist im Vorrat`); },
  'pantry-add'() {
    const input = $('#pantry-new');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    addToPantry(name, true, $('#pantry-cat').value);
    save(); render();
    toast(`${cap(name)} hinzugefügt`);
  },

  'shop-add'() {
    const input = $('#shop-new');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    data.shopping.push({ id: uid(), name: cap(name), done: false });
    save(); render();
    setTimeout(() => $('#shop-new') && $('#shop-new').focus(), 0);
  },
  'shop-toggle'(el) { const s = data.shopping.find(x => x.id === el.dataset.id); if (!s) return; s.done = !s.done; save(); render(); },
  'shop-del'(el) { data.shopping = data.shopping.filter(x => x.id !== el.dataset.id); save(); render(); },
  'shop-done'() {
    const bought = data.shopping.filter(s => s.done);
    bought.forEach(s => addToPantry(s.name, true));
    data.shopping = data.shopping.filter(s => !s.done);
    save(); render();
    toast(`${bought.length} ${bought.length === 1 ? 'Artikel' : 'Artikel'} in den Vorrat übernommen`);
  },
  async 'shop-share'() {
    const open = data.shopping.filter(s => !s.done).map(s => '• ' + s.name).join('\n');
    if (!open) { toast('Nichts Offenes auf der Liste'); return; }
    const text = 'Einkaufsliste\n' + open;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Liste kopiert'); }
    } catch (err) { if (!err || err.name !== 'AbortError') toast('Teilen nicht möglich'); }
  },
};

/* ---------- Eingabefelder ---------- */

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.field && recState.draft) {
    const v = t.dataset.field === 'minutes' ? (Number(t.value) || null) : t.value;
    recState.draft[t.dataset.field] = v;
  } else if (t.dataset.input === 'rec-search') {
    recState.q = t.value;
    const list = $('#rec-list');
    if (list) list.innerHTML = recipeCardsHTML();
  }
});

document.addEventListener('change', e => {
  if (e.target.dataset.change === 'rec-sort') { recState.sort = e.target.value; render(); }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'shop-new') { e.preventDefault(); recipeActions['shop-add'](); }
  if (e.target.id === 'pantry-new') { e.preventDefault(); recipeActions['pantry-add'](); }
});

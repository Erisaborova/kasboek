/* Kasboek · front-end. Leest de stand uit het Apps Script en toont die. De Sheet rekent; deze app
   rekent niets uit behalve een voorproefje (≈) van het aandeel naar rato bij een nieuw voorschot. */
'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('kb-' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('kb-' + k, JSON.stringify(v)); } catch (e) { /* privé-venster */ } },
  del(k) { try { localStorage.removeItem('kb-' + k); } catch (e) { /* niets */ } }
};
const eur = n => (n < 0 ? '−' : '') + '€\u00a0' + Math.abs(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = t => { t = String(t || '').trim(); return !t || t === '-' ? '—' : /€/.test(t) ? t.replace('€', '€\u00a0').replace('-€', '−€') : '€\u00a0' + t; };
const plainAmount = n => Math.abs(n).toFixed(2).replace('.', ',');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nlDate = iso => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const periodName = p => /^\d{6}$/.test(p || '') ? `${MONTHS[Number(p.slice(4)) - 1]} ${p.slice(0, 4)}` : (p || '');
const stripMark = s => String(s || '').replace(/^[\s❗!⚠️️]+/u, '');
const isAlert = s => /^\s*(❗|!|⚠)/u.test(String(s || ''));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));

const DEMO = new URLSearchParams(location.search).has('demo');
let config = null, pin = null, user = null, state = null;
let view = 'home', spendTab = 'tx', settleTab = 'adv', cat = 'Alles', card = 'Beide', txShown = 80;

/* ---------- Opstarten ---------- */

function readLink() {
  // De geheime link: …/#k=<base64url van {"u": web-app-URL, "t": token}>
  const m = /[#&]k=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return;
  try {
    const raw = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(raw.u) && typeof raw.t === 'string' && raw.t.length >= 24) {
      store.set('config', { url: raw.u, token: raw.t });
    }
  } catch (e) { /* ongeldige link: negeren */ }
  history.replaceState(null, '', location.pathname + location.search);
}

async function init() {
  if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
  readLink();
  config = store.get('config');
  pin = store.get('pin');
  user = store.get('user');
  state = store.get('state');
  bindUi();
  if (!DEMO && !config) { show('gateLink'); return; }
  if (state) renderAll();
  if (!DEMO && !pin) { showPin(); return; }
  await loadState();
  if (!user) chooseWho();
}

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

/* ---------- Verbinding ---------- */

async function api(action, data) {
  if (!navigator.onLine) throw new Error('Je bent offline. Opslaan kan pas als je weer verbinding hebt.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let res;
  try {
    res = await fetch(config.url, {
      method: 'POST', redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, token: config.token, pin }, data))
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'De Sheet reageert niet. Probeer het zo opnieuw.' : 'Geen verbinding met de Sheet. Probeer het opnieuw.');
  } finally { clearTimeout(timer); }
  let body;
  try { body = await res.json(); } catch (e) { throw new Error('Onverwacht antwoord van de Sheet. Probeer het opnieuw.'); }
  if (!body.ok) { const err = new Error(body.error || 'Er ging iets mis.'); err.auth = !!body.auth; throw err; }
  return body;
}

async function loadState() {
  try {
    if (DEMO) {
      const res = await fetch('demo.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Geen demo.json gevonden.');
      state = await res.json();
    } else {
      state = (await api('state')).state;
    }
    store.set('state', state);
    banner('');
    renderAll();
  } catch (e) {
    if (e.auth) { store.del('pin'); pin = null; showPin(e.message); return; }
    if (state) banner(`${e.message} Je ziet de stand van ${freshness()}.`);
    else banner(e.message);
  }
}

// Schrijven: alleen online, nooit stil in een wachtrij. Het antwoord bevat de nieuwe stand.
async function write(action, data, okMsg) {
  if (DEMO) { toast('Demo: niets opgeslagen'); return null; }
  const r = await api(action, data);
  state = r.state;
  store.set('state', state);
  renderAll();
  if (okMsg) toast(r.duplicate ? 'Stond er al; niets dubbel opgeslagen' : okMsg);
  return r;
}

function banner(msg) { $('banner').textContent = msg; $('banner').classList.toggle('hidden', !msg); }
function freshness() {
  if (!state || !state.fetchedAt) return 'eerder';
  const d = new Date(state.fetchedAt);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}., ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- Pincode en wie ben jij ---------- */

let pinEntry = '';
function showPin(msg) {
  pinEntry = ''; drawPin(); $('pinErr').textContent = msg || ''; show('gatePin');
}
function drawPin() { $('pinDots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('f', i < pinEntry.length)); }
async function padKey(k) {
  if (k === 'wis') pinEntry = pinEntry.slice(0, -1);
  else if (pinEntry.length < 4) pinEntry += k;
  drawPin();
  if (pinEntry.length < 4) return;
  pin = pinEntry;
  $('pinErr').textContent = 'Even controleren…';
  try {
    state = (await api('state')).state;
    store.set('pin', pin); store.set('state', state);
    hide('gatePin'); banner(''); renderAll();
    if (!user) chooseWho();
  } catch (e) {
    pin = null; pinEntry = ''; drawPin();
    $('pinErr').textContent = e.message;
  }
}

function people() { return (state && state.people) || [{ name: 'Erisa' }, { name: 'Cas' }]; }
function ink(name) { return people()[0].name === name ? 'e-ink' : 'c-ink'; }
function other(name) { return people().map(p => p.name).find(n => n !== name); }

function chooseWho() {
  $('chooseWho').innerHTML = people().map(p =>
    `<button data-who="${esc(p.name)}"><span class="av ${ink(p.name)}">${esc(p.name[0])}</span>Ik ben ${esc(p.name)}</button>`).join('');
  show('gateWho');
}
function setUser(name) {
  user = name; store.set('user', name); hide('gateWho'); renderAll();
}

/* ---------- Weergave ---------- */

const line = (label, value, cls = '') => `<div class="line ${cls}"><span>${label}</span><span>${value}</span></div>`;

function renderAll() {
  if (!state) return;
  if (!user || !state[user]) { renderHeader(); return; }
  renderHeader(); renderHome(); renderTodo(); renderSpend(); renderSettle(); renderMore();
}

function openTodos(name) { return (state.todos || []).filter(t => !t.done && (!name || t.who === name)); }
function todoFor(kind, name) {
  return (state.todos || []).find(t => t.who === name && (kind === 'pay' ? /maandbijdrage/i.test(t.what) : /terug/i.test(t.what)));
}

function renderHeader() {
  const titles = { todo: 'Te doen', spend: 'Uitgaven', settle: 'Verrekenen', more: 'Meer' };
  $('topH').textContent = view === 'home' ? (state.title || 'Kasboek') : titles[view];
  const n = user ? openTodos(user).length : 0;
  $('topS').textContent = view === 'home'
    ? [state.date, user ? (n ? `${n} open voor jou` : 'niets open voor jou') : ''].filter(Boolean).join(' · ')
    : (state.title || '');
  if (user) {
    $('whoBtn').classList.remove('hidden');
    $('whoAv').textContent = user[0]; $('whoAv').className = 'av ' + ink(user); $('whoName').textContent = user;
  }
  const open = openTodos().length;
  $('badge').textContent = open; $('badge').classList.toggle('hidden', !open);
}

function setPill(el, todo) {
  if (!todo) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.className = 'pill ' + (todo.done ? 'done' : '');
  el.textContent = todo.done ? 'Gedaan' : 'Nog open';
}

function direction() {
  // Netto onderling volgens Dashboard D30 (vanuit Erisa gezien): > 0 betekent dat de ander aan de eerste betaalt.
  const first = people()[0].name, second = people()[1].name;
  const net = state[first].direct.net.value || 0;
  return { net, amount: Math.abs(net), payer: net >= 0 ? second : first, payee: net >= 0 ? first : second };
}

function renderHome() {
  const me = state[user], o = other(user), you = state[o];
  $('payTotal').textContent = money(me.total.text);
  $('payOther').textContent = `${o} maakt ${money(you.total.text)} over`;
  let h = me.lines.map(l => isAlert(l.label)
    ? line(esc(stripMark(l.label)), esc(l.text), 'alert')
    : line(esc(l.label), esc(money(l.text)))).join('');
  h += line('Waarvan naar de buffer', esc(money(me.buffer.text)), 'minor');
  h += line('Totaal over te maken', esc(money(me.total.text)), 'total');
  $('payLines').innerHTML = h;
  setPill($('payPill'), todoFor('pay', user));

  const dir = direction();
  if (!dir.amount) {
    $('dTitle').textContent = 'Onderling staat alles gelijk';
    $('dBtn').classList.add('hidden');
  } else {
    $('dTitle').textContent = dir.payer === user ? `Jij betaalt ${dir.payee}, rechtstreeks` : `${dir.payer} betaalt jou terug, rechtstreeks`;
    $('dBtn').textContent = dir.payer === user ? `Betaal ${dir.payee}` : 'Stuur betaalverzoek';
    $('dBtn').classList.remove('hidden');
  }
  $('dTotal').textContent = eur(dir.amount);
  $('dLines').innerHTML = me.direct.lines.map(l => line(esc(l.label), esc(money(l.text)))).join('')
    + line('Netto', esc(money(me.direct.net.text)), 'total');
  setPill($('dPill'), dir.amount ? todoFor('direct', dir.payer) : null);

  $('kLeef').textContent = money(state.livingCosts.text);
  $('kBuf').textContent = money(state.bufferMonth.text);
  $('kBufSplit').textContent = people().map(p => `${p.name} ${money(state[p.name].buffer.text)}`).join(' · ');
  $('kNet').textContent = money(state.bufferNet.text);
  const goal = Number(store.get('goal')) || 0;
  $('goalBox').classList.toggle('hidden', !goal);
  if (goal) {
    $('goalBar').style.width = Math.max(0, Math.min(100, (state.bufferNet.value || 0) / goal * 100)) + '%';
    $('goalEnd').textContent = 'doel ' + eur(goal);
  }

  const pct = shares();
  $('shapes').innerHTML = people().map((p, i) =>
    `<b class="${i ? 'sc' : 'se'}" style="flex:${pct[p.name] || 50}"><span>${esc(pctText(p.name))}</span>${esc(p.name)}</b>`).join('');
  $('splitLines').innerHTML = people().map(p => line(esc(p.name), esc(money(state.contribution[p.name].text)))).join('')
    + line('Samen per maand', esc(money(state.contribution.total.text)), 'total');
  $('footUser').innerHTML = `Ingelogd als ${esc(user)} · <button class="linkish" data-switch>ik ben ${esc(o)}</button>`;
}

// Het aandeel naar rato zoals het Dashboard het noemt (I7 en I10: "■  Erisa · 45,2%").
function pctText(name) {
  const lbl = (state.contribution.labels || []).find(l => l.includes(name)) || '';
  const m = /(\d+(?:,\d+)?)\s*%/.exec(lbl);
  return m ? m[1] + '%' : '';
}
function shares() {
  const out = {};
  people().forEach(p => { const t = pctText(p.name); out[p.name] = t ? Number(t.replace('%', '').replace(',', '.')) : 50; });
  return out;
}

/* Te doen */
function todoRow(t) {
  return `<div class="item ${t.done ? 'done' : ''}" data-row="${t.row}">
    <button class="hit" data-todo="${t.row}" aria-label="${t.done ? 'Zet weer open' : 'Vink af'}: ${esc(stripMark(t.what))}"><span class="chk ${t.done ? 'on' : ''}"></span></button>
    <div class="main"><div class="t">${isAlert(t.what) ? '<span class="tag c-ink">Dringend</span>' : ''}${esc(stripMark(t.what))}</div>
    <div class="m"><span class="tag ${ink(t.who)}">${esc(t.who)}</span>${t.done ? 'klaar' : esc(t.when)}</div></div>
    <div class="amt">${t.amount.text ? esc(money(t.amount.text)) : '<span class="sub">—</span>'}</div></div>`;
}
function renderTodo() {
  const all = state.todos || [];
  const open = all.filter(t => !t.done), done = all.filter(t => t.done);
  $('todoOpen').innerHTML = open.length ? open.map(todoRow).join('') : '<div class="empty">Alles is gedaan voor deze maand.</div>';
  $('todoDone').innerHTML = done.length ? done.map(todoRow).join('') : '<div class="empty">Nog niets afgevinkt.</div>';
  $('doneCount').textContent = `${done.length} van ${all.length}`;
}
async function toggleTodo(row) {
  const t = state.todos.find(x => x.row === row);
  if (!t) return;
  const el = document.querySelector(`.item[data-row="${row}"]`);
  if (el) el.classList.add('busy');
  try { await write('setDone', { row, done: !t.done }, t.done ? 'Weer open gezet' : 'Afgevinkt in Te doen'); }
  catch (e) { toast(e.message); if (el) el.classList.remove('busy'); }
}

/* Uitgaven */
function renderSpend() {
  $('tabTx').classList.toggle('on', spendTab === 'tx'); $('tabBud').classList.toggle('on', spendTab === 'bud');
  $('spTx').classList.toggle('hidden', spendTab !== 'tx'); $('spBud').classList.toggle('hidden', spendTab !== 'bud');
  const tx = state.tx || [];
  const cats = ['Alles', ...new Set(tx.map(t => t.category).filter(Boolean))];
  if (!cats.includes(cat)) cat = 'Alles';
  $('catChips').innerHTML = cats.map(c => `<button class="${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('cardSeg').innerHTML = ['Beide', ...people().map(p => p.name)].map(p =>
    `<button class="${p === card ? 'on' : ''}" data-card="${esc(p)}" aria-label="Pas ${esc(p)}">${esc(p)}</button>`).join('');
  const q = $('q').value.trim().toLowerCase();
  const rows = tx.filter(t => (cat === 'Alles' || t.category === cat) && (card === 'Beide' || t.card === card) && t.desc.toLowerCase().includes(q));
  $('txList').innerHTML = rows.length
    ? rows.slice(0, txShown).map(t => {
        const out = /uitgave/i.test(t.kind);
        const orig = t.currency && t.currency !== 'EUR' && t.original ? `<div class="m">${t.currency === 'ZAR' ? 'R' : esc(t.currency)} ${esc(t.original)}</div>` : '';
        return `<div class="item"><div class="main"><div class="t">${esc(t.desc)}</div>
          <div class="m">${esc(t.date)} · ${esc(t.category)}${t.card ? ' · pas ' + esc(t.card) : ''}</div></div>
          <div class="amt"><div class="${out ? '' : 'e-ink'}">${out ? '−' : '+'}${esc(money(t.amount.text))}</div>${orig}</div></div>`;
      }).join('') + (rows.length > txShown ? `<button class="btn ghost small more" data-more>Toon meer (${rows.length - txShown})</button>` : '')
    : '<div class="empty">Geen transacties met dit filter.</div>';

  $('budList').innerHTML = `<div class="card-h" style="margin-bottom:6px"><h2>Per maand</h2><span class="sub">gemeten / budget</span></div>`
    + (state.categories || []).map(c => {
      const over = c.budget.value != null && c.measured.value != null && c.measured.value > c.budget.value + 0.005;
      const w = c.budget.value ? Math.min(100, (c.measured.value || 0) / c.budget.value * 100) : 0;
      return `<div class="line" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><span>${esc(c.label)}${over ? ' <span class="c-ink">· boven budget</span>' : ''}</span>
        <span class="num" style="white-space:nowrap">${esc(money(c.measured.text))} <span class="sub">/ ${esc(money(c.budget.text))}</span></span></div>
        <div class="track"><i class="${over ? 'over' : ''}" style="width:${w}%"></i></div></div>`;
    }).join('')
    + (state.fixedCosts && state.fixedCosts.label ? line(esc(state.fixedCosts.label), esc(money(state.fixedCosts.text)), 'total') : '')
    + (state.rate ? `<div class="hint">Koers ZAR per EUR: ${esc(String(state.rate).replace('.', ','))}</div>` : '');
}

/* Verrekenen */
function waits(a) { return a.period && state.period && a.period > state.period; }
function renderSettle() {
  const all = $('showDone').classList.contains('on');
  $('tabAdv').classList.toggle('on', settleTab === 'adv'); $('tabClaim').classList.toggle('on', settleTab === 'claim');
  $('addBtn').textContent = settleTab === 'adv' ? '+ Voorschot toevoegen' : '+ Declaratie toevoegen';
  $('cutoffHint').textContent = `Afrekenmaand ${periodName(state.period)}. Wat je na de ${state.cutoffDay}e invult, telt mee in de maand erop.`;

  if (settleTab === 'adv') {
    $('settleSum').innerHTML = (state.advanceTotals || []).filter(r => r.label).map(r => line(esc(r.label), esc(money(r.text)))).join('');
    const rows = (state.advances || []).filter(a => all || !a.repaid);
    $('settleList').innerHTML = rows.length ? rows.map(a => `
      <div class="item ${a.repaid ? 'done' : ''}" data-row="${a.row}">
        <div class="main"><div class="t">${esc(a.desc)}</div>
        <div class="m"><span class="tag ${ink(a.who)}">${esc(a.who)}</span>${esc(a.date)}${a.repaid ? ' · terugbetaald op ' + esc(a.repaid) : ''}</div>
        ${!a.repaid && waits(a) ? '<div style="margin-top:6px"><span class="pill wait">Wacht op volgende afrekening</span></div>' : ''}
        ${a.repaid ? `<button class="act" data-unrepay="${a.row}">Toch niet terugbetaald</button>` : `<button class="act" data-repay="${a.row}">Markeer als terugbetaald</button>`}</div>
        <div class="amt">${esc(money(a.amount.text))}</div></div>`).join('')
      : '<div class="empty">Geen open voorschotten.</div>';
  } else {
    $('settleSum').innerHTML = (state.claimSummary || []).map(l => line(esc(l.label), esc(money(l.text)))).join('')
      || '<div class="sub">Eerst overmaken naar de gezamenlijke rekening, dan declareren op werk.</div>';
    const rows = (state.claims || []).filter(c => all || !(c.step1 && c.step2));
    $('settleList').innerHTML = rows.length ? rows.map(c => `
      <div class="item ${c.step1 && c.step2 ? 'done' : ''}" data-row="${c.row}" style="align-items:flex-start">
        <div class="main"><div class="t">${esc(c.desc)}</div>
        <div class="m"><span class="tag ${ink(c.claimant)}">${esc(c.claimant)}</span>${esc(c.date)} · ${esc(c.kind)} · pas ${esc(c.paidBy)}</div>
        <div class="steps">
          ${step(c, 1, 'Overgemaakt naar gezamenlijk')}
          ${step(c, 2, 'Gedeclareerd op werk')}
        </div></div>
        <div class="amt">${esc(money(c.amount.text))}</div></div>`).join('')
      : '<div class="empty">Geen open declaraties.</div>';
  }
}
function step(c, n, label) {
  const v = n === 1 ? c.step1 : c.step2;
  return `<div class="step"><button class="hit" data-step="${n}" data-claim="${c.row}" aria-label="Stap ${n}: ${label}"><span class="chk ${v ? 'on' : ''}"></span></button>
    <span>${label}${v ? `<span class="m" style="display:block;margin:0">op ${esc(v)}</span>` : ''}</span></div>`;
}

/* Meer */
function receipt(rows) {
  const body = (rows || []).slice(1).filter(r => r.some(Boolean));
  return body.map(r => {
    const cells = r.map(x => String(x || '').trim());
    const rest = cells.slice(1).filter(Boolean);
    if (!rest.length) return cells[0].length <= 70 ? `<div class="h">${esc(cells[0])}</div>` : `<div class="p">${esc(cells[0])}</div>`;
    const label = cells[0] || rest.shift();
    return line(esc(label), esc(rest.join(' · ')));
  }).join('');
}
function renderMore() {
  $('saldo').innerHTML = receipt(state.saldo) || '<div class="empty">Geen gegevens.</div>';
  $('belegging').innerHTML = receipt(state.belegging) || '<div class="empty">Geen gegevens.</div>';
  $('setWho').textContent = user;
  const goal = Number(store.get('goal')) || 0;
  $('setGoal').textContent = goal ? eur(goal) : 'instellen';
  $('setFresh').textContent = freshness();
}

/* ---------- Navigatie ---------- */

function go(v) {
  view = v;
  document.querySelectorAll('section[data-v]').forEach(s => s.classList.toggle('hidden', s.dataset.v !== v));
  document.querySelectorAll('nav.tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.go === v);
    if (b.dataset.go === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('scroll').scrollTop = 0;
  if (state) renderHeader();
}

/* ---------- Bladen (sheets) ---------- */

function openSheet(html) { $('sheet').oninput = null; $('sheet').onclick = null; $('sheet').innerHTML = '<div class="grab"></div>' + html; $('sheet').classList.add('open'); $('veil').classList.add('open'); }
function closeSheet() { $('sheet').classList.remove('open'); $('veil').classList.remove('open'); }
function confirmSheet(title, body, okLabel, run) {
  openSheet(`<h2>${title}</h2><p style="margin:8px 0 0">${body}</p><div class="err" id="sErr" role="alert"></div>
    <button class="btn" id="okB">${okLabel}</button><button class="btn ghost" data-close>Annuleren</button>`);
  $('okB').onclick = async () => {
    $('okB').disabled = true; $('okB').textContent = 'Bezig…';
    try { await run(); closeSheet(); }
    catch (e) { $('sErr').textContent = e.message; $('okB').disabled = false; $('okB').textContent = okLabel; }
  };
}

function seg(id, options, selected) {
  return `<div class="seg full" id="${id}">${options.map(o => `<button type="button" class="${o === selected ? 'on' : ''}" data-seg="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
}
const segVal = id => { const b = document.querySelector(`#${id} button.on`); return b ? b.dataset.seg : null; };

function copyText(v) {
  const done = () => toast('Gekopieerd: ' + v);
  if (navigator.clipboard) navigator.clipboard.writeText(v).then(done, () => toast('Kopiëren lukte niet. Neem het bedrag over: ' + v));
  else toast('Neem het bedrag over: ' + v);
}

function openRevolut() {
  // Alleen de app openen; een vast bedrag invullen kan niet zonder bankkoppeling.
  const t = setTimeout(() => { if (document.visibilityState === 'visible') location.href = 'https://app.revolut.com'; }, 1400);
  document.addEventListener('visibilitychange', () => clearTimeout(t), { once: true });
  location.href = 'revolut://';
}

function openPay() {
  const me = state[user], amount = me.total.value || 0;
  const month = (state.title || '').split(' ')[0].toLowerCase();
  const desc = `Maandbijdrage ${month} ${user}`.replace(/\s+/g, ' ');
  const todo = todoFor('pay', user);
  openSheet(`<h2>Naar de gezamenlijke rekening</h2>
    <div class="copy"><div><div class="sub">Bedrag</div><div class="v num">${esc(money(me.total.text))}</div></div><button class="btn small" data-copy="${plainAmount(amount)}">Kopieer</button></div>
    <div class="copy"><div><div class="sub">Omschrijving</div><div>${esc(desc)}</div></div><button class="btn ghost small" data-copy="${esc(desc)}">Kopieer</button></div>
    <button class="btn" data-revolut>Open Revolut</button>
    <p class="hint">Revolut opent zonder bedrag. Plak het bedrag daar en kom terug om af te vinken.</p>
    ${todo && !todo.done ? `<button class="btn ghost" data-donetodo="${todo.row}">Overgemaakt, vink af</button>` : ''}`);
}

function openDirect() {
  const dir = direction();
  const payee = people().find(p => p.name === dir.payee);
  const link = `https://revolut.me/${payee.revolut}?amount=${dir.amount.toFixed(2)}&currency=EUR`;
  const iPay = dir.payer === user;
  const todo = todoFor('direct', dir.payer);
  openSheet(`<h2>${iPay ? 'Betaal ' + esc(dir.payee) : 'Betaalverzoek aan ' + esc(dir.payer)}</h2>
    <div class="copy"><div><div class="sub">Bedrag</div><div class="v num">${eur(dir.amount)}</div></div><button class="btn small" data-copy="${plainAmount(dir.amount)}">Kopieer</button></div>
    ${iPay ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open revolut.me/${esc(payee.revolut)}</a>`
           : `<button class="btn" data-share="${esc(link)}">Deel je betaallink met ${esc(dir.payer)}</button>`}
    <p class="hint">Neemt Revolut het bedrag niet over? Plak het dan zelf.</p>
    ${todo && !todo.done ? `<button class="btn ghost" data-donetodo="${todo.row}">${iPay ? 'Betaald' : 'Ontvangen'}, vink af</button>` : ''}`);
}

async function shareLink(link) {
  const dir = direction();
  const text = `Kasboek: je betaalt ${eur(dir.amount)} aan ${dir.payee}.`;
  if (navigator.share) { try { await navigator.share({ title: 'Betaalverzoek', text, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copyText(link);
}

/* Voorschot en declaratie toevoegen */
function amountField(prefix) {
  return `<label class="f" for="${prefix}A">Bedrag</label>
    <div class="amountrow"><input class="in num" id="${prefix}A" inputmode="decimal" autocomplete="off" placeholder="0,00">
    ${seg(prefix + 'M', ['EUR', 'ZAR'], 'EUR').replace('seg full', 'seg')}</div>
    <div class="hint" id="${prefix}Conv"></div>`;
}
function parseAmount(s) {
  s = String(s || '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
}
function convHint(prefix) {
  const raw = parseAmount($(prefix + 'A').value), zar = segVal(prefix + 'M') === 'ZAR';
  $(prefix + 'Conv').textContent = zar && raw > 0 && state.rate
    ? `R ${raw.toLocaleString('nl-NL', { minimumFractionDigits: 2 })} ÷ koers ${String(state.rate).replace('.', ',')} ≈ ${eur(raw / state.rate)}. De Sheet rekent dit om.` : '';
  return { raw, zar, approx: zar ? (state.rate ? raw / state.rate : NaN) : raw };
}
function afterCutoff(iso) {
  const [y, m, d] = iso.split('-');
  const ym = y + m;
  return state.period && (ym > state.period || (ym === state.period && Number(d) > Number(state.cutoffDay)));
}

function openAddAdvance() {
  const reqId = uid(), claimId = uid();
  openSheet(`<h2>Voorschot toevoegen</h2>
    <label class="f" for="vD">Datum</label><input class="in" type="date" id="vD" value="${todayISO()}">
    <label class="f">Wie schoot voor?</label>${seg('vW', people().map(p => p.name), user)}
    <label class="f" for="vO">Omschrijving</label><input class="in" id="vO" maxlength="140" placeholder="Boodschappen Woolworths">
    ${amountField('v')}
    <div class="effect" id="vEff">Een voorschot is een gezamenlijke kost en wordt naar rato verdeeld.</div>
    <div class="ask"><p>Is dit een vlucht, benzine of overnachting voor werk?</p>
      ${seg('vDec', ['Nee', 'Ja'], 'Nee')}
      <div id="vDecMore" class="hidden">
        <label class="f">Soort</label>${seg('vK', ['Vlucht', 'Benzine', 'Overnachting'], null)}
        <label class="f">Wie declareert?</label>${seg('vC', people().map(p => p.name), user)}
      </div>
      <div class="hint">Niet elke benzine is declareerbaar. Kies alleen Ja als het voor werk was.</div></div>
    <div class="err" id="vErr" role="alert"></div>
    <button class="btn" id="vSave">Controleren</button>
    <button class="btn ghost" data-close>Annuleren</button>`);

  const upd = () => {
    const a = convHint('v'), who = segVal('vW'), o = other(who), pct = shares();
    $('vDecMore').classList.toggle('hidden', segVal('vDec') !== 'Ja');
    if (!(a.approx > 0)) { $('vEff').textContent = 'Een voorschot is een gezamenlijke kost en wordt naar rato verdeeld.'; return; }
    const late = afterCutoff($('vD').value || todayISO());
    $('vEff').innerHTML = `Naar rato draagt ${esc(o)} ≈ <b>${eur(a.approx * pct[o] / 100)}</b> (${pctText(o)}) en ${esc(who)} ≈ ${eur(a.approx * pct[who] / 100)}.`
      + (late ? `<br>Na de afsluitdag: telt mee in de afrekening van de maand erop.` : `<br>Het nieuwe netto onderling zie je na opslaan.`);
  };
  $('sheet').oninput = upd;
  $('sheet').onclick = e => { if (e.target.closest('[data-seg]')) setTimeout(upd, 0); };

  $('vSave').onclick = () => {
    const date = $('vD').value, who = segVal('vW'), desc = $('vO').value.trim(), a = convHint('v');
    const dec = segVal('vDec') === 'Ja', kind = segVal('vK'), claimant = segVal('vC');
    const err = !date ? 'Kies een datum.' : !desc ? 'Vul een omschrijving in.' : !(a.raw > 0) ? 'Vul een bedrag groter dan 0 in, bijvoorbeeld 102,99.'
      : dec && !kind ? 'Kies of het een vlucht, benzine of overnachting is.' : '';
    if (err) { $('vErr').textContent = err; return; }
    const shown = a.zar ? `R ${a.raw.toLocaleString('nl-NL', { minimumFractionDigits: 2 })} (≈ ${eur(a.approx)})` : eur(a.raw);
    confirmSheet('Klopt dit?',
      `${esc(nlDate(date))} · ${esc(who)} schoot ${shown} voor: <b>${esc(desc)}</b>.<br><br>Dit verandert direct het netto onderling.${dec ? `<br><br>Er komt ook een declaratie-rij bij (${esc(kind.toLowerCase())}, ${esc(claimant)} declareert).` : ''}`,
      'Ja, opslaan', async () => {
        const amount = a.raw;
        await write('addAdvance', { requestId: reqId, date, who, desc, amount, currency: a.zar ? 'ZAR' : 'EUR' }, null);
        if (dec) await write('addClaim', { requestId: claimId, date, desc, amount, currency: a.zar ? 'ZAR' : 'EUR', paidBy: who, kind, claimant }, null);
        const dir = state && state[people()[0].name] ? direction() : null;
        toast(DEMO ? 'Demo: niets opgeslagen' : `Opgeslagen. ${dir && dir.amount ? `${dir.payer} betaalt ${dir.payee} nu ${eur(dir.amount)}.` : ''}`);
      });
  };
}

function openAddClaim() {
  const reqId = uid();
  openSheet(`<h2>Declaratie toevoegen</h2>
    <label class="f" for="cD">Datum</label><input class="in" type="date" id="cD" value="${todayISO()}">
    <label class="f" for="cO">Omschrijving</label><input class="in" id="cO" maxlength="140" placeholder="Vlucht CPT–JNB">
    ${amountField('c')}
    <label class="f">Soort</label>${seg('cK', ['Vlucht', 'Benzine', 'Overnachting'], null)}
    <label class="f">Betaald met de pas van</label>${seg('cP', people().map(p => p.name), user)}
    <label class="f">Wie declareert?</label>${seg('cC', people().map(p => p.name), user)}
    <div class="effect">Daarna: (1) maak het bedrag over naar de gezamenlijke rekening, (2) declareer het op werk. Beide stappen vink je hier af.</div>
    <div class="err" id="cErr" role="alert"></div>
    <button class="btn" id="cSave">Controleren</button>
    <button class="btn ghost" data-close>Annuleren</button>`);
  $('sheet').oninput = () => convHint('c');
  $('sheet').onclick = e => { if (e.target.closest('[data-seg]')) setTimeout(() => convHint('c'), 0); };
  $('cSave').onclick = () => {
    const date = $('cD').value, desc = $('cO').value.trim(), a = convHint('c'), kind = segVal('cK'), paidBy = segVal('cP'), claimant = segVal('cC');
    const err = !date ? 'Kies een datum.' : !desc ? 'Vul een omschrijving in.' : !(a.raw > 0) ? 'Vul een bedrag groter dan 0 in.' : !kind ? 'Kies de soort.' : '';
    if (err) { $('cErr').textContent = err; return; }
    confirmSheet('Klopt dit?', `${esc(claimant)} declareert ${a.zar ? 'R ' + a.raw.toLocaleString('nl-NL', { minimumFractionDigits: 2 }) : eur(a.raw)} (${esc(kind.toLowerCase())}): <b>${esc(desc)}</b>, betaald met de pas van ${esc(paidBy)}.`,
      'Ja, opslaan', () => write('addClaim', { requestId: reqId, date, desc, amount: a.raw, currency: a.zar ? 'ZAR' : 'EUR', paidBy, kind, claimant }, 'Opgeslagen in Declaraties'));
  };
}

function markRepaid(row, clear) {
  const a = state.advances.find(x => x.row === row);
  if (!a) return;
  if (clear) {
    confirmSheet('Datum weghalen?', `"${esc(a.desc)}" staat als terugbetaald op ${esc(a.repaid)}. Weghalen? Dan telt het voorschot weer mee.`, 'Ja, weghalen',
      () => write('markReimbursed', { row, clear: true }, 'Datum weggehaald'));
  } else {
    confirmSheet('Terugbetaald?', `Zet "Terugbetaald op" voor <b>${esc(a.desc)}</b> (${esc(money(a.amount.text))}) op vandaag, ${nlDate(todayISO())}. Het netto onderling verandert daardoor.`, 'Ja, opslaan',
      () => write('markReimbursed', { row, date: todayISO() }, 'Opgeslagen in Voorschotlog'));
  }
}

async function claimStep(row, n) {
  const c = state.claims.find(x => x.row === row);
  if (!c) return;
  const v = n === 1 ? c.step1 : c.step2;
  if (v) {
    confirmSheet('Datum weghalen?', `Stap ${n} staat op ${esc(v)}. Wil je de datum weghalen?`, 'Ja, weghalen',
      () => write('markClaimStep', { row, step: n, clear: true }, 'Datum weggehaald'));
    return;
  }
  const el = document.querySelector(`.item[data-row="${row}"]`);
  if (el) el.classList.add('busy');
  try { await write('markClaimStep', { row, step: n, date: todayISO() }, n === 1 ? 'Stap 1: overgemaakt' : 'Stap 2: gedeclareerd'); }
  catch (e) { toast(e.message); if (el) el.classList.remove('busy'); }
}

function openGoal() {
  const goal = Number(store.get('goal')) || '';
  openSheet(`<h2>Doel voor de buffer</h2><p class="hint">Alleen op dit apparaat. Laat leeg om geen doel te tonen.</p>
    <label class="f" for="gA">Doelbedrag in EUR</label><input class="in num" id="gA" inputmode="decimal" value="${goal ? String(goal).replace('.', ',') : ''}" placeholder="1.000">
    <button class="btn" id="gSave">Bewaren</button><button class="btn ghost" data-close>Annuleren</button>`);
  $('gSave').onclick = () => {
    const raw = $('gA').value.trim();
    const n = raw ? parseAmount(raw.replace(/\.(?=\d{3}\b)/g, '')) : 0;
    if (raw && !(n > 0)) { toast('Vul een bedrag in, bijvoorbeeld 1000'); return; }
    store.set('goal', n || null); closeSheet(); renderAll();
  };
}

function forget() {
  confirmSheet('Vergeet dit apparaat?', 'De link, pincode, wie je bent en de bewaarde stand worden van dit apparaat gewist. Daarna heb je de geheime link en de pincode weer nodig.', 'Ja, vergeten', async () => {
    ['config', 'pin', 'user', 'state', 'goal'].forEach(store.del);
    if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
    location.reload();
  });
}

let toastTimer;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------- Gebeurtenissen ---------- */

function bindUi() {
  $('pad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'wis'].map(k => k === '' ? '<span></span>'
    : `<button class="${k === 'wis' ? 'x' : ''}" data-pad="${k}" aria-label="${k === 'wis' ? 'Wis' : k}">${k === 'wis' ? 'Wis' : k}</button>`).join('');

  document.addEventListener('click', e => {
    const t = e.target.closest('button, a');
    if (!t) return;
    const d = t.dataset;
    if (d.pad) return padKey(d.pad);
    if (d.who) return setUser(d.who);
    if (d.go) return go(d.go);
    if ('close' in d) return closeSheet();
    if ('switch' in d) return setUser(other(user));
    if (d.seg !== undefined) { t.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); return; }
    if (d.copy !== undefined) return copyText(d.copy);
    if ('revolut' in d) return openRevolut();
    if (d.share) return shareLink(d.share);
    if (d.donetodo) {
      const row = Number(d.donetodo);
      t.disabled = true;
      return write('setDone', { row, done: true }, 'Afgevinkt in Te doen').then(closeSheet, err => { toast(err.message); t.disabled = false; });
    }
    if (d.todo) return toggleTodo(Number(d.todo));
    if (d.cat) { cat = d.cat; txShown = 80; return renderSpend(); }
    if (d.card) { card = d.card; txShown = 80; return renderSpend(); }
    if ('more' in d) { txShown += 120; return renderSpend(); }
    if (d.repay) return markRepaid(Number(d.repay), false);
    if (d.unrepay) return markRepaid(Number(d.unrepay), true);
    if (d.step) return claimStep(Number(d.claim), Number(d.step));
  });

  $('veil').onclick = closeSheet;
  $('whoBtn').onclick = chooseWho;
  $('setWho').onclick = chooseWho;
  $('setGoal').onclick = openGoal;
  $('payBtn').onclick = openPay;
  $('dBtn').onclick = openDirect;
  $('refreshBtn').onclick = () => loadState().then(() => toast('Ververst'));
  $('forgetBtn').onclick = forget;
  $('tabTx').onclick = () => { spendTab = 'tx'; renderSpend(); };
  $('tabBud').onclick = () => { spendTab = 'bud'; renderSpend(); };
  $('tabAdv').onclick = () => { settleTab = 'adv'; renderSettle(); };
  $('tabClaim').onclick = () => { settleTab = 'claim'; renderSettle(); };
  $('showDone').onclick = () => { const on = $('showDone').classList.toggle('on'); $('showDone').setAttribute('aria-pressed', on); renderSettle(); };
  $('addBtn').onclick = () => (settleTab === 'adv' ? openAddAdvance() : openAddClaim());
  $('q').oninput = () => { txShown = 80; renderSpend(); };

  window.addEventListener('online', () => { banner(''); loadState(); });
  window.addEventListener('offline', () => banner(`Offline. Je ziet de stand van ${freshness()}. Opslaan kan pas als je weer online bent.`));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state && pin && Date.now() - new Date(state.fetchedAt).getTime() > 5 * 60 * 1000) loadState();
  });

  // Trek om te vernieuwen
  const sc = $('scroll'), pull = $('pull');
  let y0 = null, dy = 0;
  sc.addEventListener('touchstart', e => { y0 = sc.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  sc.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { pull.style.height = Math.min(dy / 2, 44) + 'px'; pull.textContent = dy > 100 ? 'Loslaten om te verversen' : 'Trek om te verversen'; }
  }, { passive: true });
  sc.addEventListener('touchend', () => {
    if (y0 !== null && dy > 100) { pull.textContent = 'Verversen…'; loadState().finally(() => { pull.style.height = '0'; }); }
    else pull.style.height = '0';
    y0 = null;
  });
}

init();

/**
 * Kasboek · Apps Script web-app, gebonden aan de Sheet "Gezamenlijke rekening overzicht".
 *
 * De Sheet rekent; dit script leest cellen voor de app en schrijft alleen in de invoerkolommen
 * van Voorschotlog (A:E), Declaraties (A:H) en Te doen (F). Formules, opmaak en andere
 * tabbladen blijven onaangeroerd.
 *
 * Instellen (eenmalig, zie README): zet in Projectinstellingen → Script-eigenschappen
 *   TOKEN     een lange willekeurige tekst (dezelfde als in de geheime link)
 *   PIN_HASH  de SHA-256 van jullie pincode (functie pinHashTonen hieronder helpt)
 *
 * Alle verzoeken komen binnen als POST met Content-Type text/plain en een JSON-body:
 *   { action, token, pin, ... }
 */

const PEOPLE = {
  Erisa: { revolut: 'erisaborova' },
  Cas: { revolut: 'csnijders98' }
};
const CLAIM_KINDS = ['Vlucht', 'Benzine', 'Overnachting'];

// Celadressen, gecontroleerd tegen de Sheet op 26-10-2026. Blijven elke maand gelijk.
const CELLS = {
  dashboard: 'Dashboard!A1:L60',
  todos: { sheet: 'Te doen', firstRow: 5, lastRow: 40 },              // B:F, F = Klaar? Ja/Nee
  advances: { sheet: 'Voorschotlog', firstRow: 5, lastRow: 34 },     // A:G, schrijven in A:E
  advanceTotals: 'Voorschotlog!H5:I8',
  period: 'Voorschotlog!I12',
  cutoffDay: 'Voorschotlog!I13',
  claims: { sheet: 'Declaraties', firstRow: 9, lastRow: 60 },        // A:L, schrijven in A:H
  claimTotals: 'Declaraties!A4:D6',
  rate: 'Budget!B16',
  tx: { sheet: 'Transacties', maxRows: 600 },
  saldo: 'Saldo!A1:H60',
  belegging: 'Beleggingsrekening!A1:D40'
};

/* ---------------- Ingang ---------------- */

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Het verzoek kon niet worden gelezen.' });
  }
  const auth = checkAuth_(req);
  if (auth) return json_({ ok: false, error: auth, auth: true });

  try {
    switch (req.action) {
      case 'state': return json_({ ok: true, state: readState_() });
      case 'addAdvance': return json_(once_(req, () => addAdvance_(req)));
      case 'addClaim': return json_(once_(req, () => addClaim_(req)));
      case 'setDone': return json_(write_(() => setDone_(req)));
      case 'markReimbursed': return json_(write_(() => markReimbursed_(req)));
      case 'markClaimStep': return json_(write_(() => markClaimStep_(req)));
      default: return json_({ ok: false, error: 'Onbekende actie.' });
    }
  } catch (err) {
    return json_({ ok: false, error: err.userMessage || 'Er ging iets mis in de Sheet. Probeer het opnieuw.' });
  }
}

function doGet() {
  return json_({ ok: false, error: 'Gebruik de Kasboek-app.' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(msg) {
  const err = new Error(msg);
  err.userMessage = msg;
  throw err;
}

/* ---------------- Toegang ---------------- */

function checkAuth_(req) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TOKEN');
  const pinHash = props.getProperty('PIN_HASH');
  if (!token || !pinHash) return 'De app is nog niet ingesteld (TOKEN of PIN_HASH ontbreekt).';
  if (!req.token || req.token !== token) return 'Deze link klopt niet. Open de app via de geheime link.';

  // Te veel foute pincodes: 15 minuten op slot.
  const cache = CacheService.getScriptCache();
  const tries = Number(cache.get('pinFails') || 0);
  if (tries >= 8) return 'Te vaak een verkeerde pincode. Probeer het over 15 minuten opnieuw.';
  if (sha256_(String(req.pin || '')) !== pinHash) {
    cache.put('pinFails', String(tries + 1), 900);
    return 'Verkeerde pincode.';
  }
  return null;
}

function sha256_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/* ---------------- Instellen (eenmalig, vanuit de Apps Script-editor) ---------------- */

/**
 * Vul hieronder tijdelijk jullie pincode in (4 cijfers) en voer deze functie uit.
 * Hij maakt een geheim TOKEN (als dat er nog niet is) en bewaart alleen de hash van de pincode.
 * Zet de pincode daarna terug op '' en sla op, zodat hij niet in de code blijft staan.
 */
function instellen() {
  const PINCODE = '';
  if (!/^\d{4}$/.test(PINCODE)) throw new Error('Vul bij PINCODE eerst 4 cijfers in.');
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  props.setProperty('PIN_HASH', sha256_(PINCODE));
  Logger.log('Klaar. Zet PINCODE weer op lege tekst en voer daarna geheimeLinkTonen uit.');
}

/**
 * Toont in het logboek de geheime link voor jullie telefoons. Vul eerst APP_URL in
 * (het adres van GitHub Pages) en WEBAPP_URL (de /exec-URL van de implementatie).
 */
function geheimeLinkTonen() {
  const APP_URL = 'https://erisaborova.github.io/kasboek/';
  const WEBAPP_URL = 'https://script.google.com/macros/s/.../exec';
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token) throw new Error('Voer eerst instellen uit.');
  if (!/\/exec$/.test(WEBAPP_URL) || WEBAPP_URL.indexOf('...') >= 0) throw new Error('Vul bij WEBAPP_URL de /exec-URL van de implementatie in.');
  const k = Utilities.base64EncodeWebSafe(JSON.stringify({ u: WEBAPP_URL, t: token })).replace(/=+$/, '');
  Logger.log(APP_URL + '#k=' + k);
}

/* ---------------- Lezen ---------------- */

function readState_() {
  const ss = SpreadsheetApp.getActive();
  const d = ss.getRange(CELLS.dashboard);
  const dv = d.getDisplayValues();
  const dr = d.getValues();
  const cell = a1 => { const { r, c } = rc_(a1); return { text: dv[r][c], value: num_(dr[r][c]) }; };
  const lines = (labelCol, valueCol, from, to) => {
    const out = [];
    for (let row = from; row <= to; row++) {
      const label = dv[row - 1][col_(labelCol)];
      if (!label) continue;
      out.push({ label, text: dv[row - 1][col_(valueCol)], value: num_(dr[row - 1][col_(valueCol)]) });
    }
    return out;
  };

  const categories = [];
  for (let row = 38; row <= 46; row++) {
    const label = dv[row - 1][col_('C')];
    if (!label) continue;
    categories.push({ label, budget: cell('D' + row), measured: cell('I' + row) });
  }

  return {
    fetchedAt: new Date().toISOString(),
    people: Object.keys(PEOPLE).map(name => ({ name, revolut: PEOPLE[name].revolut })),
    title: dv[2][1], date: dv[2][9],
    contribution: { total: cell('B7'), Erisa: cell('L7'), Cas: cell('L8'), labels: [dv[6][8], dv[9][8]] },
    Erisa: {
      lines: lines('C', 'D', 17, 20), buffer: cell('D22'), total: cell('D23'),
      direct: { title: dv[24][2], lines: lines('C', 'D', 26, 28), net: cell('D30') }
    },
    Cas: {
      lines: lines('H', 'I', 17, 21), buffer: cell('I22'), total: cell('I23'),
      direct: { title: dv[24][7], lines: lines('H', 'I', 26, 27), net: cell('I30') }
    },
    livingCosts: cell('D35'), bufferMonth: cell('D36'), bufferNet: cell('I36'),
    categories, fixedCosts: { label: dv[46][2], ...cell('D47') },
    claimSummary: lines('C', 'D', 50, 53),
    todos: readTodos_(ss),
    advances: readAdvances_(ss),
    advanceTotals: ss.getRange(CELLS.advanceTotals).getDisplayValues().map(r => ({ label: r[0], text: r[1] })),
    period: ss.getRange(CELLS.period).getDisplayValue(),
    cutoffDay: Number(ss.getRange(CELLS.cutoffDay).getValue()),
    claims: readClaims_(ss),
    claimTotals: ss.getRange(CELLS.claimTotals).getDisplayValues(),
    rate: num_(ss.getRange(CELLS.rate).getValue()),
    tx: readTx_(ss),
    saldo: trimRows_(ss.getRange(CELLS.saldo).getDisplayValues()),
    belegging: trimRows_(ss.getRange(CELLS.belegging).getDisplayValues())
  };
}

function readTodos_(ss) {
  const t = CELLS.todos;
  const rows = ss.getSheetByName(t.sheet).getRange(t.firstRow, 2, t.lastRow - t.firstRow + 1, 5);
  const dv = rows.getDisplayValues(), v = rows.getValues();
  const out = [];
  dv.forEach((r, i) => {
    if (!r[0] && !r[1]) return;
    out.push({ row: t.firstRow + i, who: r[0], what: r[1], amount: { text: r[2], value: num_(v[i][2]) }, when: r[3], done: /^ja$/i.test(r[4]) });
  });
  return out;
}

function readAdvances_(ss) {
  const a = CELLS.advances;
  const rows = ss.getSheetByName(a.sheet).getRange(a.firstRow, 1, a.lastRow - a.firstRow + 1, 7);
  const dv = rows.getDisplayValues(), v = rows.getValues();
  const out = [];
  dv.forEach((r, i) => {
    if (!r[0] && !r[2] && !r[3]) return;
    out.push({ row: a.firstRow + i, date: r[0], who: r[1], desc: r[2], amount: { text: r[3], value: num_(v[i][3]) },
      repaid: r[4], countsNow: r[5], period: r[6] });
  });
  return out;
}

function readClaims_(ss) {
  const c = CELLS.claims;
  const rows = ss.getSheetByName(c.sheet).getRange(c.firstRow, 1, c.lastRow - c.firstRow + 1, 12);
  const dv = rows.getDisplayValues(), v = rows.getValues();
  const out = [];
  dv.forEach((r, i) => {
    if (!r[0] && !r[1] && !r[2]) return;
    out.push({ row: c.firstRow + i, date: r[0], desc: r[1], amount: { text: r[2], value: num_(v[i][2]) }, paidBy: r[3],
      kind: r[4], claimant: r[5], step1: r[6], step2: r[7], status: r[8] });
  });
  return out;
}

function readTx_(ss) {
  const sh = ss.getSheetByName(CELLS.tx.sheet);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const first = Math.max(2, last - CELLS.tx.maxRows + 1);
  const rows = sh.getRange(first, 1, last - first + 1, 10);
  const dv = rows.getDisplayValues(), v = rows.getValues();
  const out = [];
  for (let i = dv.length - 1; i >= 0; i--) {   // nieuwste eerst
    const r = dv[i];
    if (!r[0] && !r[2]) continue;
    out.push({ date: r[0], month: r[1], desc: r[2], amount: { text: r[3], value: num_(v[i][3]) }, kind: r[4], category: r[5],
      card: r[6], original: r[7], currency: r[8] });
  }
  return out;
}

function trimRows_(rows) {
  return rows.map(r => { let n = r.length; while (n && !r[n - 1]) n--; return r.slice(0, n); });
}

function num_(v) { return typeof v === 'number' ? v : null; }
function col_(letter) { return letter.charCodeAt(0) - 65; }
function rc_(a1) { const m = /^([A-Z])(\d+)$/.exec(a1); return { c: col_(m[1]), r: Number(m[2]) - 1 }; }

/* ---------------- Schrijven ---------------- */

// Alle schrijfacties onder één script-lock, zodat twee telefoons tegelijk geen dubbele rij maken.
function write_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail_('De Sheet is even bezet. Probeer het opnieuw.');
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return Object.assign({ ok: true }, result, { state: readState_() });
  } finally {
    lock.releaseLock();
  }
}

// Toevoegen gebeurt hoogstens één keer per requestId (dubbel tikken of opnieuw versturen na een time-out).
function once_(req, fn) {
  const id = String(req.requestId || '');
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) fail_('Ontbrekende verzoek-ID. Ververs de app.');
  const cache = CacheService.getScriptCache();
  const key = 'req:' + id;
  return write_(() => {
    const seen = cache.get(key);
    if (seen) return Object.assign({ duplicate: true }, JSON.parse(seen));
    const result = fn();
    cache.put(key, JSON.stringify(result), 21600);
    return result;
  });
}

function addAdvance_(req) {
  const date = date_(req.date);
  const who = person_(req.who);
  const desc = text_(req.desc, 'Omschrijving');
  const amount = amount_(req.amount);
  const currency = req.currency === 'ZAR' ? 'ZAR' : 'EUR';

  const a = CELLS.advances;
  const sh = SpreadsheetApp.getActive().getSheetByName(a.sheet);
  const block = sh.getRange(a.firstRow, 1, a.lastRow - a.firstRow + 1, 5).getValues();
  const i = block.findIndex(r => r.every(x => x === '' || x === null));
  if (i < 0) fail_('Voorschotlog is vol (rij 5 t/m 34). Laat Claude eerst afgeronde regels archiveren.');
  const row = a.firstRow + i;

  sh.getRange(row, 1, 1, 3).setValues([[date, who, desc]]);
  if (currency === 'ZAR') {
    // De koers blijft zichtbaar in de cel: =bedrag/'Budget'!$B$16
    sh.getRange(row, 4).setFormula('=' + amount + "/'Budget'!$B$16");
  } else {
    sh.getRange(row, 4).setValue(amount);
  }
  return { row };
}

function addClaim_(req) {
  const date = date_(req.date);
  const desc = text_(req.desc, 'Omschrijving');
  const amount = amount_(req.amount);
  const paidBy = person_(req.paidBy);
  const kind = String(req.kind || '');
  if (CLAIM_KINDS.indexOf(kind) < 0) fail_('Declareerbaar zijn alleen vluchten, benzine en overnachtingen.');
  const claimant = person_(req.claimant);

  const c = CELLS.claims;
  const sh = SpreadsheetApp.getActive().getSheetByName(c.sheet);
  const block = sh.getRange(c.firstRow, 1, c.lastRow - c.firstRow + 1, 8).getValues();
  const i = block.findIndex(r => r.every(x => x === '' || x === null));
  if (i < 0) fail_('Declaraties is vol (rij 9 t/m 60).');
  const row = c.firstRow + i;
  sh.getRange(row, 1, 1, 6).setValues([[date, desc, '', paidBy, kind, claimant]]);
  if (req.currency === 'ZAR') {
    sh.getRange(row, 3).setFormula('=' + amount + "/'Budget'!$B$16");
  } else {
    sh.getRange(row, 3).setValue(amount);
  }
  return { row };
}

function setDone_(req) {
  const t = CELLS.todos;
  const row = row_(req.row, t.firstRow, t.lastRow);
  const sh = SpreadsheetApp.getActive().getSheetByName(t.sheet);
  if (!sh.getRange(row, 3).getDisplayValue()) fail_('Deze taak bestaat niet (meer). Ververs de app.');
  sh.getRange(row, 6).setValue(req.done ? 'Ja' : 'Nee');
  return { row };
}

function markReimbursed_(req) {
  const a = CELLS.advances;
  const row = row_(req.row, a.firstRow, a.lastRow);
  const sh = SpreadsheetApp.getActive().getSheetByName(a.sheet);
  if (!sh.getRange(row, 3).getDisplayValue()) fail_('Dit voorschot bestaat niet (meer). Ververs de app.');
  const cell = sh.getRange(row, 5);
  if (req.clear) {
    cell.clearContent();
  } else {
    if (cell.getDisplayValue() && !req.overwrite) fail_('Dit voorschot staat al als terugbetaald.');
    cell.setValue(date_(req.date));
  }
  return { row };
}

function markClaimStep_(req) {
  const c = CELLS.claims;
  const row = row_(req.row, c.firstRow, c.lastRow);
  const step = Number(req.step);
  if (step !== 1 && step !== 2) fail_('Onbekende stap.');
  const sh = SpreadsheetApp.getActive().getSheetByName(c.sheet);
  if (!sh.getRange(row, 2).getDisplayValue()) fail_('Deze declaratie bestaat niet (meer). Ververs de app.');
  const cell = sh.getRange(row, step === 1 ? 7 : 8);
  if (req.clear) {
    cell.clearContent();
  } else {
    if (cell.getDisplayValue() && !req.overwrite) fail_('Deze stap staat al afgevinkt.');
    cell.setValue(date_(req.date));
  }
  return { row };
}

/* ---------------- Controles ---------------- */

function person_(v) {
  if (!Object.prototype.hasOwnProperty.call(PEOPLE, v)) fail_('Kies Erisa of Cas.');
  return v;
}

function amount_(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) fail_('Het bedrag moet groter zijn dan 0.');
  if (n > 100000) fail_('Dat bedrag is wel heel groot. Controleer het nog eens.');
  return Math.round(n * 100) / 100;
}

function text_(v, name) {
  let s = String(v || '').trim().replace(/\s+/g, ' ');
  if (!s) fail_(name + ' is verplicht.');
  if (s.length > 140) fail_(name + ' is te lang (maximaal 140 tekens).');
  if (/^[=+\-@]/.test(s)) s = "'" + s;   // nooit als formule laten lezen
  return s;
}

// Datum als jjjj-mm-dd. Opgeslagen om 12:00, zodat een tijdzoneverschil de dag niet verschuift.
function date_(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) fail_('Ongeldige datum.');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  if (d.getMonth() !== Number(m[2]) - 1 || d.getFullYear() < 2024 || d.getFullYear() > 2100) fail_('Ongeldige datum.');
  return d;
}

function row_(v, first, last) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < first || n > last) fail_('Ongeldige regel. Ververs de app.');
  return n;
}

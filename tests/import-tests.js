// Import tests: runs the app's own CSV import (importFiles in app.html, rules in money.js) on anonymised copies of real Westpac exports
// (tests/fixtures) and checks the things that have gone wrong: duplicates on the next download, transfer pairing, categories, and
// which account a screenshot is of. Run with: node tests/import-tests.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..'), fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const SP = 'A0301010123456000-10Nov26.csv', JS = 'A0302020654321001-10Nov26.csv', MC = 'AXXXX_XXXX_XXXX_9999-10Nov26.csv';
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const between = (a, b) => { const i = app.indexOf(a), j = app.indexOf(b, i); assert(i >= 0 && j > i, `can't find ${a} in app.html`); return app.slice(i, j); };
const top = s => s.replace(/^(const|let) /gm, 'var '); // so the pieces' top-level names land on the test's context

function fresh() {
  const ctx = vm.createContext({console});
  vm.runInContext(`var txns = [], plan = {removed: [], custom: [], merged: {}, acctCat: {}}, accounts = [], overrides = {}, payeeRules = {}, keywordRules = [],
    privateRules = [], splits = {}, KIND = {}, cache = null, internal = new Map(), deletedTx = {}, unchecked = {}, notes = {}, flags = {}, tags = {}, store = {set() {}};`, ctx);
  vm.runInContext(top(fs.readFileSync(path.join(root, 'money.js'), 'utf8')), ctx);
  vm.runInContext(top(between('// ---------- CSV import', '// Add a transaction by hand')), ctx);
  vm.runInContext(top(between('// Westpac names its exports after the account', '// Is this account number')), ctx);
  vm.runInContext(top(between('// Which of your accounts a screenshot is of', '// The transactions in one screenshot')), ctx);
  vm.runInContext(`for (const [n, k] of CATEGORIES) KIND[n] = k;
    accounts = [{id: '', name: 'Spending', num: '03-0101-0123456-000'}, {id: 'js', name: 'Joint Spending', num: '03-0202-0654321-001'}, {id: 'mc', name: 'Mastercard', num: ''}];
    var load = (texts, accts) => { const info = {}; const n = importFiles(texts, info, accts); for (const t of txns) t.cat = categorise(t); findInternal(); return {n, info}; };`, ctx);
  return ctx;
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('file names give the account numbers', () => {
  const c = fresh();
  assert.strictEqual(c.acctNumFromName(SP), '03-0101-0123456-000');
  assert.strictEqual(c.acctNumFromName(JS), '03-0202-0654321-001');
  assert.strictEqual(c.acctNumFromName(MC), ''); // the card's file has no account number: the app asks which account
});

test('every row of all three files loads', () => {
  const c = fresh(), {n, info} = c.load([fx(SP), fx(JS), fx(MC)], ['', 'js', 'mc']);
  assert.strictEqual(info.read.join(), "35,24,7");
  assert.strictEqual(info.skipped.join(), "0,0,0");
  assert.strictEqual(n, 66);
  // two identical $25 Moon Under Water rows on one day are both real
  assert.strictEqual(c.txns.filter(t => t.party.startsWith('Moon Under Water') && t.amount === -25).length, 2);
});

test('transfers between the accounts pair up, loan repayments do not', () => {
  const c = fresh(); c.load([fx(SP), fx(JS), fx(MC)], ['', 'js', 'mc']);
  const paired = amt => c.txns.filter(t => Math.abs(t.amount) === amt && c.internal.has(t.id)).length;
  assert.strictEqual(paired(386.69), 2, 'card payment');
  assert.strictEqual(paired(400), 2, 'Spending -> Joint Spending 400');
  assert.strictEqual(paired(39.52), 2, 'Spending -> Joint Spending 39.52');
  for (const a of [401, 450, 495]) assert.strictEqual(paired(a), 0, `loan repayment ${a}`);
  assert(c.txns.filter(t => t.party === 'Loan repayment').every(t => t.cat === 'Loan Repayments'));
});

test('categories for payees in these files', () => {
  const c = fresh(); c.load([fx(SP), fx(JS), fx(MC)], ['', 'js', 'mc']);
  const cat = p => c.txns.find(t => t.party.startsWith(p)).cat;
  const want = {'ANTHROPIC* CLAUDE': 'Subscriptions & Apps', 'ANTHROPIC ': 'Subscriptions & Apps', 'Bird In The Hand': 'Alcohol & Bars', 'Crazy Spuds': 'Dining & Takeaway',
    'Dixie.T': 'Dining & Takeaway', 'Grampian Fish Supply': 'Groceries', 'CCC RecandSport': 'Health & Fitness', 'Moon Under Water': 'Alcohol & Bars',
    'Pak N Save': 'Groceries', 'Z BELFAST': 'Fuel & Transport', 'AA Insurance': 'Insurance', 'INTEREST': 'Bank Fees', 'SMZ*SHARING SHED': 'Home & Garden', 'mylotto': 'Lotto & Gambling'};
  for (const [p, w] of Object.entries(want)) assert.strictEqual(cat(p), w, p);
});

// The next download: Westpac's provisional rows (dated 24 Nov, reference "23/11 15:39") have settled
const settle = (text, form) => text.split('\n').map(l => {
  const m = /^24\/11\/2026,(-[\d.]+),"([^"]+)","EFTPOS TRANSACTION","(\d\d)\/11 (\d\d):(\d\d)",/.exec(l);
  if (!m) return l;
  const name = m[2].replace(/\b(\w)(\w*)/g, (x, a, b) => a.toUpperCase() + b.toLowerCase());
  return form === 'debit' ? `24/11/2026,${m[1]},"${name.slice(0, 17)} ${m[3]}","DEBIT",,"400000******","0375"` // "Crisp 23", same day
    : `${m[3]}/11/2026,${m[1]},"${name}","EFTPOS TRANSACTION","${m[3]}-${m[4]}:${m[5]}-111","400000******","0375 11111"`; // moved back to the purchase day
}).join('\n');

for (const form of ['debit', 'redated']) test(`settled provisional rows replace the old copies (${form})`, () => {
  const c = fresh(); c.load([fx(SP), fx(JS)], ['', 'js']);
  const before = c.txns.length;
  const {n, info} = c.load([settle(fx(SP), form), settle(fx(JS), form)], ['', 'js']);
  assert.strictEqual(n, 5);
  assert.strictEqual(info.replaced, 5);
  assert.strictEqual(c.txns.length, before, 'no duplicates');
  assert.strictEqual(c.txns.filter(t => Math.abs(t.amount + 11.38) < 0.005).length, 1, 'Crisp once');
});

test('the same file twice adds nothing', () => {
  const c = fresh(); c.load([fx(SP), fx(JS), fx(MC)], ['', 'js', 'mc']);
  const {n} = c.load([fx(SP), fx(JS), fx(MC)], ['', 'js', 'mc']);
  assert.strictEqual(n, 0);
  assert.strictEqual(c.txns.length, 66);
});

test('pending card purchases from a screenshot are replaced by the CSV, even at a different amount', () => {
  const c = fresh();
  const card = fx(MC).split('\n'), head = card[0], early = card.filter(l => /^1[0-2]\//.test(l)); // the file as it was on 12 Nov
  c.load([[head, ...early].join('\n')], ['mc']);
  // screenshot of the card's pending list: the Anthropic charge in USD showed as 185.20 pending, the Sharing Shed one exact
  c.txns.push({date: '2026-11-17', amount: -185.20, party: 'ANTHROPIC SAN FRANCISCO', desc: '', ref: '', part: '', code: '', id: 'hand-1', manual: true, acct: 'mc'},
    {date: '2026-11-19', amount: -40.40, party: 'SMZ*SHARING SHED', desc: '', ref: '', part: '', code: '', id: 'hand-2', manual: true, acct: 'mc'});
  const {info} = c.load([fx(MC)], ['mc']);
  assert.strictEqual(info.matched, 2);
  assert.strictEqual(c.txns.filter(t => t.manual).length, 0);
  assert.strictEqual(c.txns.length, 7);
});

test('a different purchase at a near amount is not taken for the screenshot one', () => {
  const c = fresh();
  c.txns.push({date: '2026-11-12', amount: -16.00, party: 'Burger King', desc: '', ref: '', part: '', code: '', id: 'hand-1', manual: true, acct: 'mc'});
  const {info} = c.load([fx(MC)], ['mc']); // McDonalds -15.40 that day
  assert.strictEqual(info.matched, 0);
  assert.strictEqual(c.txns.filter(t => t.manual).length, 1);
});

test('a screenshot is of the account named in its header', () => {
  const c = fresh(), list = vm.runInContext('accounts', c);
  const L = (text, y0) => ({text, y0, y1: y0 + 20, x0: 0, x1: 300});
  assert.strictEqual(c.shotAcctFrom([L('To Joint Spending', 400), L('Spending', 40), L('03-0101-0123456-000', 70)], list).name, 'Spending');
  assert.strictEqual(c.shotAcctFrom([L('Joint Spending', 40), L('Spending top up', 300)], list).name, 'Joint Spending');
  assert.strictEqual(c.shotAcctFrom([L('Mastercard', 30), L('PAYMENT RECEIVED', 200)], list).name, 'Mastercard');
  assert.strictEqual(c.shotAcctFrom([L('Recent transactions', 30)], list), null);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);

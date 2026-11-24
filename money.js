// money.js: the ledger core of the budget app. Plain classic script, loaded BEFORE the app's own script (see <script src="money.js"> in budget-app.html).
// It holds: date and number helpers, payee text and category rules (RULES, categorise), account/transfer matching (findInternal), the balance (calcBalance)
// and the zero-based budget maths (computePlan: Ready to Assign, carry-over, overspending). It has no screen code.
// It reads shared state that the app declares (txns, plan, accounts, overrides, payeeRules, keywordRules, privateRules, splits, KIND, cache, internal),
// so change it together with tests/check-app.js and tests/money-tests.js (which runs this file on its own with small made-up examples).

// ---------- Categories ----------
// kind: income | expense | transfer (transfers are left out of income & spending totals)
// group: where the category sits on the Budget screen
const CATEGORIES = [
  ['Pay & Tax Refunds','income'], ['Board & Bill Contributions','income'], ['Gifts & Refunds','income'], ['Other Income','income'],
  ['Housing & Rent','expense','Bills & commitments'], ['Loan Repayments','expense','Bills & commitments'], ['Rates','expense','Bills & commitments'],
  ['Utilities','expense','Bills & commitments'], ['Phone & Internet','expense','Bills & commitments'], ['Insurance','expense','Bills & commitments'],
  ['Subscriptions & Apps','expense','Bills & commitments'], ['Bank Fees','expense','Bills & commitments'],
  ['Groceries','expense','Everyday'], ['Fuel & Transport','expense','Everyday'], ['Health & Fitness','expense','Everyday'], ['Pets','expense','Everyday'],
  ['Family','expense','Everyday'], ['Cash Withdrawals','expense','Everyday'], ['Other Spending','expense','Everyday'],
  ['Dining & Takeaway','expense','Fun & lifestyle'], ['Alcohol & Bars','expense','Fun & lifestyle'], ['Lotto & Gambling','expense','Fun & lifestyle'],
  ['Shopping','expense','Fun & lifestyle'], ['Home & Garden','expense','Fun & lifestyle'], ['Recreation & Clubs','expense','Fun & lifestyle'],
  ['Transfers','transfer','Transfers & savings'], ['Savings & Investing','transfer','Transfers & savings'],
];

// Built-in categories (minus any you've deleted) plus any you've added (e.g. "Christmas").
// A built-in one you've renamed or moved keeps its spot in the lists.
function allCats() {
  const out = [], placed = new Set();
  for (const [n, k, g] of CATEGORIES) {
    if (!plan.removed.includes(n)) out.push([n, k, g]);
    const r = plan.custom.find(c => c.from === n);
    if (r) { out.push([r.name, r.kind || 'expense', r.group]); placed.add(r); }
  }
  for (const c of plan.custom) if (!placed.has(c)) out.push([c.name, c.kind || 'expense', c.group]);
  return out;
}

// Where a deleted category's transactions go now: another category, or '' to sort them again with the usual rules
function resolveCat(c) { for (let i = 0; i < 10 && c && c in plan.merged; i++) c = plan.merged[c]; return c; }

// Hidden categories: ones you no longer use. Their transactions stay where they are; they just leave the Budget tab, plan and pick-lists.
const isHidden = c => (plan.hidden || []).includes(c);

// ...and stay hidden unless something happens in them this month (new spending, or overspent), so nothing goes missing silently
const quietHidden = (c, row) => isHidden(c) && !(row && (Math.abs(row.activity[c] || 0) > 0.005 || (row.available[c] || 0) < -0.005));

const KEEP = ['Other Spending', 'Other Income']; // the app puts anything it can't sort here, so these can't be deleted

// Rules are checked top to bottom. sign: '+' only credits, '-' only debits, undefined = both.
// Rules that name real people (board payers, family) are NOT here: they live in each budget's own data (privateRules, below), so they stay out of the published page.
const RULES = [
  ['Transfers', /^(to|from|frm) [\d*]|joint (sbs|spending|rates)|^savings$|locked savings|long term savings|medium term savings|short term savings|overdraft account|^chq$|^bills|melbourne trip|^baby$|^choices$|gem visa|amp fund|reversal of trans|transfer not/],
  ['Savings & Investing', /sharesies|hatch|portfolio custodial/],
  ['Pay & Tax Refunds', /nz defence force|warehouse stati|statistics new zeala|i\.r\.d\.|prof fee|mytaxrefund/, '+'],
  ['Gifts & Refunds', /claims paymen|clai|aai discount|westpac (credit|reversed)|awp svcs/, '+'],
  ['Loan Repayments', /loan repayment|finance now/],
  ['Housing & Rent', /\brent\b|nzdf housing|property management|harcourts|armstrong murray|ezystor|ezstor/],
  ['Rates', /christchurch cc|ccc call centre|\b\d{3,5} ?rates\b/], // "7110Rates": the council's bill payee
  ['Utilities', /powershop|trustpower|kiwigas|mercury|contact retail|contact energy|flick energy|firewood|ecodrop/],
  ['Phone & Internet', /2degrees|two degrees|2 degrees|skinny|inspire net|orcon|worldxchange|xnet|telecom|cltnet/],
  ['Insurance', /insurance|aa pet|debitsuccess|^dbs$|ami insurance|westpac insurance|a-nz auto ass|nzaa|aa head office/],
  ['Lotto & Gambling', /lotto|pokerstars|new zealand racin|tab /],
  ['Subscriptions & Apps', /netflix|spotify|youtube|google(?! ?pay)|chatgpt|openai|anthropic|claude|cursor|jagex|steam|valve|patreon|blizzard|dropbox|tinder|bumble|badoo|pof\.com|okcupid|fan pass|pocketsmit|you ?need ?a ?budget|humble|nexusmods|loot crate|new zealand city|rapidshare|origin\.com|htc corp|minecraft|files|social payments|menuly|new york time|xsolla|1 month|wikipedia|change\.org|find someone|venntro/],
  ['Groceries', /countdown|woolworths|new world|newworld|pak ?n ?save|pak'n'save|four square|supervalu|fresh choice|veggie boys|tommy fresh|hello fresh|gorgeous food|fish supply|centre city new|metromart/],
  ['Alcohol & Bars', /liquor|\bbeers?\b|bottle shop|wine|brew|(?<!sushi |salad |snack |coffee |juice |milk )\bbar\b|tavern|hotel|\bpub\b|inch bar|craft bar|baaa|ratbags|shooters|bungalow|snapdragon|isis lounge|refuel|urban factory|copa|chicks|k zone|electric avenue|engineers|moon under water|bird in the hand|pomeroy|cartel|craic|crb|sammys|2 mooses|monkey|southern break|metro bar|temps|five peaks|volstead|casino| rsa|jr's|ohakea jr|sportsbar|wo & sncos|sncos/],
  ['Dining & Takeaway', /mcdonald|mdonald|burger|subway|domino|kfc|pizza|sushi|kebab|uber.{0,2}eats|menulog|cafe|caf\.|bakery|bakeri|bakehouse|takeaway|takea|thai|noodle|nando|depot|coffee|fernleaf|lebakermen|copenhagen|taco|katsubi|hell |spagalimi|restaurant|eatery|dairy|convenien|night ?n.?day|nightnday|mini ?mart|superette|food|souvlaki|espresso|pie|chicken|grill|wok|kitchen|wendy|pita|dumpl|maki mono|jizo|izakaya|satay|samosa|chim chim|crisp|pd mart|kaico|relay|vending|coca|hub conven|muffin|marlow|esquires|columbus|black & white|loefs|st pierre|mexicali|gengy|lombardi|mirrchiss|argee|aamod|spice|tulsi|akbabas|indian|curry|guang dong|sals|fush|smokey|lone star|harrys|ilex|harry|magpie|tank |shamiana|seoul|corianders|full monty|seoulmate|superburger|portier|american delight|yolo|anshu|zen sushi|catholic|plunge|ground floor|hagley|on the spot|on the sport|maddison|fleurs|blue door|runway|why not|alpine cafe|blue lake|post office cafe|royal hotel|beached whale|riba|vinci|lily|spice trader|fastlane|centennial|otter|boost|scarborough|tf\* |sydenham bkry|willowbank|kim wah|chop n wok|kelly's|cafe on dowling|bld|modaks|marlow pies|veggie|nanking|yilmaz|angus|stuart st|poolhouse|paasha|sunrise kebab|filadelfio|botanical|lockie|jumbo|maori hill|dundas|friendly khmer|xiaoyan|bennu|dost|\bmaru\b|tokyo|bookers|flax|roslyn takeaway|crazy spuds|dixie\.t/],
  ['Fuel & Transport', /\bbp |^bp$|^z |caltex|\bmobil\b|gas |npd|fuelstop|fuel|uber ?\* ?trip|uber trip|uber bv|taxi|parking|interislander|interisland|strait shipping|bluebridge|air nz|jetstar|intercity|nz transport|nzta|vtnz|repco|super ?cheap auto|oil changers|tyre|metrocard|akld transport|fullers|carjam|wof|hamco|joe's garage|joes garage|nzdf garage|c h motors|crowesport|grant ward|majestic garage|robbs garage|omakau auto|shuttle|fossil point|super shuttle/],
  ['Pets', /pet central|\bvets?\b|veterinar|animates|edog|pet insur|central bark/],
  ['Health & Fitness', /pharm|chemist|unichem|specsavers|optometr|hair|cuts|barber|haircut|health|lovoir|massage|snap ?fitness|snapfi|les mills|anytime|yoga|nz muscle|isupps|supplement|asn nutrition|a\.s\.n|fit4|bellsie|beauty|mornington health|by the blade|look sharp|maia|irazor|dukes|cutz|kess|express cut|klassic|ohbaby|nutrition|just cuts|justcuts|recandsport|rec and sport/],
  ['Home & Garden', /mitre 10|mitre10|bunnings|placemakers|resene|oderings|plumb|better vent|winstone glass|godfreys|calverley|clyne|clyde and bennie|hirepool|growers direct|pgg wrightson|sharing shed|nurser|davies|harvey norman|kitchenaid|lincraft/],
  ['Shopping', /wsl|warehouse|twl |kmart|noel leeming|pb tech|aliexpress|briscoes|trade ?me|trademe|farmers|hallensteins|rebel|kathmandu|macpac|jaycar|jb hi-fi|paper plus|whitcoulls|afterpay|laybuy|partpay|oxipay|zip pp|amzn|swanndri|golf warehouse|hunting|ballingers|allan millar|torpedo|number one shoes|no 1 shoes|mountain warehous|frames footwear|tech pro|techpro|mobile planet|grabone|etsy|kathmandu|spotlight|toyworld|body shop|country road|cotton on|jay jays|just jeans|merrell|merino|postie|columbus|savemart|rock ?shop|music works|dick smith|harvey|jeanswest|tarocash|hannahs|barkers|sunglass|look ?smart|thunderpants|platypus|book|dollar|\$ n' sense|mega discounters|michael discount|goodstuff|global exchange|nzsale|smartbuy|canvasfactory|merch|snorgtees|district lines|bargainworld|threads|r & r sport|cycle world|browns avanti|dowsons|overland|trents|central otago sport|coastal sports|b & b sports|logoland|italia|storage box|calendar club|disposal|army disposal|whitcoul|turners|kiwi corner|sharing|1-day|playtech|tmc|dri vorpx|order-id|paypal|ea \*|^ea |vector arena|ticket|eventplus|bee card|robert harris|magpie|wilko|target|ada design|jurassic|whitcoulls|langwoods|nz post|post shop|hornby central post|aquarius|formtech|marvle|3dea/],
  ['Recreation & Clubs', /golf|everglades|sir bob charles|mcleans island|bowl|cinema|hoyts|rialto|event cinemas|toptown|museum|fish & game|doc fisheries|social club|social cl|social clu|\bmess\b|welfare|airbank|contributions|sqn|club|antarctic|tenpin|strike|mini golf|zonebowl|hottub|hot ?pool|hanmer springs|venues|tram|float|aviation heritage|pukaha|orana|willowbank wild|dodson|giesen|forrest wines|nautilus|wairau river|bike|isaac theatre|nzdf disposals|npf|cotton|ball$|xmas function|4880|base welfare|fundraise|givealittle|everyday hero|rescue helico|chch hospital vol|christchurch wome|naseby|holiday park|motel|lodge|backpacker|mercure|adina|sudima|novotel|larchwood|mountain bike|te papa|experience wellin|catalina|nzflyfish|patchitup|\bbee\b/],
  ['Bank Fees', /interest/, '-'], // interest you pay; interest you earn is money in, so it isn't a fee
  ['Bank Fees', /bank charge|annual fee|foreign currency fee|line of credit|honour fee|dishonor|transaction charge|clearance fee|atm charge|payment failed|account maint|phone banking|ap load|ap amend|westpac alert|est fee|fee$/],
  ['Cash Withdrawals', /atm transaction|withdrawal|\batm\b|teller assis/, '-'],
];

const round2 = n => Math.round(n * 100) / 100 || 0; // "|| 0" also turns -0 into 0

const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number), d = new Date(y, mo - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

const monthDiff = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + mb - ma; }; // months from a to b

const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

const addDays = (d, n) => { const [y, mo, da] = d.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, da + n)).toISOString().slice(0, 10); };

const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// Strip trailing day numbers like "McDonalds Rolles 27" so one payee = one rule
// Each transaction's cleaned-up text is worked out once and remembered (redone only if its party/desc/part/ref change)
const textCache = new WeakMap();

function textOf(t) {
  let c = textCache.get(t);
  if (!c || c.p !== t.party || c.d !== t.desc || c.a !== t.part || c.r !== t.ref) {
    c = {p: t.party, d: t.desc, a: t.part, r: t.ref,
      n: (t.party || t.desc || '').toLowerCase().replace(/\s+\d{1,2}$/, '').replace(/\s+/g, ' ').trim(),
      s: [t.party, t.desc, t.part, t.ref].join(' ').toLowerCase().replace(/\s+/g, ' ')};
    textCache.set(t, c);
  }
  return c;
}

const normPayee = t => textOf(t).n;

const searchText = t => textOf(t).s;

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

// The numbers the app's rules depend on, in one place (change one here, not three places in the code)
const SETTINGS = {
  dueSoonDays: 3,            // a bill this close is flagged on the Budget tab
  historyDays: 84,           // "a typical week" and the forecast look back this far (12 weeks)
  undoSteps: 30,             // how many changes the Undo button remembers
  weekStartDay: 3,           // a week starts on this day by default (0 = Sunday, 3 = Wednesday)
  goalShares: [0.6, 0.3, 0.1], // leftover fun money is offered to the first, second and the rest of the goals in these shares
};
// The most recent day on or before `d` that is weekday `dow` (0 = Sunday), and the next one on or after it
const weekStartOn = (d, dow) => { while (new Date(d + 'T00:00:00Z').getUTCDay() !== dow) d = addDays(d, -1); return d; };
const nextOnWeekday = (d, dow) => { while (new Date(d + 'T00:00:00Z').getUTCDay() !== dow) d = addDays(d, 1); return d; };
const median = a => { const v = [...a].sort((x, y) => x - y), h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };

const privRx = new WeakMap(); // compiled privateRules patterns (kept out of the saved rule objects)

function categorise(t) {
  if (overrides[t.id]) return overrides[t.id];
  const held = heldCat(t); if (held && KIND[held]) return held;
  const p = normPayee(t);
  if (payeeRules[p]) return payeeRules[p];
  for (let i = keywordRules.length - 1; i >= 0; i--) if (p.includes(keywordRules[i].kw)) return keywordRules[i].cat;
  const text = searchText(t), party = (t.party || '').toLowerCase();
  if (!ruleMemo) return ruleCat(t, text, party);
  // during compute(): the built-in rules only look at the text, the payer and the sign, so each distinct one is worked out once
  const mk = text + '' + party + '' + (t.amount > 0 ? '+' : t.amount < 0 ? '-' : '0');
  let r = ruleMemo.get(mk);
  if (r === undefined) ruleMemo.set(mk, r = ruleCat(t, text, party));
  return r;
}

let ruleMemo = null; // set only while compute() re-sorts every transaction

function ruleCat(t, text, party) {
  // Your own rules that name people run in their place in the order: just before the built-in rule named in `before` (no `before` = first)
  const priv = before => {
    for (const r of privateRules) {
      if ((r.before || null) !== before || r.sign === '+' && t.amount < 0 || r.sign === '-' && t.amount > 0) continue;
      let re = privRx.get(r); if (!re) privRx.set(r, re = (() => { try { return new RegExp(r.re); } catch { return /$^/; } })());
      if (!re.test(r.party ? party : text)) continue;
      const to = resolveCat(r.cat);
      if (to) return to;
    }
    return null;
  };
  let first = priv(null); if (first) return first;
  for (const [cat, re, sign] of RULES) {
    if (privateRules.length) { const h = priv(cat); if (h) return h; }
    if (sign === '+' && t.amount < 0) continue;
    if (sign === '-' && t.amount > 0) continue;
    if (!(cat === 'Transfers' ? (re.test(party) || /transfer not|ap not paid/.test(text)) : re.test(text))) continue;
    const to = resolveCat(cat);
    if (to) return to; // a deleted category set to "sort automatically" lets the next rule have a go
  }
  return t.amount >= 0 ? 'Other Income' : 'Other Spending';
}

// ---------- Derived data ----------
// A split transaction's parts, or null. If the parts don't add up to the transaction, the split is ignored.
function splitOf(t) {
  const s = splits[t.id];
  if (!s || s.length < 2) return null;
  const parts = s.map(p => { const c = resolveCat(p.cat); return {cat: KIND[c] ? c : p.amount >= 0 ? 'Other Income' : 'Other Spending', amount: p.amount}; });
  return Math.abs(parts.reduce((a, p) => a + p.amount, 0) - t.amount) < 0.005 ? parts : null;
}

// Totals by category all go through this, so a split transaction counts in each of its categories
const partsOf = t => t.split || [{cat: t.cat, amount: t.amount}];

// ---------- Accounts ----------
const acctOf = t => t.acct || '';

// An account whose money lives in one category (plan.acctCat {accountId: category}, e.g. Joint Savings): everything on it goes to
// that category, and money paid in counts as activity there, not as money for Ready to Assign
const heldCat = t => (plan.acctCat || {})[acctOf(t)] || '';

const heldIn = (t, cat) => !!heldCat(t) && heldCat(t) === cat;

// How the other account's statement writes an account: "To 1234-0567890-01" (branch, account, last 2 digits of the suffix)
const shortNum = num => { const d = (num || '').replace(/\D/g, ''); return d.length >= 15 ? d.slice(2, 13) + d.slice(-2) : ''; };

const isInternal = t => internal.has(t.id);

function findInternal() {
  internal = new Map();
  if (accounts.length < 2) return;
  const short = Object.fromEntries(accounts.map(a => [a.id, shortNum(a.num)])), noNums = accounts.some(a => !short[a.id]);
  const dg = new Map(), digits = t => { let d = dg.get(t); if (d === undefined) dg.set(t, d = [t.party, t.desc, t.ref, t.part, t.code].join(' ').replace(/\D/g, '')); return d; };
  const names = (a, b) => (short[acctOf(b)] && digits(a).includes(short[acctOf(b)])) || (short[acctOf(a)] && digits(b).includes(short[acctOf(a)]));
  // Paying off a credit card: the card's statement says "PAYMENT RECEIVED" (or similar), whatever it's been sorted into
  const card = Object.fromEntries(accounts.map(a => [a.id, /credit|card|visa|master|amex/i.test(a.name || '')]));
  const cardPay = b => card[acctOf(b)] && /PAYMENT|THANK YOU/i.test([b.party, b.desc, b.ref].join(' '));
  // A transfer you added by hand: its two sides go together. Once the bank's copy has replaced one side, the side that's left
  // matches the bank's line for the same amount on another account, a few days either way.
  const byId = new Map(txns.map(t => [t.id, t]));
  for (const t of txns) { const p = t.manual && t.pair && byId.get(t.pair); if (p && p.manual && p.pair === t.id && !internal.has(t.id)) { internal.set(t.id, p); internal.set(p.id, t); } }
  const handSide = t => t.manual && t.pair;
  const byAmt = {};
  for (const t of txns) if (t.amount) { const k = Math.abs(t.amount).toFixed(2); (byAmt[k] = byAmt[k] || []).push(t); }
  for (const list of Object.values(byAmt)) {
    if (list.length < 2) continue;
    for (const a of list) {
      if (a.amount > 0 || internal.has(a.id)) continue;
      let best = null, gap = 6; // 3 days either way, or 5 for a card payment (a Friday payment can reach the card on Tuesday)
      for (const b of list) {
        if (b.amount < 0 || internal.has(b.id) || acctOf(a) === acctOf(b)) continue;
        const g = Math.abs(daysBetween(a.date, b.date));
        // Without account numbers to go on, both sides must be transfers, on the same day or the next
        if (g >= gap || g >= (cardPay(b) ? 6 : 4) || !(names(a, b) || cardPay(b) || handSide(a) || handSide(b) || (noNums && g <= 1 && KIND[a.cat] === 'transfer' && KIND[b.cat] === 'transfer'))) continue;
        best = b; gap = g;
      }
      if (best) { internal.set(a.id, best); internal.set(best.id, a); }
    }
  }
}

// ---------- Zero-based budget (YNAB-style) ----------
// Money that comes into the account lands in "Ready to Assign". You give every dollar a job by
// assigning it to categories. For each category: Available = left over from last month + assigned + activity.
// Unspent money rolls over. Overspending is taken out of next month's Ready to Assign, like YNAB.
const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');

// computePlan goes through every transaction and is asked for ~14 times per screen, so the answer is kept until the transactions are re-worked
// (compute() makes a new `cache`) or anything in the plan changes (its JSON is part of the key).
let planMemo = {cache: null, map: new Map()};

function computePlan(endMonth) {
  if (planMemo.cache !== cache) planMemo = {cache, map: new Map()};
  const key = endMonth + '|' + txns.length + '|' + JSON.stringify(plan);
  if (planMemo.map.has(key)) return planMemo.map.get(key);
  const r = computePlanRaw(endMonth);
  if (planMemo.map.size > 8) planMemo.map.clear();
  planMemo.map.set(key, r);
  return r;
}

function computePlanRaw(endMonth) {
  if (!isMonth(plan.start) || !plan.cutoff) return null;
  const budgetCats = allCats().filter(([, k]) => k !== 'income').map(([n]) => n);
  const last = [plan.start, cache.months.at(-1), addMonths(thisMonth(), 1), endMonth, ...Object.keys(plan.assigned), ...plan.adjust.map(x => x.date.slice(0, 7))].filter(isMonth).sort().at(-1);
  const months = [];
  for (let m = plan.start; m <= last; m = addMonths(m, 1)) months.push(m);
  // Income, and money transferred in, goes to Ready to Assign. Everything else is activity in its category.
  // Transactions on or before the cut-off date are already part of the starting balance, so they don't count.
  const inflow = Object.fromEntries(months.map(m => [m, 0])), adj = {...inflow}, act = {}, history = {}, cardPaidIn = {};
  for (const t of txns) {
    // Money moved between your accounts doesn't count, unless the other side is before the budget started (that one's in the starting balance)
    const pair = internal.get(t.id);
    if (pair && (pair.date > plan.cutoff) === (t.date > plan.cutoff)) {
      // A payment to a card you're paying off over time comes out of the card's own category (it can go negative: cover it from elsewhere)
      const to = accounts.find(x => x.id === acctOf(pair));
      if (t.amount < 0 && t.date > plan.cutoff && to && to.carry && t.date >= (to.carrySince || '9999') && KIND['Credit Card']) {
        const m = t.date.slice(0, 7), a = act[m] = act[m] || {};
        a['Credit Card'] = (a['Credit Card'] || 0) + t.amount; cardPaidIn[m] = (cardPaidIn[m] || 0) - t.amount;
      }
      continue;
    }
    for (const p of partsOf(t)) {
      const m = t.date.slice(0, 7), k = KIND[p.cat], isIn = k === 'income' || (k === 'transfer' && p.amount > 0 && !heldIn(t, p.cat));
      if (!isIn) { const h = history[m] = history[m] || {}; h[p.cat] = (h[p.cat] || 0) + p.amount; }
      if (t.date <= plan.cutoff) continue;
      if (isIn) { if (m in inflow) inflow[m] += p.amount; }
      else { const a = act[m] = act[m] || {}; a[p.cat] = (a[p.cat] || 0) + p.amount; }
    }
  }
  for (const x of plan.adjust) { const m = x.date.slice(0, 7); if (x.date > plan.cutoff && m in adj) adj[m] += x.amount; } // reconciliation adjustments
  const P = {months, budgetCats, by: {}, spent: (m, c) => -((history[m] || {})[c] || 0)};
  let prev = null, cash = plan.opening, totalAsg = 0, cardPaid = 0;
  for (const m of months) {
    cardPaid += cardPaidIn[m] || 0;
    const asg = plan.assigned[m] || {}, a = act[m] || {};
    const r = {carry: {}, assigned: {}, activity: {}, available: {}, inflow: inflow[m], adj: adj[m], over: 0, assignedTotal: 0, carryTotal: 0, activityTotal: 0};
    for (const c of budgetCats) {
      const carry = prev ? Math.max(0, prev.available[c]) : 0, asgC = asg[c] || 0, actC = a[c] || 0, av = round2(carry + asgC + actC);
      r.carry[c] = carry; r.assigned[c] = asgC; r.activity[c] = actC; r.available[c] = av;
      r.carryTotal += carry; r.assignedTotal += asgC; r.activityTotal += actC;
      if (av < 0) r.over += av;
    }
    r.cardPaid = round2(cardPaid); // paid to carried cards so far: they came out of the card's category, so Ready to Assign keeps them
    cash += r.inflow + r.adj + r.activityTotal; r.cash = cash;
    totalAsg += r.assignedTotal;
    P.by[m] = r; prev = r;
  }
  // Ready to Assign = money in so far, minus overspending from earlier months, minus everything assigned (this month and later)
  let inSoFar = plan.opening, overSoFar = 0, asgSoFar = 0; prev = null;
  for (const m of months) {
    const r = P.by[m];
    r.overLast = prev ? prev.over : 0;
    r.leftover = inSoFar + overSoFar - asgSoFar;
    r.future = totalAsg - asgSoFar - r.assignedTotal;
    r.rta = round2(r.leftover + r.inflow + r.adj + r.overLast - r.assignedTotal - r.future);
    inSoFar += r.inflow + r.adj; asgSoFar += r.assignedTotal; overSoFar += r.overLast; prev = r;
  }
  // Hidden categories leave every list built from budgetCats (the money maths above already counted them)
  const nowRow = P.by[thisMonth()];
  P.budgetCats = budgetCats.filter(c => !quietHidden(c, nowRow));
  P.hiddenCats = budgetCats.filter(c => isHidden(c) && !P.budgetCats.includes(c));
  return P;
}

// ---------- Reconcile ----------
// What the app thinks the account balance was at the end of day d
function calcBalance(d) {
  let b = plan.opening;
  for (const t of txns) {
    if (t.date > plan.cutoff && t.date <= d) b += t.amount;
    else if (t.date <= plan.cutoff && t.date > d) b -= t.amount; // a date before the budget started
  }
  for (const x of plan.adjust) if (x.date <= d) b += x.amount;
  return round2(b);
}

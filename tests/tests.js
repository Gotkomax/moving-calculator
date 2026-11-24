// Тести моделі й підказок на цифрах, звірених з API НП (13.11 і 16.11.2026).
// Запуск: відкрити tests/index.html через локальний сервер (див. README).
import * as M from '../js/model.js';
import * as H from '../js/hints.js';
import * as NP from '../js/np.js';
import SNAPSHOT from '../js/snapshot.js';
import { examplePlaces, defaultState, encodeShare, decodeShare, SHARE_MAX_PLACES } from '../js/state.js';

const results = [];
function eq(name, got, want) {
  const ok = Math.abs(Number(got) - Number(want)) < 0.006;
  results.push({ name, ok, detail: ok ? '' : `отримали ${got}, чекали ${want}` });
}
function truthy(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail: cond ? '' : detail });
}

const P = (kg, l, w, h, cost = 500, extra = {}) => ({ id: `t${Math.random()}`, kg, l, w, h, cost, ...extra });
const WW = { address: false };
const DD = { address: true };
const BOTH = { address: true, pickup: true, delivery: true };
const ww = (seats, r) => M.shipmentCost(seats, WW, r).total;

// --- тарифи місця між містами ---
eq('1,9 кг 10×10×10 = 90', ww([P(1.9, 10, 10, 10)]), 90);
eq('2,1 кг 20×20×20 = 135', ww([P(2.1, 20, 20, 20)]), 135);
eq('9,9 кг 30×30×30 = 135', ww([P(9.9, 30, 30, 30)]), 135);
eq('10,1 кг 30×30×30 = 200', ww([P(10.1, 30, 30, 30)]), 200);
eq('30 кг 40×40×40 = 200', ww([P(30, 40, 40, 40)]), 200);
eq('31 кг = 403', ww([P(31, 40, 40, 40)]), 403);
eq('31,5 кг = 416', ww([P(31.5, 40, 40, 40)]), 416);
eq('100 кг = 1300', ww([P(100, 40, 40, 40)]), 1300);
eq('5 кг 70×40×42 (29,4 об.) = 200', ww([P(5, 70, 40, 42)]), 200);
eq('5 кг 71×40×43 (30,5 об.) = 403', ww([P(5, 71, 40, 43)]), 403);
eq('10 кг 102×62×19 (30,04 об.) = 403', ww([P(10, 102, 62, 19)]), 403);
eq('10 кг 102×62×20 (31,6 об.) = 416', ww([P(10, 102, 62, 20)]), 416);
eq('5 кг 121×30×10 = 235', ww([P(5, 121, 30, 10)]), 235);
eq('5 кг 100×71×10 = 300 (друга сторона > 70)', ww([P(5, 100, 71, 10)]), 300);
eq('5 кг 60×71×10 = 200 (після сортування 71×60×10, API так само)', ww([P(5, 60, 71, 10)]), 200);
eq('5 кг 130×75×10 = 300 (доплата одна)', ww([P(5, 130, 75, 10)]), 300);
eq('35 кг 130×40×40 = 826', ww([P(35, 130, 40, 40)]), 826);

// --- страховка ---
eq('20 кг, оцінка 500 = 200', ww([P(20, 40, 40, 40, 500)]), 200);
eq('20 кг, оцінка 501 = 202,51', ww([P(20, 40, 40, 40, 501)]), 202.51);
eq('20 кг, оцінка 3000 = 215', ww([P(20, 40, 40, 40, 3000)]), 215);
eq('20 кг, оцінка 20 000 = 300', ww([P(20, 40, 40, 40, 20000)]), 300);
eq('вантаж 31 кг, оцінка 1000 = 410,5', ww([P(31, 40, 40, 40, 1000)]), 410.5);
eq('вантаж 31 кг, оцінка 501 = 406,76', ww([P(31, 40, 40, 40, 501)]), 406.76);
eq('20 + 31 кг, оцінка 1000 + 1000 = 615,5', ww([P(20, 40, 40, 40, 1000), P(31, 40, 40, 40, 1000)]), 615.5);
eq('20 + 31 кг, оцінка 500 + 1500 = 615,5 (ділиться порівну)', ww([P(20, 40, 40, 40, 500), P(31, 40, 40, 40, 1500)]), 615.5);
eq('2 × 20 кг, оцінка 300 + 300 = 400 (поріг на місце)', ww([P(20, 40, 40, 40, 300), P(20, 40, 40, 40, 300)]), 400);

// --- адреса і «До дверей» ---
eq('адреса: 20 кг, оцінка 1000 = 325', M.shipmentCost([P(20, 40, 40, 40, 1000)], DD).total, 325);
const five25 = Array.from({ length: 5 }, () => P(25, 40, 30, 30));
eq('адреса: 5 × 25 кг = 1800', M.shipmentCost(five25, DD).total, 1800);
eq('адреса: 5 × 25 кг, двері з одного боку = 2200', M.shipmentCost(five25, { address: true, delivery: true }).total, 2200);
eq('адреса: 5 × 25 кг, двері з обох боків = 2600', M.shipmentCost(five25, BOTH).total, 2600);
eq('адреса: 1 × 31 кг = 803', M.shipmentCost([P(31, 40, 30, 30)], DD).total, 803);
eq('адреса: 1 × 31 кг, двері з обох боків = 1203', M.shipmentCost([P(31, 40, 30, 30)], BOTH).total, 1203);
eq('адреса: 1 × 25 кг, двері = 320 (до 30 кг безкоштовно)', M.shipmentCost([P(25, 40, 30, 30)], BOTH).total, 320);

// --- приклад зі сторінки, Київ → Львів (між містами) ---
const ex = examplePlaces();
const q = M.quote(ex, { pickup: true, delivery: true });
eq('приклад: однією накладною з дверима = 2830', q.one.total, 2830);
eq('приклад: окремо з дверима = 1950', q.separate.total, 1950);
eq('приклад: однією без дверей = 2030', M.quote(ex, {}).one.total, 2030);
eq('приклад: страховка = 30', q.one.insurance, 30);
eq('приклад: 2 блоки по 100 кг', q.one.blocks, 2);
const six = [1000, 1000, 1000, 1500, 1500, 2000].map((c) => P(20, 40, 40, 40, c));
eq('страховка округлюється на кожне місце: 8000 на 6 = 40,02', M.shipmentCost(six, WW).insurance, 40.02);

// --- інші зони ---
const city = { ...M.DEFAULT_RATES, tiers: [70, 115, 180], cargoPerKg: 8 };
eq('Київ → Київ: 5 кг = 115', ww([P(5, 20, 20, 20)], city), 115);
eq('Київ → Київ: 40 кг = 320', ww([P(40, 40, 40, 40)], city), 320);
eq('Київ → Київ: адреса 5 кг = 235', M.shipmentCost([P(5, 20, 20, 20)], DD, city).total, 235);
const village = { ...M.DEFAULT_RATES, cargoPerKg: 16, village: 30 };
eq('Київ → Якушинці: 5 кг = 165', ww([P(5, 20, 20, 20)], village), 165);
eq('Київ → Якушинці: адреса 5 кг = 285', M.shipmentCost([P(5, 20, 20, 20)], DD, village).total, 285);
eq('Київ → Якушинці: 40 кг = 640', ww([P(40, 40, 40, 40)], village), 640);
eq('Київ → Якушинці: адреса 40 кг = 1040', M.shipmentCost([P(40, 40, 40, 40)], DD, village).total, 1040);
eq('Київ → Якушинці: адреса 2 × 20 кг = 830 (+30 раз на накладну)', M.shipmentCost([P(20, 40, 40, 40), P(20, 40, 40, 40)], DD, village).total, 830);

// --- калібрування зі зразкових відповідей ---
const yak = M.ratesFromProbes({ ww2: 120, ww5: 165, ww5x2: 300, ww20: 230, ww40: 640, dd5: 285, dd40: 1040, dd40both: 1440 });
truthy('калібрування Якушинців: тарифи 90/135/200', yak && yak.tiers.join('/') === '90/135/200', JSON.stringify(yak && yak.tiers));
eq('калібрування Якушинців: село 30', yak.village, 30);
eq('калібрування Якушинців: вантаж 16 грн/кг', yak.cargoPerKg, 16);
eq('калібрування Якушинців: адреса 120', yak.addrSmall, 120);
eq('калібрування Якушинців: блок 400', yak.addrBlock, 400);
eq('калібрування Якушинців: двері 200', yak.doorBlock, 200);
truthy('калібрування відкидає нісенітницю', M.ratesFromProbes({ ww2: 0, ww5: 0, ww5x2: 0, ww20: 0, ww40: 0, dd5: 0, dd40: 0, dd40both: 0 }) === null);

// --- підказки ---
const label = (id) => `${ex.findIndex((p) => p.id === id) + 1}/${ex.length}`;
const ctx = { rates: M.DEFAULT_RATES, valid: ex, label, doorOn: true };
const h1 = H.placeHints(ex[0], ctx);
truthy('А1: у коробку одягу 12 кг можна докласти 17 кг (запас 1 кг)', h1.some((h) => h.kind === 'info' && h.text.includes('ще до 17 кг')), JSON.stringify(h1));
const h3 = H.placeHints(ex[2], ctx);
truthy('А2: ковдри — вакуумні пакети, 135 замість 200', h3.some((h) => h.kind === 'money' && h.saving === 65 && h.text.includes('вакуум')), JSON.stringify(h3));
const ship = H.shipmentHints(ex, { pickup: true, delivery: true, mode: 'one' }, M.DEFAULT_RATES, { one: q.one.total, separate: q.separate.total });
const mode = ship.find((h) => h.kind === 'mode');
truthy('Б3: окремо дешевше на 880', mode && Math.abs(mode.saving - 880) < 0.01 && mode.to === 'separate', JSON.stringify(ship));
const per = new Map(ex.map((p) => [p.id, H.placeHints(p, ctx)]));
const tip = H.mainTip(ship, per, label);
truthy('головна порада = окремі накладні', tip && tip.kind === 'mode' && Math.abs(tip.saving - 880) < 0.01, JSON.stringify(tip));

const heavy = P(31, 40, 40, 40, 500, { name: 'Книги' });
const light = P(8, 70, 40, 42, 500, { name: 'Одяг' });
const pair = [heavy, light];
const lab2 = (id) => `${pair.findIndex((p) => p.id === id) + 1}/2`;
const hh = H.placeHints(heavy, { rates: M.DEFAULT_RATES, valid: pair, label: lab2, doorOn: true });
const a3 = hh.find((h) => h.kind === 'money');
truthy('А3: 31 кг — вийми 1 кг і переклади в місце 2/2, −203', a3 && a3.saving === 203 && a3.text.includes('2/2'), JSON.stringify(hh));

const big = P(5, 71, 40, 43);
const hb = H.placeHints(big, { rates: M.DEFAULT_RATES, valid: [big], label: () => '1/1', doorOn: false });
const a4 = hb.find((h) => h.kind === 'money');
truthy('А4: 71×40×43 — усі три сторони на вибір, −203', a4 && a4.saving === 203 && a4.text.includes('Зменш одну зі сторін: 71 → 69 см, 43 → 42 см або 40 → 39 см, і буде 200.'), JSON.stringify(hb));
const hintsOf = (p) => H.placeHints(p, { rates: M.DEFAULT_RATES, valid: [p], label: () => '1/1', doorOn: false });
const table = hintsOf(P(10, 105, 65, 18));
truthy('А4: стіл 105×65×18 — можна зняти 1 см товщини, а не лише довжину', table.some((h) => h.saving === 203 && h.text.includes('105 → 102 см, 65 → 63 см або 18 → 17 см')), JSON.stringify(table));
truthy('А4: стіл 105×65×17 — уже 200 грн, без підказки про вантаж', M.placeTariff(P(10, 105, 65, 17)) === 200 && !hintsOf(P(10, 105, 65, 17)).some((h) => h.text.includes('вантаж')));
truthy('варіанти сторін: куб 40×40×41 не повторює однакові сторони', H.shrinkOptions(P(1, 40, 40, 41), 60000).length === 2, JSON.stringify(H.shrinkOptions(P(1, 40, 40, 41), 60000)));

const long = P(5, 121, 30, 10);
const hl = H.placeHints(long, { rates: M.DEFAULT_RATES, valid: [long], label: () => '1/1', doorOn: false });
truthy('А6: довжина 121 — скороти до 120, −100', hl.some((h) => h.kind === 'money' && h.saving === 100 && h.text.includes('120 см')), JSON.stringify(hl));

const desk = P(10, 100, 60, 15, 3000, { name: 'Стіл' });
const hd = H.placeHints(desk, { rates: M.DEFAULT_RATES, valid: [desk], label: () => '1/1', doorOn: false });
truthy('стіл 100×60×15: тонше не здешевшає', hd.some((h) => h.kind === 'info' && h.text.includes('Тонший')), JSON.stringify(hd));

const one = (p) => H.placeHints(p, { rates: M.DEFAULT_RATES, valid: [p], label: () => '1/1', doorOn: false });
// Зона ваги в 70×40×42, рішення 19.11: до 26 кг — «докласти» (з запасом 1 кг), 26–30 — тиша, понад 30 — вантаж.
const box = (w) => one(P(w, 70, 40, 42));
const tight = (list) => list.find((h) => h.id === 'tight');
const add = (list) => list.find((h) => h.kind === 'info' && h.text.startsWith('Можна докласти'));
truthy('зона: 12 кг — «ще до 17 кг», без попередження', add(box(12))?.text.includes('ще до 17 кг') && !tight(box(12)), JSON.stringify(box(12)));
truthy('зона: 26 кг — «ще до 3 кг»', add(box(26))?.text.includes('ще до 3 кг') && !tight(box(26)), JSON.stringify(box(26)));
truthy('зона: 27 кг — тиша', !add(box(27)) && !tight(box(27)), JSON.stringify(box(27)));
truthy('зона: 29 кг — тиша', !add(box(29)) && !tight(box(29)), JSON.stringify(box(29)));
truthy('зона: 29,5 кг — тиша', box(29.5).length === 0, JSON.stringify(box(29.5)));
truthy('зона: рівно 30 кг — тиша', box(30).length === 0, JSON.stringify(box(30)));
truthy('зона: без «роздує» і без «впритул»', [12, 22, 25, 27, 29.5, 30].every((w) => !box(w).some((h) => h.id === 'tight' || h.text.includes('роздує') || h.text.includes('межа тарифу'))));
truthy('зона 10 кг: 9,8 кг — тиша', one(P(9.8, 30, 30, 30)).length === 0, JSON.stringify(one(P(9.8, 30, 30, 30))));

// --- міцність коробок ---
truthy('міцність: 47×40×42 = 20 кг, 70×40×42 = 30, 60×35×28,5 = 15', H.boxCapacity(P(1, 42, 47, 40)) === 20 && H.boxCapacity(P(1, 70, 40, 42)) === 30 && H.boxCapacity(P(1, 60, 35, '28,5')) === 15 && H.boxCapacity(P(1, 60, 40, 40)) === null);
const h47 = one(P(14, 47, 40, 42));
truthy('А1: 47×40×42 з 14 кг — ще 6 кг, не 16', h47.some((h) => h.kind === 'info' && h.text.includes('ще 6 кг') && h.text.includes('20 кг')), JSON.stringify(h47));
const h47over = one(P(22, 47, 40, 42));
truthy('47×40×42 з 22 кг — дно може не витримати, розміри як введено', h47over.some((h) => h.kind === 'warn' && h.text.includes('Коробка 47×40×42 розрахована до 20 кг, а в ній 22 кг')), JSON.stringify(h47over));
const hUnknown = one(P(9, 60, 40, 40));
truthy('А1: невідома коробка — «якщо коробка витримає»', hUnknown.some((h) => h.kind === 'info' && h.text.includes('якщо коробка витримає')), JSON.stringify(hUnknown));

const books = [P(17, 40, 30, 30, 500, { name: 'Книги' }), ...Array.from({ length: 6 }, () => P(9, 60, 40, 40, 500, { name: 'Одяг' }))];
const sb = H.shipmentHints(books, { mode: 'one' }, M.DEFAULT_RATES, { one: 0, separate: 0 });
truthy('Б1: книги на дно — менше місць', sb.some((h) => h.text.includes('книги на дно')), JSON.stringify(sb));

const over = [...Array.from({ length: 6 }, () => P(5, 70, 40, 42)), P(5, 30, 30, 30)];
const so = H.shipmentHints(over, { mode: 'one', pickup: true, delivery: true }, M.DEFAULT_RATES, { one: 0, separate: 0 });
truthy('Б2: 183,2 кг — не спрацьовує (далеко від межі)', !so.some((h) => h.text.includes('доплата за адресу впаде')), JSON.stringify(so));
const near = [...Array.from({ length: 7 }, () => P(5, 70, 40, 42))]; // 205,8 кг
const sn = H.shipmentHints(near, { mode: 'one', pickup: true, delivery: true }, M.DEFAULT_RATES, { one: 0, separate: 0 });
truthy('Б2: 205,8 кг — скинь 5,8 кг, −800', sn.some((h) => h.saving === 800 && h.text.includes('5,8')), JSON.stringify(sn));

// --- посилання «поділитися» ---
const shared = decodeShare(encodeShare({ ...defaultState(), boxPrice: '80,5', mode: 'separate', pickup: false }));
truthy('посилання: ціна коробки з комою 80,5 не губиться', shared.boxPrice === 80.5, String(shared.boxPrice));
truthy('посилання: міста, режим і місця ті самі', shared.from.name === 'Київ' && shared.to.name === 'Львів' && shared.mode === 'separate' && shared.pickup === false && shared.places.length === 6 && shared.places[3].kg === 22, JSON.stringify(shared));
const many = decodeShare(encodeShare({ ...defaultState(), places: Array.from({ length: 300 }, () => P(5, 20, 20, 20, 500, { name: 'x'.repeat(500) })) }));
truthy('посилання: не більше 100 місць, назва до 80 символів', many.places.length === SHARE_MAX_PLACES && many.places[0].name.length === 80, `${many.places.length} / ${many.places[0].name.length}`);

// --- знімок прикладу (js/snapshot.js) ---
const ds = defaultState();
const dsRoute = { from: ds.from.ref, to: ds.to.ref };
truthy('знімок: той самий приклад, що на сторінці (змінив приклад — онови знімок)', SNAPSHOT.key === NP.verifyKey(dsRoute, ds, ds.places), SNAPSHOT.key);
truthy('знімок: маршрут прикладу', SNAPSHOT.route.from === dsRoute.from && SNAPSHOT.route.to === dsRoute.to);
const sq = M.quote(ds.places, { pickup: ds.pickup, delivery: ds.delivery }, SNAPSHOT.rates);
eq('знімок: модель зі ставками знімка = сума НП однією накладною', sq.one.total, SNAPSHOT.totals.one);
eq('знімок: модель зі ставками знімка = сума НП окремими накладними', sq.separate.total, SNAPSHOT.totals.separate);
truthy('знімок: інший набір місць зі знімка не береться', NP.snapshotTotals(NP.verifyKey(dsRoute, ds, ds.places.slice(1))) === null);

// --- вивід ---
const failed = results.filter((r) => !r.ok);
document.title = failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS ${results.length}/${results.length}`;
const out = document.getElementById('out');
out.innerHTML = `<p><b>${document.title}</b></p>` + results.map((r) => `<div class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}</div>`).join('');

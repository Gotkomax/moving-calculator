import * as M from './model.js';
import * as H from './hints.js';
import * as NP from './np.js';
import * as S from './state.js';

const $ = (id) => document.getElementById(id);
const money = H.money;
const kg = H.kg;
const plural = new Intl.PluralRules('uk-UA');
const placesWord = (n) => ({ one: 'місце', few: 'місця', many: 'місць', other: 'місця' })[plural.select(n)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PRESETS = [
  // лише коробки з відомою міцністю (hints.js, KNOWN_BOXES)
  { label: '70×40×42 · до 30 кг', name: 'Коробка', l: 70, w: 40, h: 42 },
  { label: '47×40×42 · до 20 кг', name: 'Коробка', l: 47, w: 40, h: 42 },
  { label: '60×35×28,5 · до 15 кг', name: 'Коробка', l: 60, w: 35, h: '28,5' },
];

const ICON = {
  copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="1"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
  bulb: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
  alert: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
};

let state;
let rates = M.DEFAULT_RATES;
let ratesStatus = 'default'; // default | pending | calibrated | failed
let api = { key: null, totals: null, status: 'idle', at: 0 };
let verifyTimer = null;
let verifyAbort = null;
let ratesAbort = null;
let lastTip = null;
// Пауза після останньої правки перед звіркою з API: щоб не слати запит на кожну набрану цифру.
const VERIFY_DELAY_MS = 2000;
// Розрахунок, відкритий з чужого посилання. Поки людина його не змінила, свій збережений список не чіпаємо.
let sharedSnapshot = null;

// ---------------------------------------------------------------- старт

function init() {
  const loaded = S.load();
  state = loaded.state;
  if (loaded.fromLink) {
    sharedSnapshot = JSON.stringify(state);
    setTimeout(() => toast('Відкрито розрахунок з посилання'), 300);
  }
  bindStatic();
  bindCity('from');
  bindCity('to');
  renderRoute();
  renderPlaces();
  update();
  loadRates();
  setupSticky();
  // посилання вставили у вже відкриту вкладку
  window.addEventListener('hashchange', () => {
    if (/[#&]s=/.test(location.hash)) location.reload();
  });
}

// ---------------------------------------------------------------- маршрут і налаштування

function renderRoute() {
  for (const which of ['from', 'to']) {
    const root = document.querySelector(`.city[data-city="${which}"]`);
    root.querySelector('input').value = state[which].name || '';
    root.querySelector('[data-role="note"]').textContent = state[which].present || '';
  }
  $('pickup').checked = !!state.pickup;
  $('delivery').checked = !!state.delivery;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  $('box-price').value = state.boxPrice ?? '';
}

function bindStatic() {
  $('pickup').addEventListener('change', (e) => { state.pickup = e.target.checked; update(); });
  $('delivery').addEventListener('change', (e) => { state.delivery = e.target.checked; update(); });
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  }
  $('box-price').addEventListener('input', (e) => { state.boxPrice = e.target.value; update(); });

  $('presets').innerHTML = PRESETS.map((p, i) => `<button type="button" data-preset="${i}">${esc(p.label)}</button>`).join('');
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const pr = PRESETS[Number(b.dataset.preset)];
    addPlace(S.emptyPlace({ name: pr.name, l: pr.l, w: pr.w, h: pr.h }), 'kg');
  });
  $('add-place').addEventListener('click', () => addPlace(S.emptyPlace(), 'name'));
  $('clear').addEventListener('click', () => {
    state.places = [];
    state.isExample = false;
    renderPlaces();
    update();
    $('add-place').focus();
  });
  $('show-example').addEventListener('click', () => {
    state.places = S.examplePlaces();
    state.isExample = true;
    renderPlaces();
    update();
  });

  const list = $('place-list');
  const onField = (e) => {
    const t = e.target;
    const field = t.dataset && t.dataset.field;
    if (!field) return;
    const p = placeOf(t);
    if (!p) return;
    p[field] = t.type === 'checkbox' ? t.checked : t.value;
    if (field === 'kg') p.approx = false;
    if (field !== 'buy') state.isExample = false;
    $('example-note').hidden = !(state.isExample && state.places.length);
    update();
  };
  list.addEventListener('input', onField);
  list.addEventListener('change', (e) => { if (e.target.type === 'checkbox') onField(e); });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const p = placeOf(b);
    const i = state.places.indexOf(p);
    if (b.dataset.action === 'copy') {
      const copy = { ...p, id: S.newId() };
      state.places.splice(i + 1, 0, copy);
      renderPlaces();
      update();
      flash(copy.id);
    } else if (b.dataset.action === 'remove') {
      state.places.splice(i, 1);
      renderPlaces();
      update();
      const next = state.places[Math.min(i, state.places.length - 1)];
      const target = next ? document.querySelector(`[data-id="${next.id}"] .place-name`) : $('add-place');
      target && target.focus();
    }
  });

  $('tip-btn').addEventListener('click', () => {
    if (!lastTip) return;
    if (lastTip.kind === 'mode') setMode(lastTip.to);
    else if (lastTip.placeId) {
      const el = document.querySelector(`[data-id="${lastTip.placeId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flash(lastTip.placeId);
      }
    }
  });
  $('share').addEventListener('click', share);
  $('copy-chat').addEventListener('click', async () => {
    const ok = await copyText(chatText());
    toast(ok ? 'Текст скопійовано — встав у чат' : 'Не вдалося скопіювати');
  });
}

function setMode(mode) {
  state.mode = mode === 'separate' ? 'separate' : 'one';
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  update();
}

function bindCity(which) {
  const root = document.querySelector(`.city[data-city="${which}"]`);
  const input = root.querySelector('input');
  const list = root.querySelector('.city-list');
  const note = root.querySelector('[data-role="note"]');
  let timer = null;
  let ctrl = null;
  let items = [];
  let active = -1;

  const open = () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const msg = (t) => { items = []; list.innerHTML = `<li class="city-msg">${esc(t)}</li>`; open(); };
  const draw = () => {
    if (!items.length) return msg('Нічого не знайшли. Адресна доставка НП є не всюди.');
    list.innerHTML = items
      .map((c, i) => `<li role="presentation"><button type="button" role="option" tabindex="-1" id="${which}-opt-${i}" data-i="${i}" aria-selected="${i === active}">${esc(c.present)}</button></li>`)
      .join('');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${which}-opt-${active}`);
    open();
  };
  const pick = (c) => {
    state[which] = { name: c.name, present: c.present, ref: c.ref };
    input.value = c.name;
    note.textContent = c.present;
    close();
    loadRates();
    update();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      msg('Шукаю…');
      try {
        items = await NP.searchCities(q, ctrl.signal);
        active = items.length ? 0 : -1;
        draw();
      } catch (e) {
        if (e.name !== 'AbortError') msg('Пошук Нової Пошти не відповідає. Спробуй ще раз.');
      }
    }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[Math.max(0, active)]);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      close();
      if (input.value.trim() !== state[which].name) input.value = state[which].name || '';
    }, 150);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) pick(items[Number(b.dataset.i)]);
  });
}

async function loadRates() {
  if (ratesAbort) ratesAbort.abort();
  if (!state.from.ref || !state.to.ref) {
    rates = M.DEFAULT_RATES;
    ratesStatus = 'default';
    update();
    return;
  }
  ratesAbort = new AbortController();
  ratesStatus = 'pending';
  updateStatus();
  try {
    rates = await NP.calibrate({ from: state.from.ref, to: state.to.ref }, ratesAbort.signal);
    ratesStatus = 'calibrated';
  } catch (e) {
    if (e.name === 'AbortError') return;
    rates = M.DEFAULT_RATES;
    ratesStatus = 'failed';
  }
  update();
}

// ---------------------------------------------------------------- місця

function placeOf(el) {
  const li = el.closest('[data-id]');
  return li && state.places.find((p) => p.id === li.dataset.id);
}

function addPlace(p, focusField) {
  state.places.push(p);
  state.isExample = false;
  renderPlaces();
  update();
  const el = document.querySelector(`[data-id="${p.id}"] [data-field="${focusField}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }
}

function flash(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function numInput(field, p, ph, label, mode = 'decimal') {
  return `<input class="input input-num" data-field="${field}" value="${esc(p[field])}" inputmode="${mode}" placeholder="${ph}" aria-label="${label}">`;
}

function placeHtml(p) {
  return `<li class="place" data-id="${esc(p.id)}">
  <div class="place-top"><span class="place-no">МІСЦЕ <span data-role="no"></span></span><span class="place-price" data-role="price"></span></div>
  <div class="place-name-row">
    <input class="place-name" data-field="name" value="${esc(p.name)}" placeholder="Що всередині" aria-label="Що в місці">
    <button type="button" class="icon-btn" data-action="copy" aria-label="Копіювати місце" title="Копіювати">${ICON.copy}</button>
    <button type="button" class="icon-btn" data-action="remove" aria-label="Видалити місце" title="Видалити">${ICON.x}</button>
  </div>
  <div class="place-dims">
    ${numInput('l', p, 'Д', 'Довжина, см')}<span>×</span>${numInput('w', p, 'Ш', 'Ширина, см')}<span>×</span>${numInput('h', p, 'В', 'Висота, см')}<span class="unit">см</span>
    ${numInput('kg', p, 'кг', 'Вага, кг')}<span>кг</span>
  </div>
  <div class="place-meta"><span data-role="paid"></span></div>
  <div class="place-opts">
    <label class="cost">оцінка ${numInput('cost', p, '500', 'Оголошена вартість, грн', 'numeric')} грн</label>
    <label class="check"><input type="checkbox" data-field="buy"${p.buy ? ' checked' : ''}>Купити коробку<span class="buy-price" data-role="buy-price"></span></label>
  </div>
  <div class="place-hints" data-role="hints"></div>
</li>`;
}

function renderPlaces() {
  $('place-list').innerHTML = state.places.map(placeHtml).join('');
  $('example-note').hidden = !(state.isExample && state.places.length);
  $('empty').hidden = state.places.length > 0;
}

function paidText(p) {
  if (!M.hasDims(p)) return 'розміри не вказано';
  const w = M.weightKg(p);
  const vol = M.volumeKg(p);
  if (M.isCargo(p)) return `вантаж: ${Math.ceil(M.paidKg(p) - 1e-9)} кг × ${money(rates.cargoPerKg)} грн`;
  return vol > w ? `платна ${kg(vol)} кг за об’ємом` : `платна ${kg(w)} кг за вагою`;
}

function hintHtml(h) {
  const icon = h.kind === 'error' || h.kind === 'warn' ? ICON.alert : ICON.bulb;
  const save = h.kind === 'money' && h.saving > 0 ? ` <span class="save">−${money(h.saving)} грн</span>` : '';
  return `<div class="hint" data-kind="${h.kind}">${icon}<span><mark>${esc(h.text)}</mark>${save}</span></div>`;
}

// ---------------------------------------------------------------- розрахунок

function verifyKey(valid) {
  return NP.verifyKey({ from: state.from.ref, to: state.to.ref }, state, valid);
}

/** Якщо на сторінці саме приклад зі знімка, беремо його суми й не питаємо API. */
function useSnapshot(key) {
  if (api.key === key && api.status === 'ok') return;
  const snap = NP.snapshotTotals(key);
  if (!snap) return;
  clearTimeout(verifyTimer);
  api = { key, totals: snap.totals, status: 'ok', at: snap.at };
}

function update() {
  const valid = state.places.filter(M.hasDims);
  const opts = { pickup: !!state.pickup, delivery: !!state.delivery, mode: state.mode };
  const q = M.quote(valid, opts, rates);
  const key = verifyKey(valid);
  useSnapshot(key);
  const apiOk = api.key === key && api.status === 'ok' && api.totals;
  const totals = apiOk ? api.totals : { one: q.one.total, separate: q.separate.total };
  const n = state.places.length;
  const label = (id) => `${state.places.findIndex((p) => p.id === id) + 1}/${n}`;
  const ctx = { rates, valid, label, doorOn: opts.pickup || opts.delivery };
  const per = new Map(state.places.map((p) => [p.id, H.placeHints(p, ctx)]));
  const ship = H.shipmentHints(valid, opts, rates, totals);
  const tip = H.mainTip(ship, per, label);
  lastTip = tip;

  // картки місць
  for (const p of state.places) {
    const li = document.querySelector(`[data-id="${p.id}"]`);
    if (!li) continue;
    li.querySelector('[data-role="no"]').textContent = label(p.id);
    li.querySelector('[data-role="price"]').textContent = M.hasDims(p) ? `${money(M.placeTariff(p, rates))} грн` : '—';
    li.querySelector('[data-role="paid"]').innerHTML = esc(paidText(p)) + (p.approx ? ' <span class="badge">орієнтир</span>' : '');
    const boxEach = M.num(state.boxPrice);
    li.querySelector('[data-role="buy-price"]').textContent = p.buy && boxEach ? `+${money(boxEach)} грн` : '';
    li.querySelector('[data-role="hints"]').innerHTML = H.pickForCard(per.get(p.id)).map(hintHtml).join('');
  }

  // разом
  const cur = state.mode === 'separate' ? 'separate' : 'one';
  const other = cur === 'one' ? 'separate' : 'one';
  const boxes = state.places.filter((p) => p.buy).length;
  const boxPrice = M.num(state.boxPrice);
  const boxCost = boxes * boxPrice;
  const grand = valid.length ? totals[cur] + boxCost : 0;
  const factKg = valid.reduce((s, p) => s + M.weightKg(p), 0);
  $('total-sum').textContent = money(grand);
  $('total-summary').textContent = valid.length ? `${valid.length} ${placesWord(valid.length)} · ${kg(factKg)} кг` : '';
  $('total-note').textContent = valid.length ? totalNote(cur, boxes, apiOk) : 'Додай місця, щоб порахувати.';

  const tipEl = $('tip');
  if (tip && valid.length) {
    tipEl.hidden = false;
    $('tip-none').hidden = true;
    $('tip-saving').textContent = `−${money(tip.saving)} грн`;
    $('tip-text').textContent = tip.text;
    $('tip-sub').textContent = tip.sub || '';
    const btn = $('tip-btn');
    btn.hidden = !(tip.kind === 'mode' || tip.placeId);
    btn.textContent = tip.kind === 'mode' ? tip.action : 'Показати місце';
  } else {
    tipEl.hidden = true;
    $('tip-none').hidden = !valid.length;
  }
  $('ship-notes').innerHTML = ship
    .filter((h) => h !== tip && !(h.id === 'lift' && tip && tip.mentionsLift))
    .map((h) => `<li>${esc(h.text)}${h.saving > 0 ? ` (−${esc(money(h.saving))} грн)` : ''}</li>`)
    .join('');

  renderBreakdown(q[cur], cur, totals, apiOk, boxes, boxPrice, boxCost, other, valid.length);
  renderRules();

  $('sticky-sum').textContent = money(grand);
  $('sticky-tip').textContent = tip && valid.length ? `−${money(tip.saving)} грн` : '';

  scheduleVerify(key, valid);
  updateStatus();
  persist();
}

/** Зберігає список. Розрахунок з посилання — лише після першої правки, тоді ж прибираємо #s= з адреси. */
function persist() {
  if (sharedSnapshot) {
    if (JSON.stringify(state) === sharedSnapshot) return;
    sharedSnapshot = null;
    history.replaceState(null, '', location.pathname + location.search);
  }
  S.save(state);
}

function totalNote(cur, boxes, apiOk) {
  const mode = cur === 'one' ? 'Однією накладною' : 'Кожне місце окремою накладною';
  const doors = state.pickup && state.delivery
    ? 'з «До дверей» з обох боків'
    : state.pickup
      ? 'кур’єр забирає з квартири'
      : state.delivery
        ? 'кур’єр заносить у квартиру'
        : 'без послуги «До дверей»';
  const box = boxes ? ` З коробками: ${boxes} шт.` : ' Коробки не враховано.';
  const approx = apiOk ? '' : api.status === 'error' ? ' Орієнтовно: НП не відповіла.' : ' Звіряю з НП…';
  return `${mode}, ${doors}.${box}${approx}`;
}

function renderBreakdown(b, cur, totals, apiOk, boxes, boxPrice, boxCost, other, count) {
  const sides = (state.pickup ? 1 : 0) + (state.delivery ? 1 : 0);
  const lines = [];
  if (count) {
    lines.push(['Тариф місць', `${count} ${placesWord(count)}`, b.tariff]);
    lines.push(['Страховка', 'від оцінки місця понад 500 грн', b.insurance]);
    if (cur === 'one') {
      const sub = b.blocks
        ? `${kg(b.W)} кг ${b.drivenBy === 'vol' ? 'об’ємної ваги' : 'фактичної ваги'}: ${b.blocks} × ${money(rates.addrBlock)} грн`
        : `накладна до 30 кг`;
      lines.push(['Забір і доставка за адресою', sub, b.address]);
    } else {
      lines.push(['Забір і доставка за адресою', `${count} накладних`, b.address]);
    }
    if (b.village) lines.push(['Доплата за село', cur === 'one' ? 'на накладну' : 'на кожну накладну', b.village]);
    if (sides) {
      const sub = cur === 'one'
        ? b.blocks
          ? `${money(rates.doorBlock)} грн за кожні 100 кг з ${sides === 2 ? 'кожного боку' : 'одного боку'}`
          : 'для накладної до 30 кг безкоштовно'
        : 'для накладних до 30 кг безкоштовно';
      lines.push(['«До дверей»', sub, b.door]);
    }
    if (apiOk && Math.abs(totals[cur] - b.total) > 0.5) {
      lines.push(['Різниця з розрахунком НП', 'НП порахувала інакше, показуємо її суму', M.round2(totals[cur] - b.total)]);
    }
  }
  lines.push(['Коробки', boxes ? `${boxes} шт. × ${money(boxPrice)} грн` : 'познач «Купити коробку», де потрібна нова', boxCost]);
  $('lines').innerHTML = lines
    .map(([what, sub, val]) => `<li><span class="what"><span>${esc(what)}</span><span class="sub">${esc(sub)}</span></span><span class="val">${esc(money(val))}</span></li>`)
    .join('');
  const grand = count ? totals[cur] + boxCost : 0;
  $('bd-total').textContent = `${money(grand)} грн`;
  $('bd-alt').textContent = count > 1 ? `${other === 'one' ? 'Однією накладною' : 'Кожне місце окремою накладною'}: ${money(totals[other])} грн (без коробок).` : '';
}

function renderRules() {
  const r = rates;
  const items = [
    'Платна вага місця — більша з фактичної і об’ємної (Д×Ш×В / 4000).',
    `Місце до 2 кг — ${money(r.tiers[0])} грн, до 10 кг — ${money(r.tiers[1])}, до 30 кг — ${money(r.tiers[2])}. Понад 30 кг — вантаж, ${money(r.cargoPerKg)} грн за кожен почато кілограм.`,
    `Довжина понад 120 см або друга сторона понад 70 см — доплата ${money(r.oversize)} грн.`,
    'Страховка — 0,5% оцінки місця, якщо оцінка понад 500 грн (вантаж — 0,75%). Оцінку накладної НП ділить порівну між місцями.',
    `Адреса: накладна до 30 кг — ${money(r.addrSmall)} грн; важча — ${money(r.addrBlock)} грн за кожні почато 100 кг більшої з фактичної і об’ємної ваги накладної.`,
    `«До дверей»: накладна до 30 кг — безкоштовно; важча — ${money(r.doorBlock)} грн за кожні почато 100 кг з кожного боку. Без цієї послуги важку накладну віддають біля машини.`,
    'Якщо ліфт не працює, накладну понад 30 кг заносять лише на 1-й поверх, до 30 кг — до 5-го.',
    'Одне місце — до 1100 кг і 300×170×170 см. «До дверей» бере місця до 100 кг.',
  ];
  if (r.village) items.splice(5, 0, `Село з іншого міста: +${money(r.village)} грн на накладну з місцями до 30 кг.`);
  const route = state.from.name && state.to.name ? `${state.from.name} → ${state.to.name}` : '';
  const tail = ratesStatus === 'calibrated'
    ? `Ставки для маршруту ${route} перевірено запитами до НП.`
    : ratesStatus === 'pending'
      ? 'Перевіряю ставки для маршруту…'
      : 'Показано ставки між містами: для твого маршруту перевірити не вдалося.';
  $('rules-list').innerHTML = [...items, tail].map((t) => `<li>${esc(t)}</li>`).join('');
}

// ---------------------------------------------------------------- звірка з API

function scheduleVerify(key, valid) {
  if (!state.from.ref || !state.to.ref || !valid.length) {
    clearTimeout(verifyTimer);
    api = { key: null, totals: null, status: 'idle', at: 0 };
    return;
  }
  if (api.key === key && api.status !== 'idle') return;
  api = { key, totals: null, status: 'pending', at: 0 };
  clearTimeout(verifyTimer);
  verifyTimer = setTimeout(async () => {
    if (verifyAbort) verifyAbort.abort();
    verifyAbort = new AbortController();
    try {
      const totals = await NP.verify({ from: state.from.ref, to: state.to.ref }, valid, { pickup: !!state.pickup, delivery: !!state.delivery }, verifyAbort.signal);
      if (api.key !== key) return;
      api = { key, totals, status: 'ok', at: Date.now() };
    } catch (e) {
      if (e.name === 'AbortError' || api.key !== key) return;
      api = { key, totals: null, status: 'error', at: 0 };
    }
    update();
  }, VERIFY_DELAY_MS);
}

function updateStatus() {
  const el = $('status');
  const text = $('status-text');
  if (!state.from.ref || !state.to.ref) {
    el.dataset.state = 'idle';
    text.textContent = 'Обери міста, щоб звірити ціни з Новою Поштою';
  } else if (api.status === 'ok') {
    el.dataset.state = 'ok';
    const at = new Date(api.at);
    const today = at.toDateString() === new Date().toDateString();
    const t = today
      ? `о ${at.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`
      : at.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
    text.textContent = `Ціни з API Нової Пошти · звірено ${t}`;
  } else if (api.status === 'error') {
    el.dataset.state = 'offline';
    text.textContent = 'Нова Пошта не відповідає — ціни за нашою моделлю, орієнтовні';
  } else if (api.status === 'pending' || ratesStatus === 'pending') {
    el.dataset.state = 'pending';
    text.textContent = 'Звіряю ціни з Новою Поштою…';
  } else {
    el.dataset.state = 'idle';
    text.textContent = 'Додай місця, і ціни звіримо з Новою Поштою';
  }
}

// ---------------------------------------------------------------- поділитися

function chatText() {
  const valid = state.places.filter(M.hasDims);
  const cur = state.mode === 'separate' ? 'separate' : 'one';
  const lines = ['Кошторис переїзду Новою Поштою'];
  lines.push(`${state.from.name || '?'} → ${state.to.name || '?'}, адреса → адреса`);
  lines.push(`${$('total-summary').textContent}`);
  lines.push(`${cur === 'one' ? 'Однією накладною' : 'Кожне місце окремою накладною'}: ${$('total-sum').textContent} грн`);
  if (lastTip && valid.length) lines.push(`Порада: ${lastTip.text} (−${money(lastTip.saving)} грн)`);
  lines.push(`Розрахунок: ${S.shareUrl(state)}`);
  return lines.join('\n');
}

async function share() {
  const url = S.shareUrl(state);
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Кошторис переїзду', text: `Переїзд ${state.from.name} → ${state.to.name}: ${$('total-sum').textContent} грн`, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const ok = await copyText(url);
  toast(ok ? 'Посилання скопійовано' : 'Не вдалося скопіювати');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function setupSticky() {
  const sticky = $('sticky');
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(([e]) => {
    sticky.hidden = e.isIntersecting || !state.places.length;
  }).observe($('total'));
}

init();

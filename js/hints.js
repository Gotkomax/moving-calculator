// Підказки: вмикаються від цифр місця чи накладної і кажуть, що зробити й скільки це дасть.
// Повний перелік і звідки кожна взялася: docs/hints.md.
import * as M from './model.js';

const SOFT = /одяг|ковдр|подуш|рушник|плед|постіл|куртк|пухов|м['’]як|текстил|білизн/i;
const APPLIANCE = /мікрохвил|телевіз|монітор|станці|пральн|холодильн|техніка|ноутбук|принтер|пилосос/i;
const VACUUM_BOX = { 0: '20×20×20', 1: '40×30×33' };

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
const fmtKg = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
export const money = (x) => fmt.format(M.round2(x));
export const kg = (x) => fmtKg.format(Math.round(x * 10) / 10);
const cm = (x) => fmtKg.format(x);
/** Вгору до 0,1 без похибки плаваючої коми (9,8 − 9,5 = 0,30000000000000071). */
const ceil1 = (x) => Math.ceil(Math.round(x * 1000) / 100 - 1e-9) / 10;

/** Найменше зменшення однієї сторони, щоб об'єм не перевищив targetCm3. */
export function shrinkTo(p, targetCm3) {
  const s = M.sides(p);
  let best = null;
  for (let i = 0; i < 3; i++) {
    const other = s.filter((_, j) => j !== i).reduce((a, b) => a * b, 1);
    if (!other) return null;
    const to = Math.floor(targetCm3 / other);
    if (to < 1 || to >= s[i]) continue;
    const ratio = (s[i] - to) / s[i];
    if (!best || ratio < best.ratio) best = { index: i, from: s[i], to, ratio };
  }
  return best;
}

function withSide(p, index, value) {
  const s = M.sides(p);
  s[index] = value;
  return { ...p, l: s[0], w: s[1], h: s[2] };
}

const upperKg = (t) => M.TIER_KG[Math.min(t, 2)];

// Коробки, для яких відомо, скільки витримує дно (не тариф, а міцність).
// 70×40×42 — коробка НП «Велика, до 30 кг»; 47×40×42 — НП радить до 20 кг (19.11.2026);
// 60×35×28,5 — маркування на коробці (23.10.2026).
export const KNOWN_BOXES = [
  { dims: [70, 42, 40], maxKg: 30 },
  { dims: [47, 42, 40], maxKg: 20 },
  { dims: [60, 35, 28.5], maxKg: 15 },
];

/** Скільки витримує коробка таких розмірів, або null, якщо не знаємо. */
export function boxCapacity(p) {
  const s = M.sides(p);
  const hit = KNOWN_BOXES.find((b) => b.dims.every((d, i) => Math.abs(d - s[i]) <= 0.5));
  return hit ? hit.maxKg : null;
}

/** Запас до межі тарифу на різницю між домашніми вагами й вагами відділення. */
export const reserveKg = (t) => (t >= 2 ? 1 : 0.5);

/** Скільки ще можна докласти без зміни тарифу (з запасом) і так, щоб коробка витримала. */
export function freeKg(p) {
  if (!M.hasDims(p) || M.isCargo(p)) return 0;
  const t = M.tierIndex(p);
  const cap = boxCapacity(p);
  return Math.max(0, Math.min(upperKg(t) - reserveKg(t), cap ?? Infinity) - M.weightKg(p));
}

const asEntered = (p) => [p.l, p.w, p.h].map((x) => cm(M.num(x))).join('×');

/**
 * Підказки для одного місця.
 * ctx: { rates, valid: місця з розмірами, label(id) → "2/6", doorOn }
 * Повертає список від найважливішої: error → money → warn → info.
 */
export function placeHints(p, ctx) {
  const r = ctx.rates;
  const out = [];
  if (!M.hasDims(p)) {
    out.push({ kind: 'need', text: 'Впиши три розміри коробки — без них ціну не порахувати.' });
    return out;
  }
  const s = M.sides(p);
  const w = M.weightKg(p);
  const vol = M.volumeKg(p);
  const cur = M.placeTariff(p, r);

  if (w > M.LIMITS.placeKg || s[0] > M.LIMITS.dims[0] || s[1] > M.LIMITS.dims[1] || s[2] > M.LIMITS.dims[2]) {
    out.push({ kind: 'error', text: 'Нова Пошта не прийме таке місце: максимум 1100 кг і 300×170×170 см.' });
  }
  if (ctx.doorOn && w > M.LIMITS.doorPlaceKg) {
    out.push({ kind: 'warn', text: 'Послуга «До дверей» — лише для місць до 100 кг. Це місце кур’єр у квартиру не занесе.' });
  }
  const cap = boxCapacity(p);
  if (cap && w > cap) {
    out.push({
      kind: 'warn',
      text: `Коробка ${asEntered(p)} розрахована до ${cap} кг, а в ній ${kg(w)} кг. Дно може не витримати — переклади частину в іншу коробку.`,
    });
  }

  const gains = [];

  // А3. Обрив на 30 кг за вагою.
  if (w > 30 && w <= 36 && vol <= 30) {
    const excess = ceil1(w - 30);
    const fixed = M.placeTariff({ ...p, kg: 30 }, r);
    const saving = cur - fixed;
    if (saving > 0) {
      const host = (ctx.valid || []).find((q) => q.id !== p.id && freeKg(q) >= excess);
      const where = host ? ` і переклади в місце ${ctx.label(host.id)} — там ще ${kg(freeKg(host))} кг без доплати` : '';
      gains.push({
        kind: 'money',
        saving,
        text: `${kg(w)} кг — це вже вантаж: ${money0(cur)} грн замість ${money0(fixed)}. Вийми ${kg(excess)} кг${where}.`,
      });
    }
  }

  // А4. Обрив на 120 000 см³ за об'ємом.
  if (vol > 30 && vol <= 36 && w <= 30) {
    const sh = shrinkTo(p, 30 * M.DIVISOR);
    if (sh) {
      const fixed = M.placeTariff(withSide(p, sh.index, sh.to), r);
      const saving = cur - fixed;
      if (saving > 0) {
        gains.push({
          kind: 'money',
          saving,
          text: `Об’ємна вага ${kg(vol)} кг — це вже вантаж: ${money0(cur)} грн замість ${money0(fixed)}. Якщо сторону ${cm(sh.from)} см зменшити до ${cm(sh.to)} см, буде ${money0(fixed)}.`,
        });
      }
    }
  }

  // А6. Габарит: довжина понад 120 або друга сторона понад 70.
  if (M.isOversize(p)) {
    const fixedP = { ...p, l: Math.min(s[0], 120), w: Math.min(s[1], 70), h: s[2] };
    const saving = cur - M.placeTariff(fixedP, r);
    if (saving > 0) {
      const what = s[0] > 120 ? `Довжина ${cm(s[0])} см — доплата за габарит. Скороти до 120 см` : `Друга сторона ${cm(s[1])} см — доплата за габарит. Зменш до 70 см`;
      gains.push({ kind: 'money', saving, text: `${what}.` });
    }
  }

  // А2. Дешевший тариф, якщо зменшити об'єм.
  const t = M.tierIndex(p);
  if (t === 1 || t === 2) {
    const lower = t - 1;
    if (vol > w && w <= M.TIER_KG[lower]) {
      const sh = shrinkTo(p, M.TIER_KG[lower] * M.DIVISOR);
      const newTariff = r.tiers[lower] + (M.isOversize(p) ? r.oversize : 0);
      const saving = cur - newTariff;
      if (sh && saving > 0) {
        if (sh.ratio <= 0.3) {
          gains.push({
            kind: 'money',
            saving,
            text: `Якщо сторону ${cm(sh.from)} см зменшити до ${cm(sh.to)} см, місце коштуватиме ${money0(newTariff)} грн замість ${money0(cur)}.`,
          });
        } else if (SOFT.test(p.name || '')) {
          gains.push({
            kind: 'money',
            saving,
            text: `Стисни речі у вакуумні пакети. Якщо влізуть у коробку до ${VACUUM_BOX[lower]}, буде ${money0(newTariff)} грн замість ${money0(cur)}.`,
          });
        } else if (s[2] <= 15) {
          const thick = Math.floor((M.TIER_KG[lower] * M.DIVISOR) / (s[0] * s[1]));
          out.push({ kind: 'info', text: `Тонший пакунок не здешевшає: нижчий тариф почнеться лише з товщини ${cm(thick)} см.` });
        }
      }
    }
  }

  gains.sort((a, b) => b.saving - a.saving);
  out.push(...gains);

  // А5 («вага впритул до межі») прибрано рішенням 19.11: до межі тарифу місце коштує
  // однаково, а попередження на 29–30 кг заважало. Запас лишився лише в А1 (reserveKg),
  // щоб сайт сам не радив набивати коробку до самої межі.

  // Інформаційні.
  if (!w) {
    out.push({ kind: 'need', text: 'Впиши вагу — поки рахуємо за об’ємом. Якщо є ваги, просто зваж коробку.' });
  } else if (p.approx) {
    out.push({ kind: 'info', text: 'Вага орієнтовна. Якщо є ваги, зваж коробку — ціна буде точнішою.' });
  }
  const free = freeKg(p);
  if (w && vol > w + 0.5 && free >= 3 && !APPLIANCE.test(p.name || '')) {
    const text = cap && cap < upperKg(t)
      ? `Можна докласти ще ${kg(free)} кг — більше коробка не витримає (вона до ${cap} кг). Сюди варто важке: книги, посуд.`
      : cap
        ? `Можна докласти ще до ${kg(free)} кг без доплати — сюди варто важке: книги, посуд.`
        : `Можна докласти ще до ${kg(free)} кг без доплати, якщо коробка витримає. Сюди варто важке: книги, посуд.`;
    out.push({ kind: 'info', text });
  }
  return out;
}

function money0(x) {
  return money(x);
}

const RANK = { error: 0, money: 1, warn: 2, need: 3, info: 4 };

/** Що показати під місцем: одна «дієва» підказка і одна інформаційна. */
export function pickForCard(list) {
  const sorted = [...list].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  const act = sorted.find((h) => RANK[h.kind] <= 2);
  const info = sorted.find((h) => RANK[h.kind] >= 3);
  return [act, info].filter(Boolean);
}

/**
 * Підказки для всієї відправки.
 * totals: { one, separate } — суми, які бачить людина (з API, якщо є).
 */
export function shipmentHints(valid, opts, r, totals) {
  const out = [];
  if (!valid.length) return out;
  const doorOn = opts.pickup || opts.delivery;
  const bothDoors = opts.pickup && opts.delivery;
  const one = M.shipmentCost(valid, opts, r);
  const anyHeavyPlace = valid.some((p) => M.paidKg(p) > 30);

  // Б3. Одна накладна чи кожне місце окремо.
  if (valid.length > 1) {
    const cur = opts.mode === 'separate' ? 'separate' : 'one';
    const other = cur === 'one' ? 'separate' : 'one';
    const diff = M.round2(totals[cur] - totals[other]);
    if (diff >= 1) {
      if (other === 'separate') {
        let sub = 'Кожна накладна платить свою доплату за адресу, але разом виходить дешевше.';
        if (doorOn && !anyHeavyPlace) {
          sub = 'Для накладних до 30 кг «До дверей» безкоштовне. А якщо ліфт не працюватиме, такі накладні заносять до 5-го поверху. Важчі — лише з 1-го.';
        }
        out.push({ id: 'mode', kind: 'mode', to: 'separate', mentionsLift: sub.includes('ліфт'), saving: diff, text: `Оформи кожне місце окремою накладною: ${money(totals.separate)} грн замість ${money(totals.one)}.`, sub, action: 'Оформити окремо' });
      } else {
        out.push({ id: 'mode', kind: 'mode', to: 'one', saving: diff, text: `Оформи все однією накладною: ${money(totals.one)} грн замість ${money(totals.separate)}.`, sub: 'Доплата за адресу береться з усієї накладної, а не з кожного місця.', action: 'Однією накладною' });
      }
    }
  }

  // Б2. Накладна трохи перевалила за межу блоку 100 кг.
  if ((opts.mode || 'one') === 'one' && one.blocks >= 2) {
    const over = one.W - (one.blocks - 1) * 100;
    if (over <= 10) {
      const excess = ceil1(over);
      const saving = r.addrBlock + r.doorBlock * ((opts.pickup ? 1 : 0) + (opts.delivery ? 1 : 0));
      const byVol = one.drivenBy === 'vol';
      const doors = opts.pickup || opts.delivery;
      out.push({
        kind: 'money',
        saving,
        text: `Накладна важить ${kg(one.W)} кг${byVol ? ' за об’ємом' : ''} — лише на ${kg(excess)} кг більше за межу ${(one.blocks - 1) * 100} кг. Якщо скинути ці ${kg(excess)} кг${byVol ? ' (менша коробка чи вакуумні пакети)' : ''}, доплата за адресу${doors ? ' і «До дверей»' : ''} впаде на ${money(saving)} грн.`,
      });
    }
  }

  // Б1. Змішати важке з легким («книги на дно»).
  const mid = valid.filter((p) => !M.isCargo(p) && M.tierIndex(p) === 2);
  const dense = mid.filter((p) => M.weightKg(p) > M.volumeKg(p) + 1);
  if (dense.length && mid.length >= 2) {
    const need = Math.ceil(Math.max(mid.reduce((s, p) => s + M.weightKg(p), 0), mid.reduce((s, p) => s + M.volumeKg(p), 0)) / 27);
    if (need < mid.length) {
      const saving = (mid.length - need) * r.tiers[2];
      out.push({
        kind: 'money',
        saving,
        text: `Змішай важке з легким: книги на дно коробок з одягом. Якщо влізе, вистачить ${need} місць замість ${mid.length}.`,
      });
    }
  }

  // Б4, Б5. Ліфт і «До дверей» для накладних понад 30 кг.
  const heavyEN = (opts.mode || 'one') === 'one' ? one.blocks > 0 : anyHeavyPlace;
  if (heavyEN && doorOn) {
    out.push({ id: 'lift', kind: 'warn', text: 'Якщо ліфт не працюватиме, накладну понад 30 кг заберуть і занесуть лише з 1-го поверху.' });
  }
  if (heavyEN && !bothDoors) {
    out.push({ id: 'nodoor', kind: 'warn', text: 'Без послуги «До дверей» накладну понад 30 кг кур’єр віддає біля машини, а не в квартирі.' });
  }
  if (valid.length > M.LIMITS.seats) {
    out.push({ kind: 'error', text: 'В одній накладній до 500 місць.' });
  }
  return out;
}

/** Головна порада: найбільша економія серед усіх підказок. */
export function mainTip(shipment, perPlace, label) {
  let best = null;
  for (const h of shipment) if (h.saving > 0 && (!best || h.saving > best.saving)) best = h;
  for (const [id, list] of perPlace) {
    for (const h of list) {
      if (h.kind === 'money' && (!best || h.saving > best.saving)) best = { ...h, placeId: id, text: `Місце ${label(id)}: ${h.text}` };
    }
  }
  return best;
}

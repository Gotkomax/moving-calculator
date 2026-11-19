// Тарифна модель Нової Пошти для відправки адреса → адреса.
// Правила виміряно запитами до getDocumentPrice 23.10, 11.11, 13.11 і 16.11.2026.
// Модель потрібна, щоб рахувати миттєво, офлайн і для підказок.
// Остаточну суму сторінка звіряє з API НП.

export const DIVISOR = 4000; // об'ємна вага = Д×Ш×В / 4000
export const TIER_KG = [2, 10, 30]; // межі тарифів місця за платною вагою
const EPS = 1e-9;

// Ставки між містами. Для конкретного маршруту їх уточнює калібрування (np.js).
export const DEFAULT_RATES = Object.freeze({
  tiers: [90, 135, 200], // місце до 2 / 10 / 30 кг платної ваги
  cargoPerKg: 13, // місце понад 30 кг: за кожен почато кілограм
  village: 0, // доплата на накладну з місцями до 30 кг (село з іншого міста: 30)
  addrSmall: 120, // адреса: накладна до 30 кг
  addrBlock: 400, // адреса: накладна понад 30 кг, за кожні почато 100 кг
  doorBlock: 200, // «До дверей»: накладна понад 30 кг, за кожні почато 100 кг з кожного боку
  oversize: 100, // місце до 30 кг: найдовша сторона > 120 або друга > 70 см
  oversizeCargo: 150, // вантаж із тим самим габаритом (один замір, орієнтовно)
  insParcel: 0.005, // страховка місця до 30 кг
  insCargo: 0.0075, // страховка вантажу
  insFreeUpTo: 500, // оцінка місця до 500 грн — без страховки
});

export const LIMITS = Object.freeze({ placeKg: 1100, dims: [300, 170, 170], doorPlaceKg: 100, seats: 500 });
export const DEFAULT_DECLARED = 500;

export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const round2 = (x) => Math.round((x + 1e-7) * 100) / 100;

/** Сторони від найбільшої до найменшої. API НП перевіряє довжину на 120, а ширину й висоту на 70, тому порядок важливий. */
export function sides(p) {
  return [num(p.l), num(p.w), num(p.h)].sort((a, b) => b - a);
}
export const hasDims = (p) => sides(p)[2] > 0;
export const weightKg = (p) => num(p.kg);
export function volumeKg(p) {
  const [a, b, c] = sides(p);
  return (a * b * c) / DIVISOR;
}
export const paidKg = (p) => Math.max(weightKg(p), volumeKg(p));
export const isCargo = (p) => paidKg(p) > TIER_KG[2] + EPS;
export function tierIndex(p) {
  const w = paidKg(p);
  if (w <= TIER_KG[0] + EPS) return 0;
  if (w <= TIER_KG[1] + EPS) return 1;
  if (w <= TIER_KG[2] + EPS) return 2;
  return 3;
}
export function isOversize(p) {
  const [a, b] = sides(p);
  return a > 120 + EPS || b > 70 + EPS;
}
export const declared = (p) => num(p.cost) || DEFAULT_DECLARED;

/** Тариф одного місця без страховки й доплат накладної. */
export function placeTariff(p, r = DEFAULT_RATES) {
  const t = tierIndex(p);
  if (t === 3) return r.cargoPerKg * Math.ceil(paidKg(p) - EPS) + (isOversize(p) ? r.oversizeCargo : 0);
  return r.tiers[t] + (isOversize(p) ? r.oversize : 0);
}

/**
 * Вартість однієї накладної.
 * НП ділить оголошену вартість накладної порівну між місцями, і поріг страховки 500 грн діє на кожне місце.
 * Доплати за адресу й «До дверей» рахуються від max(Σфакт, Σоб'єм) усієї накладної.
 */
export function shipmentCost(places, opts = {}, r = DEFAULT_RATES) {
  const { address = true, pickup = false, delivery = false } = opts;
  const n = places.length;
  const out = { n, tariff: 0, insurance: 0, address: 0, village: 0, door: 0, total: 0, factKg: 0, volKg: 0, W: 0, blocks: 0 };
  if (!n) return out;
  const per = places.reduce((s, p) => s + declared(p), 0) / n;
  for (const p of places) {
    out.tariff += placeTariff(p, r);
    // НП округлює страховку кожного місця до копійок окремо (8000 на 6 місць = 6 × 6,67 = 40,02).
    if (per > r.insFreeUpTo + EPS) out.insurance += round2((isCargo(p) ? r.insCargo : r.insParcel) * per);
    out.factKg += weightKg(p);
    out.volKg += volumeKg(p);
  }
  out.W = Math.max(out.factKg, out.volKg);
  out.blocks = out.W <= TIER_KG[2] + EPS ? 0 : Math.ceil(out.W / 100 - EPS);
  if (address) {
    out.address = out.blocks === 0 ? r.addrSmall : r.addrBlock * out.blocks;
    out.door = out.blocks === 0 ? 0 : r.doorBlock * out.blocks * ((pickup ? 1 : 0) + (delivery ? 1 : 0));
  }
  out.village = places.some((p) => !isCargo(p)) ? r.village : 0;
  out.insurance = round2(out.insurance);
  out.total = round2(out.tariff + out.insurance + out.address + out.village + out.door);
  out.drivenBy = out.volKg >= out.factKg ? 'vol' : 'fact';
  return out;
}

/** Обидва способи оформлення: однією накладною і кожне місце окремо. */
export function quote(places, opts = {}, r = DEFAULT_RATES) {
  const one = shipmentCost(places, opts, r);
  const separate = { n: places.length, tariff: 0, insurance: 0, address: 0, village: 0, door: 0, total: 0, factKg: 0, volKg: 0, heavy: 0 };
  for (const p of places) {
    const c = shipmentCost([p], opts, r);
    for (const k of ['tariff', 'insurance', 'address', 'village', 'door', 'factKg', 'volKg']) separate[k] += c[k];
    if (c.blocks > 0) separate.heavy += 1;
  }
  separate.insurance = round2(separate.insurance);
  separate.total = round2(separate.tariff + separate.insurance + separate.address + separate.village + separate.door);
  return { one, separate };
}

/** Ставки маршруту з відповідей пробних запитів (див. np.js, calibrate). */
export function ratesFromProbes(pr, base = DEFAULT_RATES) {
  const t1 = pr.ww5x2 - pr.ww5;
  const village = pr.ww5 - t1;
  const r = {
    ...base,
    tiers: [pr.ww2 - village, t1, pr.ww20 - village],
    village,
    cargoPerKg: pr.ww40 / 40,
    addrSmall: pr.dd5 - pr.ww5,
    addrBlock: pr.dd40 - pr.ww40,
    doorBlock: (pr.dd40both - pr.dd40) / 2,
  };
  const ok =
    r.tiers.every((x) => x > 0) &&
    r.tiers[0] <= r.tiers[1] &&
    r.tiers[1] <= r.tiers[2] &&
    village >= 0 &&
    r.cargoPerKg > 0 &&
    r.addrSmall >= 0 &&
    r.addrBlock >= 0 &&
    r.doorBlock >= 0;
  return ok ? r : null;
}

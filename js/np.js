// Запити до відкритого API Нової Пошти. Ключ не потрібен: пошук населених пунктів
// і getDocumentPrice відповідають і з порожнім apiKey, а CORS дозволяє запити з браузера.
import * as M from './model.js';

const URL = 'https://api.novaposhta.ua/v2.0/json/';
const CACHE_KEY = 'moving-calculator:rates:v1';
const RATES_TTL_MS = 24 * 60 * 60 * 1000;

async function call(modelName, calledMethod, methodProperties, signal) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: '', modelName, calledMethod, methodProperties }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!j.success) throw new Error((j.errors || []).join('; ') || 'Нова Пошта повернула помилку');
  return j.data || [];
}

/** Населені пункти з адресною доставкою. ref — DeliveryCity, його й чекає getDocumentPrice. */
export async function searchCities(query, signal) {
  const data = await call('Address', 'searchSettlements', { CityName: query, Limit: '8', Page: '1' }, signal);
  const list = (data[0] && data[0].Addresses) || [];
  return list
    .filter((a) => a.AddressDeliveryAllowed !== false && a.DeliveryCity)
    .map((a) => ({ name: a.MainDescription, present: a.Present, ref: a.DeliveryCity, type: a.SettlementTypeCode }));
}

/** Ціна однієї накладної. seats: місця з l, w, h, kg, cost. */
export async function priceShipment(route, seats, opts = {}, signal) {
  const { service = 'DoorsDoors', pickup = false, delivery = false } = opts;
  const props = {
    CitySender: route.from,
    CityRecipient: route.to,
    Weight: String(Math.max(0.1, seats.reduce((s, p) => s + M.weightKg(p), 0))),
    ServiceType: service,
    Cost: String(seats.reduce((s, p) => s + M.declared(p), 0)),
    CargoType: 'Cargo',
    SeatsAmount: String(seats.length),
    OptionsSeat: seats.map((p) => {
      const [a, b, c] = M.sides(p);
      return { weight: String(Math.max(0.1, M.weightKg(p))), volumetricLength: String(a), volumetricWidth: String(b), volumetricHeight: String(c) };
    }),
  };
  if (service === 'DoorsDoors' && (pickup || delivery)) {
    props.Elevator = '1';
    if (pickup) props.NumberOfFloorsDescent = '3';
    if (delivery) props.NumberOfFloorsLifting = '3';
  }
  const data = await call('InternetDocument', 'getDocumentPrice', props, signal);
  const cost = data[0] && Number(data[0].Cost);
  if (!Number.isFinite(cost)) throw new Error('Немає ціни у відповіді НП');
  return cost;
}

const box = (kg, l, w, h) => ({ kg, l, w, h, cost: 500 });

/** Ставки маршруту з восьми пробних запитів. Кешуємо на добу. */
export async function calibrate(route, signal) {
  const key = `${route.from}|${route.to}`;
  const cache = readCache();
  const hit = cache[key];
  if (hit && Date.now() - hit.at < RATES_TTL_MS) return hit.rates;

  const ww = { service: 'WarehouseWarehouse' };
  const dd = { service: 'DoorsDoors' };
  const both = { service: 'DoorsDoors', pickup: true, delivery: true };
  const probes = {
    ww2: [[box(1.9, 10, 10, 10)], ww],
    ww5: [[box(5, 20, 20, 20)], ww],
    ww5x2: [[box(5, 20, 20, 20), box(5, 20, 20, 20)], ww],
    ww20: [[box(20, 40, 40, 40)], ww],
    ww40: [[box(40, 40, 40, 40)], ww],
    dd5: [[box(5, 20, 20, 20)], dd],
    dd40: [[box(40, 40, 40, 40)], dd],
    dd40both: [[box(40, 40, 40, 40)], both],
  };
  const entries = Object.entries(probes);
  const values = await Promise.all(entries.map(([, [seats, o]]) => priceShipment(route, seats, o, signal)));
  const pr = Object.fromEntries(entries.map(([k], i) => [k, values[i]]));
  const rates = M.ratesFromProbes(pr);
  if (!rates) throw new Error('Не вдалося вивести ставки маршруту');
  cache[key] = { at: Date.now(), rates };
  writeCache(cache);
  return rates;
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function writeCache(c) {
  try {
    const keys = Object.keys(c);
    if (keys.length > 30) for (const k of keys.slice(0, keys.length - 30)) delete c[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* приватний режим чи заблоковане сховище — працюємо без кешу */
  }
}

/** Звірка обох способів оформлення з API. Однакові місця для «окремо» питаємо один раз. */
export async function verify(route, places, opts, signal) {
  const o = { service: 'DoorsDoors', pickup: opts.pickup, delivery: opts.delivery };
  const sig = (p) => [M.sides(p).join('x'), M.weightKg(p), M.declared(p)].join('|');
  const unique = new Map();
  for (const p of places) {
    const k = sig(p);
    unique.set(k, { p, count: (unique.get(k)?.count || 0) + 1 });
  }
  const groups = [...unique.values()];
  const tasks = [() => priceShipment(route, places, o, signal), ...groups.map((u) => () => priceShipment(route, [u.p], o, signal))];
  const [one, ...parts] = await pool(tasks, 6);
  const separate = groups.reduce((s, u, i) => s + parts[i] * u.count, 0);
  return { one: M.round2(one), separate: M.round2(separate) };
}

/** Не більше `limit` запитів одночасно, щоб не навантажувати API. */
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

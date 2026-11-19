// Стан сторінки: збереження в браузері і посилання «поділитися».
import { num } from './model.js';

const STORE_KEY = 'moving-calculator:state:v1';

let seq = 0;
export const newId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

export const KYIV = { name: 'Київ', present: 'м. Київ, Київська обл.', ref: '8d5a980d-391c-11dd-90d9-001a92567626' };
export const LVIV = { name: 'Львів', present: 'м. Львів, Львівська обл.', ref: 'db5c88f5-391c-11dd-90d9-001a92567626' };

const place = (name, l, w, h, kg, cost, extra = {}) => ({ id: newId(), name, l, w, h, kg, cost, buy: false, approx: false, ...extra });

/** Приклад переїзду Київ → Львів, суми звірено з API НП 19.11.2026: 2830 / 1950 / 2030. */
export function examplePlaces() {
  return [
    place('Одяг і рушники', 70, 40, 42, 12, 1000),
    place('Одяг і рушники', 70, 40, 42, 12, 1000),
    place('Ковдри й подушки', 70, 40, 42, 8, 1000),
    place('Книги на дно, одяг зверху', 70, 40, 42, 22, 1000),
    place('Посуд у папері', 47, 40, 42, 14, 1000),
    place('Мікрохвильовка', 55, 40, 35, 12, 1000),
  ];
}

export function defaultState() {
  return {
    v: 1,
    from: { ...KYIV },
    to: { ...LVIV },
    pickup: true,
    delivery: true,
    mode: 'one',
    boxPrice: 80,
    places: examplePlaces(),
    isExample: true,
  };
}

export function emptyPlace(extra = {}) {
  return { id: newId(), name: '', l: '', w: '', h: '', kg: '', cost: '', buy: false, approx: false, ...extra };
}

export function load() {
  const shared = readHash();
  if (shared) return { state: shared, fromLink: true };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 1 && Array.isArray(s.places)) {
        s.places.forEach((p) => (p.id = p.id || newId()));
        return { state: { ...defaultState(), ...s }, fromLink: false };
      }
    }
  } catch {
    /* немає сховища — стартуємо з прикладу */
  }
  return { state: defaultState(), fromLink: false };
}

export function save(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* приватний режим — нічого страшного */
  }
}

// ---- посилання: речі, міста й налаштування; адрес і імен у ньому немає ----

function toB64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShare(state) {
  const compact = {
    f: [state.from.name, state.from.ref, state.from.present || ''],
    t: [state.to.name, state.to.ref, state.to.present || ''],
    o: [state.pickup ? 1 : 0, state.delivery ? 1 : 0, state.mode === 'separate' ? 1 : 0, num(state.boxPrice)],
    p: state.places.map((p) => [p.name || '', p.l, p.w, p.h, p.kg, p.cost, p.buy ? 1 : 0, p.approx ? 1 : 0]),
  };
  return toB64Url(JSON.stringify(compact));
}

// Посилання приходить ззовні. Кожне унікальне місце — окремий запит звірки до API НП,
// тому з посилання беремо не більше 100 місць і обрізаємо назви.
export const SHARE_MAX_PLACES = 100;
const SHARE_MAX_NAME = 80;

export function decodeShare(s) {
  const c = JSON.parse(fromB64Url(s));
  const city = (a) => ({ name: String(a[0] || ''), ref: String(a[1] || ''), present: String(a[2] || '') });
  return {
    ...defaultState(),
    from: city(c.f),
    to: city(c.t),
    pickup: !!c.o[0],
    delivery: !!c.o[1],
    mode: c.o[2] ? 'separate' : 'one',
    boxPrice: Number(c.o[3]) || 0,
    places: (c.p || []).slice(0, SHARE_MAX_PLACES).map((a) => ({
      id: newId(),
      name: String(a[0] || '').slice(0, SHARE_MAX_NAME),
      l: a[1] ?? '',
      w: a[2] ?? '',
      h: a[3] ?? '',
      kg: a[4] ?? '',
      cost: a[5] ?? '',
      buy: !!a[6],
      approx: !!a[7],
    })),
    isExample: false,
  };
}

function readHash() {
  const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(location.hash || '');
  if (!m) return null;
  try {
    return decodeShare(m[1]);
  } catch {
    return null;
  }
}

export function shareUrl(state) {
  const base = location.href.split('#')[0];
  return `${base}#s=${encodeShare(state)}`;
}

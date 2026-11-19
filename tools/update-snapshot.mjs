// Оновлює js/snapshot.js: ставки маршруту й суми прикладу зі сторінки, звірені з API НП.
// Завдяки знімку перше відкриття сторінки не робить запитів до API.
//
// Запуск з кореня репо (Node 20+):  node tools/update-snapshot.mjs
// Раз на добу його запускає GitHub Action (.github/workflows/snapshot.yml).
// Файл переписується, якщо НП змінила ціни або знімку понад 7 днів.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import current from '../js/snapshot.js';
import { buildSnapshot } from '../js/np.js';
import { defaultState } from '../js/state.js';

const HEARTBEAT_MS = 7 * 24 * 60 * 60 * 1000;
const TARGET = fileURLToPath(new URL('../js/snapshot.js', import.meta.url));

const fresh = await buildSnapshot(defaultState());
if (!(fresh.totals.one > 0 && fresh.totals.separate > 0)) throw new Error(`Дивні суми від НП: ${JSON.stringify(fresh.totals)}`);

const body = (s) => JSON.stringify([s.route, s.rates, s.key, s.totals, s.prices]);
const changed = body(current) !== body(fresh);
const age = Date.now() - Date.parse(current.checkedAt);
const stale = !(age < HEARTBEAT_MS);

if (!changed && !stale) {
  console.log(`Без змін: ${fresh.totals.one} / ${fresh.totals.separate} грн, знімок від ${current.checkedAt}`);
} else {
  const snapshot = { checkedAt: new Date().toISOString(), ...fresh };
  const text = [
    '// Знімок прикладу зі сторінки: ставки маршруту й суми, звірені з API Нової Пошти.',
    '// Файл пише tools/update-snapshot.mjs (GitHub Action раз на добу). Руками не правити.',
    `export default ${JSON.stringify(snapshot, null, 2)};`,
    '',
  ].join('\n');
  await writeFile(TARGET, text, 'utf8');
  console.log(changed ? `Ціни змінилися: ${JSON.stringify(current.totals)} → ${JSON.stringify(fresh.totals)}` : 'Ціни ті самі, оновлено дату звірки');
}

// Заменяет серверный API на GitHub Pages: данные лежат в JSON, фильтры считаются в браузере.
import { turnkeyFor } from './turnkey.js';
import { buildOffers, offerDetail, generationOf, OFFER_SORT } from './offers.js';

const j = async p => { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
let metaP, changesP; const chunks = new Map();
const meta = () => (metaP ||= j('data/meta.json'));
function load(country) {
  if (!chunks.has(country)) chunks.set(country, j(`data/cars-${country}.json`).then(d => d.rows.map(row => { const o = Object.fromEntries(d.fields.map((k, i) => [k, row[i]])); if (d.breakdown[o.id]) o.breakdown = d.breakdown[o.id]; return o; })));
  return chunks.get(country);
}
const cars = async country => { const m = await meta(); const list = country ? [country] : Object.keys(m.counts); return (await Promise.all(list.filter(c => m.counts[c]).map(load))).flat(); };
const num = v => (v !== null && v !== '' && Number.isFinite(+v) ? +v : null);
function matcher(q, skip = []) {
  const eq = ['source', 'brand', 'model', 'fuel'].filter(k => !skip.includes(k) && q.get(k)).map(k => [k, q.get(k)]);
  const [pMin, pMax, yMin, yMax, km, ccMin, ccMax] = ['priceMin', 'priceMax', 'yearMin', 'yearMax', 'kmMax', 'ccMin', 'ccMax'].map(k => num(q.get(k)));
  const cond = q.get('cond'), ins = q.get('ins'), words = (q.get('q') || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  const nn = (v, f) => v != null && f(v);
  return c => eq.every(([k, v]) => c[k] === v) && (pMin == null || c.rub >= pMin) && (pMax == null || c.rub <= pMax) && (yMin == null || nn(c.year, v => v >= yMin)) && (yMax == null || nn(c.year, v => v <= yMax))
    && (km == null || nn(c.mileage, v => v <= km)) && (ccMin == null || nn(c.volume_cc, v => v >= ccMin)) && (ccMax == null || nn(c.volume_cc, v => v <= ccMax))
    && (cond !== 'new' || (c.mileage ?? 0) <= 1000) && (cond !== 'used' || nn(c.mileage, v => v > 1000)) && (ins !== 'clean' || c.insurance === 0) && (ins !== 'dirty' || c.insurance > 0)
    && words.every(w => `${c.title} ${c.brand || ''} ${c.model || ''}`.toLowerCase().includes(w));
}
const nullsLast = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b);
const SORT = { cheap: (a, b) => a.rub - b.rub, dear: (a, b) => b.rub - a.rub, year: (a, b) => nullsLast(b.year == null ? null : -b.year, a.year == null ? null : -a.year) || a.rub - b.rub, km: (a, b) => nullsLast(a.mileage, b.mileage) };
const facet = (list, k) => { const m = new Map(); for (const c of list) if (c[k] != null) m.set(c[k], (m.get(c[k]) || 0) + 1); return [...m].map(([v, n]) => ({ v, n })).sort((a, b) => String(a.v).localeCompare(String(b.v))); };

async function withBreakdown(c) {
  if (!c.turnkey || c.breakdown || c.country === 'kg') return c;
  const m = await meta(), company = { USD: m.rates.USD.perUnit, CNY: m.rates.CNY.perUnit, JPY: m.rates.JPY.perUnit, KRW: m.rates.KRW.perUnit };
  const cbr = Object.fromEntries(Object.entries(m.rates).map(([k, v]) => [k, v.cbr])), x = turnkeyFor(c, { company, cbr }, new Date(m.builtAt));
  if (x.breakdown) c.breakdown = JSON.stringify(x.breakdown);
  return c;
}

const genFilter = (list, gen) => (gen ? list.filter(c => generationOf(c).key === gen) : list);

export async function staticApi(path) {
  const u = new URL(path, 'https://x.local'), q = u.searchParams, p = u.pathname;
  if (p === '/api/meta') return meta();
  if (p === '/api/offers') {
    const size = [50, 100, 200].includes(+q.get('size')) ? +q.get('size') : 50, page = Math.max(1, +q.get('page') || 1), rows = genFilter((await cars(q.get('country'))).filter(matcher(q)), q.get('gen'));
    const list = buildOffers(rows).sort(OFFER_SORT[q.get('sort')] || OFFER_SORT.new);
    return { total: list.length, cars: rows.length, page, size, items: list.slice((page - 1) * size, page * size) };
  }
  if (p === '/api/offer') {
    const key = q.get('key') || '', [country, brand, model] = key.split('|'), s = new URLSearchParams(q); s.delete('key'); s.set('brand', brand); s.set('model', model);
    const rows = (await cars(country)).filter(matcher(s)), d = offerDetail(rows, key);
    if (d) for (const t of d.trims) await Promise.all(t.cars.map(withBreakdown));
    return d;
  }
  if (p === '/api/listings') {
    const size = [50, 100, 200].includes(+q.get('size')) ? +q.get('size') : 50, page = Math.max(1, +q.get('page') || 1), test = matcher(q);
    const list = (await cars(q.get('country'))).filter(test), sort = SORT[q.get('sort')];
    if (sort) list.sort(sort);
    const items = await Promise.all(list.slice((page - 1) * size, page * size).map(withBreakdown));
    return { total: list.length, page, size, items };
  }
  if (p === '/api/facets') {
    const all = await cars(q.get('country')), base = all.filter(matcher(q, ['brand', 'model']));
    let gens = [];
    if (q.get('brand') && q.get('model')) { const m = new Map(); for (const c of base) if (c.brand === q.get('brand') && c.model === q.get('model')) { const g = generationOf(c); if (g.key) m.set(g.key, { v: g.key, label: g.label, n: (m.get(g.key)?.n || 0) + 1 }); } gens = [...m.values()].sort((a, b) => b.n - a.n); }
    return { brands: facet(base, 'brand'), models: q.get('brand') ? facet(base.filter(c => c.brand === q.get('brand')), 'model') : [], gens };
  }
  if (p === '/api/changes') {
    const all = await (changesP ||= j('data/changes.json')), type = q.get('type'), list = type ? all.filter(c => c.type === type) : all, size = 50, page = Math.max(1, +q.get('page') || 1);
    return { total: list.length, page, size, items: list.slice((page - 1) * size, page * size) };
  }
  throw new Error('not found');
}

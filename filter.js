// Фильтры каталога. Один модуль для сервера, версии на GitHub и тестов.
import { generationOf } from './offers.js';

export const GEAR_OPTIONS = [{ value: 'auto', label: 'Автомат' }, { value: 'at', label: 'АКПП', sub: true }, { value: 'robot', label: 'Робот', sub: true }, { value: 'cvt', label: 'Вариатор', sub: true }, { value: 'mt', label: 'Механика' }];
export const DRIVE_OPTIONS = [{ value: 'full', label: '4WD' }, { value: 'front', label: 'Передний' }, { value: 'rear', label: 'Задний' }];
export const STEER_OPTIONS = [{ value: 'left', label: 'Левый' }, { value: 'right', label: 'Правый' }];
export const DAMAGE_OPTIONS = [{ value: 'clean', label: 'Без повреждений' }, { value: 'damaged', label: 'С повреждениями' }];
export const ORIGIN_OPTIONS = [{ value: 'jp', label: 'Япония' }, { value: 'cn', label: 'Китай' }, { value: 'kr', label: 'Корея' }];
export const VOLUMES = [0.7, 0.8, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.2, 2.4, 2.5, 2.7, 3, 3.3, 3.5, 4, 4.5, 5, 5.5, 6];
const DRIVE = { full: 'полный', front: 'передний', rear: 'задний' };

const num = v => (v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? +v : null);
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const nn = (v, f) => v != null && f(v);

// q — URLSearchParams. skip — какие условия не применять (для подсчёта вариантов в самих списках).
export function matcher(q, skip = []) {
  const get = k => (skip.includes(k) ? '' : q.get(k) || '');
  const eq = ['country', 'source', 'brand', 'model', 'fuel'].map(k => [k, get(k)]).filter(([, v]) => v);
  const [pMin, pMax, yMin, yMax, kMin, kMax, ccMin, ccMax] = ['priceMin', 'priceMax', 'yearMin', 'yearMax', 'kmMin', 'kmMax', 'ccMin', 'ccMax'].map(k => num(get(k)));
  const cond = get('cond'), gear = get('gear'), drive = DRIVE[get('drive')], steer = get('steer'), dmg = get('dmg'), gen = get('gen');
  const bodies = new Set(list(get('body'))), origins = new Set(list(get('origin')));
  const words = get('q').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  return c => eq.every(([k, v]) => c[k] === v)
    && (pMin == null || c.rub >= pMin) && (pMax == null || c.rub <= pMax)
    && (yMin == null || nn(c.year, v => v >= yMin)) && (yMax == null || nn(c.year, v => v <= yMax))
    && (kMin == null || nn(c.mileage, v => v >= kMin)) && (kMax == null || (c.mileage ?? 0) <= kMax)
    && (ccMin == null || nn(c.volume_cc, v => v >= ccMin)) && (ccMax == null || nn(c.volume_cc, v => v <= ccMax))
    && (cond !== 'new' || (c.mileage ?? 0) <= 1000) && (cond !== 'used' || nn(c.mileage, v => v > 1000))
    && (!gear || (gear === 'auto' ? ['at', 'robot', 'cvt'].includes(c.gear) : c.gear === gear))
    && (!drive || c.drive === drive) && (!steer || c.steer === steer)
    && (!dmg || (dmg === 'clean' ? c.damage === 0 : c.damage === 1))
    && (!bodies.size || bodies.has(c.body)) && (!origins.size || origins.has(c.origin))
    && (!gen || generationOf(c).key === gen)
    && words.every(w => `${c.title} ${c.brand || ''} ${c.model || ''}`.toLowerCase().includes(w));
}

const facet = (rows, k) => { const m = new Map(); for (const c of rows) if (c[k] != null) m.set(c[k], (m.get(c[k]) || 0) + 1); return [...m].map(([v, n]) => ({ v, n })).sort((a, b) => String(a.v).localeCompare(String(b.v))); };
const photoOf = c => c.photo_local || c.photo || null;

// Поколения как на Дроме: годы, кузова и фото машины этого поколения.
export function generations(rows) {
  const m = new Map();
  for (const c of rows) {
    const g = generationOf(c);
    if (!g.key) continue;
    let x = m.get(g.key);
    if (!x) m.set(g.key, x = { v: g.key, label: g.label, n: 0, yearMin: Infinity, yearMax: -Infinity, photo: null, rank: -1 });
    x.n++;
    if (c.year) { x.yearMin = Math.min(x.yearMin, c.year); x.yearMax = Math.max(x.yearMax, c.year); }
    const r = (photoOf(c) ? 2 : 0) + (c.photo_credit ? 0 : 1);
    if (r > x.rank) { x.rank = r; x.photo = photoOf(c); }
  }
  return [...m.values()].map(({ rank, ...x }) => {
    const codes = (x.label.match(/кузова? (.+)$/) || [])[1] || '', [, a, b] = String(x.v).match(/^(\d{4})-(\d{4})-/) || [];
    const from = +a || (Number.isFinite(x.yearMin) ? x.yearMin : null), to = +b || (Number.isFinite(x.yearMax) ? x.yearMax : null);
    return { ...x, years: from ? (from === to ? `${from}` : `${from} – ${to}`) : '', codes: codes || (/^Кузов /.test(x.label) ? x.label.slice(6) : x.label) };
  }).sort((a, b) => (b.yearMax || 0) - (a.yearMax || 0) || b.n - a.n);
}

export function facets(all, q) {
  const brandScope = all.filter(matcher(q, ['brand', 'model', 'gen']));
  const brands = facet(brandScope, 'brand');
  const models = q.get('brand') ? facet(brandScope.filter(c => c.brand === q.get('brand')), 'model') : [];
  const gens = q.get('brand') && q.get('model') ? generations(all.filter(matcher(q, ['gen']))) : [];
  return { brands, models, gens };
}

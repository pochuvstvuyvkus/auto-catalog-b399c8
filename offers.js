// Каталог по карточкам: модель → поколение → комплектация → варианты по пробегу, цвету и состоянию.
const WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
export const BANDS = [{ key: 'a', label: 'до 30 000 км', max: 30000 }, { key: 'b', label: '30–60 000 км', max: 60000 }, { key: 'c', label: 'от 60 000 км', max: Infinity }];
const FUEL = { petrol: 'бензин', diesel: 'дизель', hybrid: 'гибрид', series: 'гибрид', electric: 'электро', lpg: 'газ' };

export function generationOf(c) {
  if (c.gen_key) return { key: c.gen_key, label: c.gen_label };
  if (c.country === 'jp') return c.chassis ? { key: c.chassis.toUpperCase(), label: `Кузов ${c.chassis.toUpperCase()}` } : { key: '', label: '' };
  if (c.country === 'kr') {
    const t = `${c.title || ''} ${c.trim || ''}`, code = t.match(/\(([A-Z]{1,3}\d{1,3}[A-Z]?)\)/), ord = t.match(/\b(\d)(?:st|nd|rd|th)\b/i), word = t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\s+generation\b/i);
    if (code) return { key: code[1], label: `Кузов ${code[1]}` };
    const n = word ? WORDS[word[1].toLowerCase()] : ord ? +ord[1] : null;
    if (n) return { key: `G${n}`, label: `${n}-е поколение` };
  }
  return { key: '', label: '' };
}
function trimName(c) {
  const t = String(c.trim || '').replace(/\([A-Z]{1,3}\d{1,3}[A-Z]?\)/g, ' ').replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\s+generation\b/ig, ' ').replace(/\b\d(?:st|nd|rd|th)\b/ig, ' ').replace(/\s+/g, ' ').trim();
  return t || 'Базовая';
}
const engineName = c => [c.volume_cc ? `${(c.volume_cc / 1000).toFixed(1)} л` : null, c.hp ? `${c.hp} л.с.` : null, FUEL[c.fuel]].filter(Boolean).join(', ');
const hasNuance = c => c.insurance > 0;
export const offerKey = c => [c.country, c.brand, c.model, generationOf(c).key].join('|');

// Вилка: от самой низкой цены до самой высокой (24.11 Василина). Машины со страховыми случаями считаются отдельно.
function range(list) {
  const clean = list.filter(c => !hasNuance(c)), base = clean.length ? clean : list, tk = base.filter(c => c.turnkey), use = tk.length ? tk.map(c => c.turnkey) : base.map(c => c.rub);
  return { from: Math.min(...use), to: Math.max(...use), kind: tk.length ? 'turnkey' : 'site', priced: tk.length };
}
function nuance(list) {
  const n = list.filter(hasNuance);
  if (!n.length) return null;
  const v = n.map(c => c.turnkey || c.rub);
  return { count: n.length, from: Math.min(...v), to: Math.max(...v) };
}
const years = list => { const y = list.map(c => c.year).filter(Boolean); return y.length ? [Math.min(...y), Math.max(...y)] : [null, null]; };
const photoRank = c => (c.photo_local || c.photo ? 2 : 0) + (c.turnkey ? 1 : 0);
const bestPhoto = list => { let b = null; for (const c of list) if (!b || photoRank(c) > photoRank(b)) b = c; return b; };
const counted = (list, f) => { const m = new Map(); for (const c of list) { const v = f(c); if (v) m.set(v, (m.get(v) || 0) + 1); } return [...m].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n); };

export function buildOffers(cars) {
  const groups = new Map();
  for (const c of cars) { const k = offerKey(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  return [...groups].map(([key, list]) => {
    const f = list[0], g = generationOf(f), p = bestPhoto(list), [yearMin, yearMax] = years(list), trims = new Set(list.map(c => `${trimName(c)}|${c.volume_cc}|${c.hp}`));
    return { key, country: f.country, brand: f.brand, model: f.model, gen: g.key, genLabel: g.label, yearMin, yearMax, photo: p?.photo_local || p?.photo || null, modelPhoto: !!p?.photo_credit, count: list.length, trimCount: trims.size, nuanceCount: list.filter(hasNuance).length, minKm: Math.min(...list.map(c => c.mileage ?? Infinity)), newest: list.reduce((a, c) => (c.first_seen > a ? c.first_seen : a), ''), ...range(list) };
  });
}
export const OFFER_SORT = { new: (a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : b.count - a.count), cheap: (a, b) => a.from - b.from, dear: (a, b) => b.to - a.to, year: (a, b) => (b.yearMax || 0) - (a.yearMax || 0) || a.from - b.from, km: (a, b) => a.minKm - b.minKm };

export function offerDetail(cars, key) {
  const list = cars.filter(c => offerKey(c) === key);
  if (!list.length) return null;
  const f = list[0], g = generationOf(f), groups = new Map();
  for (const c of list) { const k = `${trimName(c)}|${c.volume_cc}|${c.hp}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const trims = [...groups].map(([k, t]) => {
    const [yearMin, yearMax] = years(t);
    return { key: k, name: trimName(t[0]), engine: engineName(t[0]), count: t.length, yearMin, yearMax, ...range(t), nuance: nuance(t), colors: counted(t, c => c.color), bands: BANDS.map((b, i) => { const m = t.filter(c => c.mileage != null && c.mileage <= b.max && (i === 0 || c.mileage > BANDS[i - 1].max)); return m.length ? { key: b.key, label: b.label, count: m.length, ...range(m) } : null; }).filter(Boolean), cars: [...t].sort((a, b) => (a.turnkey || a.rub) - (b.turnkey || b.rub)) };
  }).sort((a, b) => a.from - b.from);
  const [yearMin, yearMax] = years(list);
  return { key, country: f.country, brand: f.brand, model: f.model, gen: g.key, genLabel: g.label, yearMin, yearMax, count: list.length, ...range(list), trims };
}
export const bandOf = km => (km == null ? null : BANDS.find(b => km <= b.max).key);

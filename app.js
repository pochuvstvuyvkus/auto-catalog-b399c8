import { SCHEMES, PAY_MARKUPS, scheme, compute, defaultAbroad, commissionFor } from './calc.js';
import { customs, ageBand } from './customs.js';
import { isSanctioned, isMildHybrid, japanScheme } from './sanctions.js';
import { bandOf } from './offers.js';
import { staticApi as api } from './static-api.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view'), layer = $('#layer');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safe = u => (typeof u === 'string' && (u.startsWith('https://') || u.startsWith('photos/')) ? esc(u) : '');
const modelPhotoNote = c => (c.photo_credit ? '<span class="ph-note">Фото модели</span>' : '');
const SYM = { RUB: '₽', USD: '$', CNY: '¥', JPY: '¥', KRW: '₩', AED: 'AED', EUR: '€' };
const fmt = (n, d = 0) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toLocaleString('ru-RU', { maximumFractionDigits: d }));
const money = (n, c = 'RUB') => (n == null ? '—' : `${fmt(n)} ${SYM[c] || c}`);
const parseNum = v => { const s = String(v ?? '').replace(/\s/g, '').replace(',', '.'); return s === '' || !Number.isFinite(+s) ? null : +s; };
const FUEL = { petrol: 'Бензин', diesel: 'Дизель', hybrid: 'Гибрид', series: 'Послед. гибрид', electric: 'Электро', lpg: 'Газ' };

let meta = null;
const cache = new Map();
const filters = { mode: 'models', gen: '', country: '', cond: '', ins: '', brand: '', model: '', fuel: '', priceMin: '', priceMax: '', yearMin: '', yearMax: '', kmMax: '', volMin: '', volMax: '', ccMin: '', ccMax: '', q: '', sort: 'new', page: 1, size: 50 };
const calcState = { id: 'kr', price: null, rate: null, abroad: null, year: new Date().getFullYear() - 4, cc: 1600, hp: 150, fuel: 'petrol', body: 'car', customs: null, docs: null, commission: null, logistics: null, payMarkup: 'none', customsTouched: false, commissionTouched: false, title: '' };

/* Выпадающий список */
function openDropdown(btn, { options, value, search, onPick }) {
  closeDropdown();
  const r = btn.getBoundingClientRect();
  const back = document.createElement('div'); back.className = 'dd-back';
  const pop = document.createElement('div'); pop.className = 'dd-pop';
  pop.style.left = `${r.left}px`; pop.style.width = `${Math.max(r.width, 220)}px`;
  const below = innerHeight - r.bottom;
  if (below > 240 || below > r.top) { pop.style.top = `${r.bottom + 4}px`; pop.style.maxHeight = `${Math.min(340, below - 12)}px`; }
  else { pop.style.bottom = `${innerHeight - r.top + 4}px`; pop.style.maxHeight = `${Math.min(340, r.top - 12)}px`; }
  pop.innerHTML = `${search ? '<div class="dd-search"><input class="input" placeholder="Поиск" autocomplete="off"></div>' : ''}<div class="dd-list"></div>`;
  const list = $('.dd-list', pop);
  const draw = q => {
    const l = options.filter(o => !q || o.label.toLowerCase().includes(q));
    list.innerHTML = l.map(o => `<button type="button" class="dd-opt ${o.value === value ? 'on' : ''}" data-v="${esc(o.value)}"><span>${esc(o.label)}</span>${o.n != null ? `<small>${fmt(o.n)}</small>` : ''}</button>`).join('') || '<div class="dd-none">Ничего нет</div>';
  };
  draw('');
  list.addEventListener('click', e => { const b = e.target.closest('.dd-opt'); if (b) { closeDropdown(); onPick(b.dataset.v); } });
  back.addEventListener('click', closeDropdown);
  document.body.append(back, pop);
  if (search) { const i = $('input', pop); i.addEventListener('input', () => draw(i.value.trim().toLowerCase())); if (matchMedia('(hover:hover)').matches) i.focus(); }
  openDropdown.el = [back, pop];
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
}
function outside(e) { if (openDropdown.el && !openDropdown.el[1].contains(e.target)) closeDropdown(); }
function closeDropdown() { openDropdown.el?.forEach(x => x.remove()); openDropdown.el = null; document.removeEventListener('mousedown', outside); }
const ddHtml = (id, label, empty, disabled) => `<button type="button" class="dd-btn ${empty ? 'blank' : ''}" id="${id}" ${disabled ? 'disabled' : ''}><span>${esc(label)}</span><i></i></button>`;

/* Автомобили */
const qs = () => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null && !['volMin', 'volMax', 'mode'].includes(k)) u.set(k, v); return u.toString(); };
const SORT = [{ value: 'new', label: 'Сначала новые' }, { value: 'cheap', label: 'Сначала дешевле' }, { value: 'dear', label: 'Сначала дороже' }, { value: 'year', label: 'Год: новее' }, { value: 'km', label: 'Меньше пробег' }];
const FROM = { cn: 'из Китая', kr: 'из Кореи', jp: 'из Японии', ae: 'из Эмиратов', kg: 'из Киргизии' };
const ads = n => `${fmt(n)} ${word(n, 'объявление', 'объявления', 'объявлений')}`;
const heading = () => `Автомобили${filters.country ? ` ${FROM[filters.country]}` : ''}`;

function sideHtml() {
  const rates = [['USD', 1], ['CNY', 1], ['JPY', 100], ['KRW', 1000], ['AED', 1], ['EUR', 1]];
  const day = d => (!d ? '' : /^\d{2}\.\d{2}\.\d{4}$/.test(d) ? d.slice(0, 5) : new Date(d).toLocaleDateString('ru-RU').slice(0, 5));
  return `<aside class="side"><section class="box"><h3>Курсы</h3>${rates.map(([c, m]) => `<div class="kv-row"><span>${m > 1 ? `${m} ` : ''}${c}${c === 'EUR' ? ' ЦБ' : ''} <small>${day(meta.rates[c]?.date)}</small></span><b>${fmt((meta.rates[c]?.perUnit ?? 0) * m, 2)} ₽</b></div>`).join('')}</section>
  <section class="box"><h3>Источники</h3>${meta.sources.map(s => `<div class="kv-row"><span>${esc(s.name)}</span><b>${fmt(s.listings)}</b></div>`).join('')}</section></aside>`;
}

function renderCars() {
  const tot = Object.values(meta.counts).reduce((a, b) => a + b, 0);
  view.innerHTML = `<h1 id="h">${esc(heading())}</h1><div class="layout"><div>
  <div class="pills" id="countries">${[['', 'Все страны', tot], ...Object.entries(meta.countries).map(([k, v]) => [k, v, meta.counts[k] || 0])].map(([k, v, n]) => `<button class="pill-b ${filters.country === k ? 'on' : ''}" data-c="${k}"><b>${v}</b><small>${ads(n)}</small></button>`).join('')}</div>
  <div class="cond" id="cond">${[['', 'Все'], ['used', 'С пробегом'], ['new', 'Новые']].map(([k, v]) => `<button class="${filters.cond === k ? 'on' : ''}" data-v="${k}">${v}</button>`).join('')}</div>
  <form class="filters" id="ff" novalidate autocomplete="off">
    <div class="c2" id="w-brand"></div><div class="c2" id="w-model"></div><div class="c2" id="w-gen"></div>
    <div class="c2 pair"><input class="input" name="priceMin" inputmode="numeric" placeholder="Цена от, ₽"><input class="input" name="priceMax" inputmode="numeric" placeholder="до"></div>
    <div class="c2 pair"><input class="input" name="yearMin" inputmode="numeric" placeholder="Год от"><input class="input" name="yearMax" inputmode="numeric" placeholder="до"></div>
    <div class="c2 pair"><input class="input" name="volMin" inputmode="decimal" placeholder="Объём от, л"><input class="input" name="volMax" inputmode="decimal" placeholder="до"></div>
    <div class="c2" id="w-fuel"></div><div class="c2" id="w-ins"></div>
    <div class="c1"><input class="input" name="kmMax" inputmode="numeric" placeholder="Пробег до"></div><div class="c1"><input class="input" name="q" placeholder="Поиск"></div>
    <div class="f-foot"><button type="button" class="reset" id="reset">× Сбросить все</button><button type="submit" class="btn main" id="show">Показать</button></div>
  </form>
  <div class="bar" id="bar"><div class="bar-l"><div class="count" id="count">&nbsp;</div><div class="view-seg" id="view-seg"><button type="button" data-m="models">Модели</button><button type="button" data-m="cars">Объявления</button></div></div><div class="sort" id="w-sort"></div></div>
  <div id="results"></div></div>${sideHtml()}</div>`;
  for (const n of ['priceMin', 'priceMax', 'yearMin', 'yearMax', 'kmMax', 'q', 'volMin', 'volMax']) {
    const i = $(`[name=${n}]`); i.value = filters[n];
    let t; i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => {
      filters[n] = n === 'q' ? i.value : (parseNum(i.value) ?? '');
      if (n === 'volMin') filters.ccMin = filters.volMin === '' ? '' : Math.round(filters.volMin * 1000);
      if (n === 'volMax') filters.ccMax = filters.volMax === '' ? '' : Math.round(filters.volMax * 1000);
      filters.page = 1; loadCars();
    }, 280); });
  }
  $('#ff').addEventListener('submit', e => { e.preventDefault(); $('#bar').scrollIntoView({ block: 'start' }); scrollBy(0, -76); });
  $('#countries').addEventListener('click', e => { const b = e.target.closest('.pill-b'); if (!b) return; filters.country = b.dataset.c; filters.brand = filters.model = filters.gen = ''; filters.page = 1; document.querySelectorAll('.pill-b').forEach(x => x.classList.toggle('on', x === b)); $('#h').textContent = heading(); loadCars(); });
  $('#cond').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; filters.cond = b.dataset.v; filters.page = 1; document.querySelectorAll('#cond button').forEach(x => x.classList.toggle('on', x === b)); loadCars(); });
  $('#reset').addEventListener('click', () => { Object.assign(filters, { gen: '', brand: '', model: '', fuel: '', cond: '', ins: '', priceMin: '', priceMax: '', yearMin: '', yearMax: '', kmMax: '', volMin: '', volMax: '', ccMin: '', ccMax: '', q: '', page: 1 }); renderCars(); });
  const seg = $('#view-seg'), markSeg = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === filters.mode));
  markSeg();
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.dataset.m === filters.mode) return; filters.mode = b.dataset.m; filters.page = 1; markSeg(); loadCars(); });
  drawControls({ brands: [], models: [], gens: [] });
  loadCars();
}

function drawControls(f) {
  const set = (w, id, label, empty, dis, opts, val, search, pick) => { $(w).innerHTML = ddHtml(id, label, empty, dis); $(`#${id}`).addEventListener('click', e => openDropdown(e.currentTarget, { options: opts, value: val, search, onPick: pick })); };
  const ofn = (arr, all) => [{ value: '', label: all }, ...arr.map(x => ({ value: x.v, label: x.v, n: x.n }))];
  const cnt = (arr, v) => { const x = arr.find(a => a.v === v); return x ? `${v} (${fmt(x.n)})` : v; };
  set('#w-brand', 'dd-brand', filters.brand ? cnt(f.brands, filters.brand) : 'Марка', !filters.brand, false, ofn(f.brands, 'Все марки'), filters.brand, true, v => { filters.brand = v; filters.model = filters.gen = ''; filters.page = 1; loadCars(); });
  set('#w-model', 'dd-model', filters.model ? cnt(f.models, filters.model) : 'Модель', !filters.model, !filters.brand, ofn(f.models, 'Все модели'), filters.model, true, v => { filters.model = v; filters.gen = ''; filters.page = 1; loadCars(); });
  const gens = f.gens || [], genNow = gens.find(g => g.v === filters.gen);
  set('#w-gen', 'dd-gen', genNow ? `${genNow.label} (${fmt(genNow.n)})` : 'Поколение', !genNow, !filters.model || !gens.length, [{ value: '', label: 'Все поколения' }, ...gens.map(g => ({ value: g.v, label: g.label, n: g.n }))], filters.gen, gens.length > 8, v => { filters.gen = v; filters.page = 1; loadCars(); });
  set('#w-fuel', 'dd-fuel', FUEL[filters.fuel] || 'Топливо', !filters.fuel, false, [{ value: '', label: 'Любое' }, ...Object.entries(FUEL).map(([value, label]) => ({ value, label }))], filters.fuel, false, v => { filters.fuel = v; filters.page = 1; loadCars(); });
  const INS = [{ value: '', label: 'Любое состояние' }, { value: 'clean', label: 'Без страховых' }, { value: 'dirty', label: 'Со страховыми' }];
  set('#w-ins', 'dd-ins', filters.ins ? INS.find(x => x.value === filters.ins).label : 'Состояние', !filters.ins, false, INS, filters.ins, false, v => { filters.ins = v; filters.page = 1; loadCars(); });
  set('#w-sort', 'dd-sort', SORT.find(s => s.value === filters.sort).label, false, false, SORT, filters.sort, false, v => { filters.sort = v; filters.page = 1; loadCars(); });
}

let carsTicket = 0;
async function loadCars() {
  const t = ++carsTicket, mode = filters.mode, key = `${mode}?${qs()}`, res = $('#results'), draw = (d, f) => (mode === 'models' ? drawOffers(d, f) : drawResults(d, f));
  const hit = cache.get(key);
  if (hit) draw(hit.data, hit.f);
  else { res.innerHTML = '<div class="sk sk-row"></div>'.repeat(4); $('#count').textContent = 'Загружаю…'; }
  const bar = document.createElement('div'); bar.className = 'progress'; document.body.append(bar);
  try {
    const [data, f] = await Promise.all([api(`/api/${mode === 'models' ? 'offers' : 'listings'}?${qs()}`), api(`/api/facets?${qs()}`)]);
    cache.set(key, { data, f });
    if (t === carsTicket && $('#results')) draw(data, f);
  } catch { if (t === carsTicket && $('#results') && !hit) { res.innerHTML = '<div class="empty">Не удалось загрузить</div>'; $('#count').textContent = ''; } }
  finally { bar.remove(); }
}

const word = (n, a, b, c) => { const x = n % 100, y = n % 10; return x > 10 && x < 20 ? c : y === 1 ? a : y >= 2 && y <= 4 ? b : c; };
function drawResults(d, f) {
  drawControls(f);
  $('#count').textContent = ads(d.total);
  $('#show').textContent = `Показать ${ads(d.total)}`;
  const res = $('#results');
  if (!d.items.length) { res.innerHTML = '<div class="empty">Машин не найдено</div>'; return; }
  res.innerHTML = `<div class="list">${d.items.map(rowHtml).join('')}</div>${pagerHtml(d)}`;
  res.querySelectorAll('img').forEach(i => i.addEventListener('error', () => { i.parentElement.classList.add('none'); i.remove(); }));
  res.querySelector('.list').addEventListener('click', e => { const b = e.target.closest('.row'); if (b) openCar(d.items.find(x => x.id === b.dataset.id)); });
  bindPager(res);
}
function bindPager(res) {
  res.querySelector('.pager')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.p) filters.page = +b.dataset.p; if (b.dataset.s) { filters.size = +b.dataset.s; filters.page = 1; }
    loadCars(); $('#bar').scrollIntoView(); scrollBy(0, -76);
  });
}

const yearsText = (a, b) => (!a ? '' : a === b ? String(a) : `${a}–${b}`);
const rangeHtml = o => `<span class="range">${o.from === o.to ? money(o.from) : `<small>от</small>${money(o.from)}`}</span>${o.from === o.to ? '' : `<span class="orig">до ${money(o.to)}</span>`}<span class="turn">${o.kind === 'turnkey' ? (o.country === 'kg' ? 'под ключ, Москва' : 'под ключ, Владивосток') : 'цена площадки'}</span>`;
function drawOffers(d, f) {
  drawControls(f);
  const label = `${fmt(d.total)} ${word(d.total, 'модель', 'модели', 'моделей')}`;
  $('#count').textContent = `${label} · ${fmt(d.cars)} ${word(d.cars, 'машина', 'машины', 'машин')}`;
  $('#show').textContent = `Показать ${label}`;
  const res = $('#results');
  if (!d.items.length) { res.innerHTML = '<div class="empty">Машин не найдено</div>'; return; }
  res.innerHTML = `<div class="list">${d.items.map(o => `<button class="row" data-k="${esc(o.key)}"><span class="ph ${o.photo ? '' : 'none'}">${o.photo ? `<img loading="lazy" referrerpolicy="no-referrer" src="${safe(o.photo)}" alt="">` : ''}${o.modelPhoto ? '<span class="ph-note">Фото модели</span>' : ''}</span>
  <span class="r-main"><span class="r-title">${esc(o.brand)} ${esc(o.model)}</span><span class="o-sub">${[o.genLabel, /\d{4}/.test(o.genLabel || '') ? '' : yearsText(o.yearMin, o.yearMax)].filter(Boolean).map(esc).join(' · ')}</span><span class="o-meta">${fmt(o.trimCount)} ${word(o.trimCount, 'комплектация', 'комплектации', 'комплектаций')}, ${fmt(o.count)} ${word(o.count, 'машина', 'машины', 'машин')}</span>${o.nuanceCount ? `<span class="tags"><span class="tag up">С нюансами: ${fmt(o.nuanceCount)}</span></span>` : ''}</span>
  <span class="r-side">${rangeHtml(o)}<span class="where">${esc(meta.countries[o.country])}</span></span></button>`).join('')}</div>${pagerHtml(d)}`;
  res.querySelectorAll('img').forEach(i => i.addEventListener('error', () => { i.parentElement.classList.add('none'); i.remove(); }));
  res.querySelector('.list').addEventListener('click', e => { const b = e.target.closest('.row'); if (b) openOffer(d.items.find(x => x.key === b.dataset.k)); });
  bindPager(res);
}

const offerState = { open: new Set(), band: {}, color: {}, shown: {} };
async function openOffer(o, keep) {
  if (!keep) Object.assign(offerState, { open: new Set(), band: {}, color: {}, shown: {} });
  document.body.style.overflow = 'hidden';
  layer.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true"><div class="m-head"><div><h2>${esc(o.brand)} ${esc(o.model)}</h2><p>${[o.genLabel, /\d{4}/.test(o.genLabel || '') ? '' : yearsText(o.yearMin, o.yearMax), meta.countries[o.country]].filter(Boolean).map(esc).join(' · ')}</p></div><button class="x" aria-label="Закрыть">×</button></div><div class="offer-body" id="o-body">${'<div class="sk" style="height:58px;margin-bottom:8px"></div>'.repeat(4)}</div></div></div>`;
  const close = () => { layer.innerHTML = ''; document.body.style.overflow = ''; removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  $('.x', layer).addEventListener('click', close);
  $('.modal-back', layer).addEventListener('mousedown', e => { if (e.target === e.currentTarget) close(); });
  const p = new URLSearchParams(qs()); p.delete('page'); p.delete('size'); p.delete('sort'); p.delete('gen'); p.set('key', o.key);
  let d;
  try { d = await api(`/api/offer?${p}`); } catch { const b = $('#o-body'); if (b) b.innerHTML = '<div class="empty">Не удалось загрузить</div>'; return; }
  const body = $('#o-body');
  if (!body || !d) return;
  if (!keep && d.trims.length === 1) offerState.open.add(d.trims[0].key);
  const paint = () => { body.innerHTML = d.trims.map(trimHtml).join(''); body.querySelectorAll('img').forEach(i => i.addEventListener('error', () => { i.parentElement.classList.add('none'); i.remove(); })); };
  paint();
  body.addEventListener('click', e => {
    const h = e.target.closest('.trim-h'), chip = e.target.closest('.chip-f'), mini = e.target.closest('.mini'), more = e.target.closest('.more');
    if (h) { const k = h.dataset.t; offerState.open.has(k) ? offerState.open.delete(k) : offerState.open.add(k); paint(); }
    else if (chip) { const k = chip.dataset.t, f = chip.dataset.f, st = offerState[f]; st[k] = st[k] === chip.dataset.v ? '' : chip.dataset.v; offerState.shown[k] = 0; paint(); }
    else if (more) { const k = more.dataset.t; offerState.shown[k] = (offerState.shown[k] || MINI) + MINI; paint(); }
    else if (mini) { const c = d.trims.flatMap(t => t.cars).find(x => x.id === mini.dataset.id); if (c) { removeEventListener('keydown', onKey); openCar({ ...c, rub: c.rub }, () => openOffer(o, true)); } }
  });
}
const MINI = 12;
function trimHtml(t) {
  const open = offerState.open.has(t.key), k = esc(t.key);
  const head = `<button class="trim-h" data-t="${k}"><span><b>${esc(t.name)}</b><small>${[t.engine, yearsText(t.yearMin, t.yearMax), `${fmt(t.count)} ${word(t.count, 'машина', 'машины', 'машин')}`].filter(Boolean).map(esc).join(' · ')}</small></span><span class="trim-p">${rangeHtml({ ...t, country: t.cars[0]?.country })}</span><i class="chev"></i></button>`;
  if (!open) return `<div class="trim">${head}</div>`;
  const band = offerState.band[t.key] || '', color = offerState.color[t.key] || '';
  const list = t.cars.filter(c => (!band || bandOf(c.mileage) === band) && (!color || c.color === color)), limit = offerState.shown[t.key] || MINI;
  const chips = (f, arr) => arr.map(x => `<button class="chip-f ${(f === 'band' ? band : color) === x.v ? 'on' : ''}" data-t="${k}" data-f="${f}" data-v="${esc(x.v)}">${esc(x.label || x.v)}<small>${fmt(x.n)}</small></button>`).join('');
  return `<div class="trim open">${head}<div class="trim-b">${t.bands.length > 1 ? `<div class="chips">${chips('band', t.bands.map(b => ({ v: b.key, label: b.label, n: b.count })))}</div>` : ''}${t.colors.length > 1 ? `<div class="chips">${chips('color', t.colors)}</div>` : ''}${t.nuance ? `<div class="nuance">Со страховыми случаями: ${fmt(t.nuance.count)}, от ${money(t.nuance.from)}. Авто может быть с нюансами</div>` : ''}
  ${list.slice(0, limit).map(c => `<button class="mini" data-id="${esc(c.id)}"><span class="ph ${c.photo_local || c.photo ? '' : 'none'}">${c.photo_local || c.photo ? `<img loading="lazy" referrerpolicy="no-referrer" src="${safe(c.photo_local || c.photo)}" alt="">` : ''}</span><span><b>${[c.year, c.mileage != null ? `${fmt(c.mileage)} км` : null].filter(Boolean).join(', ')}</b><small>${[c.grade ? `оценка ${c.grade}` : null, c.color, c.insurance > 0 ? 'страховые случаи' : null].filter(Boolean).map(esc).join(' · ')}</small></span><span class="mini-p">${money(c.turnkey || c.rub)}</span></button>`).join('')}${list.length > limit ? `<button class="more" data-t="${k}">Ещё ${fmt(Math.min(MINI, list.length - limit))} из ${fmt(list.length - limit)}</button>` : ''}</div></div>`;
}

const carName = c => (c.brand && c.model ? `${c.brand} ${c.model}${c.year ? `, ${c.year}` : ''}` : c.title);
function specLine(c) {
  const engine = c.volume_cc ? `${(c.volume_cc / 1000).toFixed(1)} л${c.hp ? ` (${c.hp} л.с.)` : ''}` : c.hp ? `${c.hp} л.с.` : null;
  return [engine, FUEL[c.fuel]?.toLowerCase(), c.drive ? `${c.drive} привод` : null, c.color, c.mileage != null ? (c.mileage <= 100 ? 'без пробега' : `${fmt(c.mileage)} км`) : null].filter(Boolean).join(', ');
}
function rowHtml(c) {
  const src = meta.sources.find(s => s.id === c.source);
  const moved = c.price_prev ? `<span class="tag ${c.price < c.price_prev ? 'down' : 'up'}">${c.price < c.price_prev ? '↓' : '↑'} было ${money(c.price_prev, c.currency)}</span>` : '';
  const spec = c.spec && /Specs/.test(c.spec) ? `<span class="tag">${esc(c.spec)}</span>` : '';
  const grade = c.grade ? `<span class="tag ${['5', '6', 'S', '4.5'].includes(c.grade) ? 'down' : ''}">Оценка ${esc(c.grade)}</span>` : '';
  const sanc = c.country === 'jp' ? (isSanctioned(c) ? '<span class="tag up">Санкционный</span>' : isMildHybrid(c) ? '<span class="tag">Мягкий гибрид</span>' : '') : '';
  const kind = c.price_kind === 'start' ? '<span class="tag">Старт торгов</span>' : c.price_kind === 'average' ? '<span class="tag">Средняя цена</span>' : '';
  const ins = c.insurance === 0 ? '<span class="tag down">Без страховых</span>' : c.insurance > 0 ? `<span class="tag up">Страховых случаев: ${c.insurance}</span>` : '';
  return `<button class="row" data-id="${esc(c.id)}"><span class="ph ${c.photo ? '' : 'none'}">${c.photo ? `<img loading="lazy" referrerpolicy="no-referrer" src="${safe(c.photo_local || c.photo)}" alt="">` : ''}${modelPhotoNote(c)}</span>
  <span class="r-main"><span class="r-title">${esc(carName(c))}</span>${c.trim ? `<span class="r-trim">${esc(c.trim)}</span>` : ''}<span class="r-spec">${esc(specLine(c))}</span>${moved || spec || ins || grade ? `<span class="tags">${grade}${sanc}${kind}${ins}${moved}${spec}</span>` : ''}</span>
  <span class="r-side"><span class="rub">${money(c.rub)}</span><span class="turn">${c.turnkey ? `под ключ, ${c.country === 'kg' ? 'Москва' : 'Владивосток'}` : 'цена площадки'}</span><span class="orig">${money(c.price, c.currency)}</span><span class="where">${esc(meta.countries[c.country])}${c.city ? `, ${esc(c.city)}` : ''}<br>${esc(src?.name)}</span></span></button>`;
}
function pagerHtml(d) {
  const pages = Math.max(1, Math.ceil(d.total / d.size)), p = d.page, nums = [];
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - p) <= 2) nums.push(i); else if (nums.at(-1) !== '…') nums.push('…');
  return `<div class="pager"><div class="nums"><button class="pg" data-p="${p - 1}" ${p <= 1 ? 'disabled' : ''}>‹</button>${nums.map(n => (n === '…' ? '<span class="dots">…</span>' : `<button class="pg ${n === p ? 'on' : ''}" data-num data-p="${n}">${n}</button>`)).join('')}<span class="pg-m">${p} из ${pages}</span><button class="pg" data-p="${p + 1}" ${p >= pages ? 'disabled' : ''}>›</button></div>
  <div class="sizes">${[50, 100, 200].map(s => `<button class="pg ${s === d.size ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div></div>`;
}

function creditHtml(c) {
  if (!c.photo_credit) return '';
  try { const x = JSON.parse(c.photo_credit); return `<a class="credit" target="_blank" rel="noopener noreferrer" href="${safe(x.url)}">Фото: ${esc(x.text)}</a>`; } catch { return ''; }
}

const NOTE = { start: 'только старт торгов', specs: 'нужна мощность или объём', pickup: 'пикап: расчёт по TKS', delivery: 'нужна доставка из ОАЭ', price: 'нет цены' };
function costHtml(c) {
  if (!c.breakdown) return '';
  let b; try { b = JSON.parse(c.breakdown); } catch { return ''; }
  if (b.lines) {
    const row = l => `<div class="line ${l.strong ? 'strong' : ''}"><span>${esc(l.label)}</span><span>${money(l.value, l.cur)}</span></div>`, t = b.customs || {};
    const cu = [['Пошлина', t.duty], ['Таможенное оформление', t.fee], ['Утильсбор', t.util], ['Акциз', t.excise], ['НДС', t.vat]].filter(([, v]) => v > 0).map(([label, value]) => row({ label, value, cur: 'RUB' })).join('');
    return `<div class="sub">Из чего цена</div>${b.route ? row({ label: 'Маршрут', value: null }).replace('—', esc(b.route)) : ''}${b.lines.map(row).join('')}<div class="sub">Таможня</div>${cu}<div class="line strong"><span>Под ключ</span><span>${money(c.turnkey)}</span></div>`;
  }
  const line = (k, v) => `<div class="line"><span>${k}</span><span>${money(v)}</span></div>`;
  return `<div class="sub">Из чего цена</div>${line('Автомобиль', c.price * (b.rate || 0))}${line('Доставка до Москвы', b.delivery)}${line('Расходы', b.expenses_usd * (b.rate || 0))}${line('Утильсбор', b.util)}${line('Брокер', b.broker)}${line('Комиссия компании', b.commission)}<div class="line strong"><span>Под ключ</span><span>${money(c.turnkey)}</span></div>`;
}

function openCar(c, onBack) {
  const src = meta.sources.find(s => s.id === c.source);
  const rows = [['Страна', meta.countries[c.country]], ['Год', c.year], ['Регистрация', c.reg], ['Пробег', c.mileage != null ? `${fmt(c.mileage)} км` : null], ['Двигатель', c.volume_cc ? `${(c.volume_cc / 1000).toFixed(1)} л` : null], ['Мощность', c.hp ? `${c.hp} л.с.` : null], ['Оценка', c.grade], ['Маршрут', c.country === 'jp' ? (isSanctioned(c) ? 'Япония, Корея, РФ' : 'Япония, РФ') : null], ['Кузов', c.chassis], ['КПП', c.gearbox], ['Аукцион', c.auction], ['Дата торгов', c.auction_date], ['Топливо', FUEL[c.fuel]], ['Привод', c.drive], ['Цвет', c.color], ['Страховые случаи', c.insurance == null ? null : c.insurance === 0 ? 'нет' : c.insurance], ['Сумма выплат', c.insurance_sum ? `${fmt(c.insurance_sum)} $` : null], ['Спецификация', c.spec && /Specs/.test(c.spec) ? c.spec : null], ['Город', c.auction ? null : c.city], ['Источник', src?.name]].filter(([, v]) => v);
  layer.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true"><div class="m-head"><div class="m-title">${onBack ? '<button class="back" aria-label="Назад">‹</button>' : ''}<div><h2>${esc(carName(c))}</h2>${c.trim ? `<p>${esc(c.trim)}</p>` : ''}</div></div><button class="x" aria-label="Закрыть">×</button></div>
  <div class="m-body"><div><span class="ph ${c.photo ? '' : 'none'}">${c.photo ? `<img referrerpolicy="no-referrer" src="${safe(c.photo_local || c.photo)}" alt="">` : ''}${modelPhotoNote(c)}</span>${creditHtml(c)}</div>
  <div><div class="m-price"><span class="rub">${money(c.rub)}</span><span class="turn">${c.turnkey ? `под ключ, ${c.country === 'kg' ? 'Москва' : 'Владивосток'}` : esc(NOTE[c.turnkey_note] || 'цена площадки')}</span><span class="orig">${money(c.price, c.currency)}</span></div>
  <div class="m-act">${c.country === 'kg' ? '' : '<button class="btn main" id="to-calc">Открыть в калькуляторе</button>'}${c.url ? `<a class="btn ${c.country === 'kg' ? 'main' : 'sec'}" target="_blank" rel="noopener noreferrer" href="${safe(c.url)}">${c.country === 'kg' ? 'Видео' : 'Открыть объявление'}</a>` : ''}</div>
  <dl class="spec">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${c.options ? `<div class="opts">${esc(c.options)}</div>` : ''}${costHtml(c)}</div></div></div></div>`;
  const close = () => { layer.innerHTML = ''; document.body.style.overflow = ''; removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey); document.body.style.overflow = 'hidden';
  $('.x', layer).addEventListener('click', close);
  $('.back', layer)?.addEventListener('click', () => { removeEventListener('keydown', onKey); onBack(); });
  $('.modal-back', layer).addEventListener('mousedown', e => { if (e.target === e.currentTarget) close(); });
  $('img', layer)?.addEventListener('error', e => { e.target.parentElement.classList.add('none'); e.target.remove(); });
  $('#to-calc')?.addEventListener('click', () => { fillCalc(c); close(); location.hash = 'calc'; });
}

/* Калькулятор */
const unitRate = code => meta.rates[code]?.perUnit ?? null;
function fillCalc(c) {
  const id = c.country === 'jp' ? japanScheme(c) : { cn: 'cn', kr: 'kr', ae: 'ae' }[c.country], s = scheme(id);
  let saved = {}; try { saved = JSON.parse(c.breakdown || '{}'); } catch { saved = {}; }
  const carPrice = c.currency === s.cur ? c.price : c.price * meta.rates[c.currency].cbr / meta.rates[s.cur].cbr;
  Object.assign(calcState, { id, price: Math.round(carPrice), rate: null, abroad: null, year: c.year || calcState.year, cc: c.volume_cc ?? null, hp: c.hp ?? null, fuel: saved.engine || c.fuel || (/\b\d{3}d\b|\bdiesel\b|\bTDI\b|\bCDI\b|\bXD\b/i.test(c.trim || '') ? 'diesel' : 'petrol'), body: c.body === 'pickup' || c.turnkey_note === 'pickup' ? 'pickup' : 'car', customs: null, docs: null, commission: null, logistics: null, customsTouched: false, commissionTouched: false, title: c.title });
}
function schemeReset(id) { const s = scheme(id); Object.assign(calcState, { id, price: s.price, rate: null, abroad: null, customs: null, docs: null, commission: null, logistics: null, customsTouched: false, commissionTouched: false, payMarkup: 'none', title: '' }); }
const REASONS = { pickup: 'Пикап', specs: 'Нужны объём и мощность', price: 'Нужна цена' };

function renderCalc() {
  const st = calcState;
  if (st.price == null) st.price = scheme(st.id).price;
  const s = scheme(st.id);
  const field = (k, label, ph) => `<label class="field"><span>${label}</span><input class="input" data-k="${k}" inputmode="decimal" value="${st[k] == null ? '' : esc(String(st[k]).replace('.', ','))}" placeholder="${ph ?? ''}"></label>`;
  view.innerHTML = `<h1>Калькулятор</h1><div class="calc"><section class="box">
    <div class="fields">
      <div class="field full"><span>Направление</span>${ddHtml('dd-scheme', s.name)}</div>
      ${st.title ? `<div class="field full"><span>Автомобиль</span><div class="car-name">${esc(st.title)}</div></div>` : ''}
      ${field('price', `Цена авто, ${SYM[s.cur]}`)}${field('rate', `Курс ${s.cur} → ₽`, fmt(unitRate(s.cur), 4))}
      ${s.uae ? '' : field('abroad', `Расходы в стране, ${SYM[s.cur]}`, fmt(defaultAbroad(s, st.price || 0)))}
      ${s.payMarkup ? `<div class="field"><span>Оплата</span>${ddHtml('dd-pay', PAY_MARKUPS.find(m => m.id === st.payMarkup).label)}</div>` : ''}
      <div class="sep">Таможня</div>
      <div class="field full"><span>Кузов</span><div class="seg" data-seg="body"><button type="button" data-v="car">Легковой</button><button type="button" data-v="pickup">Пикап</button></div></div>
      ${field('year', 'Год выпуска')}<div class="field"><span>Топливо</span>${ddHtml('dd-cfuel', FUEL[st.fuel])}</div>
      ${field('cc', 'Объём, см³')}${field('hp', 'Мощность, л.с.')}
      ${field('customs', 'Таможенные платежи, ₽')}<div class="field" id="c-note"></div>
      <div class="links"><a class="btn sec" target="_blank" rel="noopener noreferrer" href="https://calcus.ru/rastamozhka-auto">Calcus</a><a class="btn sec" target="_blank" rel="noopener noreferrer" href="https://www.tks.ru/auto/calc/">TKS, пикап</a></div>
      <div class="sep">Расходы в России</div>
      ${s.uae ? field('broker', 'Брокер, лаборатория, ₽', fmt(s.broker)) : ''}${field('docs', s.uae ? 'ЭПТС, СБКТС, ₽' : 'ЭПТС, СБКТС, брокер, СВХ, ₽', fmt(s.docs))}
      ${s.logistics ? field('logistics', 'Логистика до Москвы, ₽', '0') : ''}${field('commission', 'Комиссия компании, ₽')}
    </div></section><section class="box result" id="c-out"></section></div>`;
  $('#dd-scheme').addEventListener('click', e => openDropdown(e.currentTarget, { options: SCHEMES.map(x => ({ value: x.id, label: x.name })), value: st.id, onPick: v => { schemeReset(v); renderCalc(); } }));
  $('#dd-pay')?.addEventListener('click', e => openDropdown(e.currentTarget, { options: PAY_MARKUPS.map(m => ({ value: m.id, label: m.label })), value: st.payMarkup, onPick: v => { st.payMarkup = v; renderCalc(); } }));
  $('#dd-cfuel').addEventListener('click', e => openDropdown(e.currentTarget, { options: Object.entries(FUEL).map(([value, label]) => ({ value, label })), value: st.fuel, onPick: v => { st.fuel = v; if (!st.customsTouched) st.customs = null; renderCalc(); } }));
  const seg = $('[data-seg=body]');
  seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === st.body); b.addEventListener('click', () => { st.body = b.dataset.v; st.customsTouched = false; st.customs = null; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); drawCalc(); }); });
  view.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => {
    const k = i.dataset.k; st[k] = parseNum(i.value);
    if (k === 'customs') st.customsTouched = i.value.trim() !== '';
    if (k === 'commission') st.commissionTouched = i.value.trim() !== '';
    drawCalc();
  }));
  drawCalc();
}

function drawCalc() {
  const st = calcState, s = scheme(st.id), out = $('#c-out');
  if (!out) return;
  const rate = st.rate ?? unitRate(s.cur);
  const carRub = (st.price || 0) * rate;
  const auto = customs({ priceRub: (st.price || 0) * (meta.rates[s.cur]?.cbr || rate), eurRate: unitRate('EUR'), age: ageBand(st.year || new Date().getFullYear()), cc: st.cc, hp: st.hp, fuel: st.fuel, body: st.body });
  const custInput = $('[data-k=customs]');
  if (!st.customsTouched) { st.customs = auto.ok ? Math.round(auto.total) : null; if (document.activeElement !== custInput) custInput.value = st.customs == null ? '' : st.customs; }
  $('#c-note').innerHTML = auto.ok ? `<span>Расчёт</span><div class="state"><span class="badge ok">${auto.util <= 5200 ? 'Льготный утильсбор' : 'По ставкам 2026'}</span></div>` : `<span>Расчёт</span><div class="state"><span class="badge warn">${esc(REASONS[auto.reason])}: вручную</span></div>`;
  const ruleBase = { price: st.price || 0, rate, abroad: st.abroad ?? undefined, customs: st.customs ?? 0, docs: st.docs ?? undefined, logistics: st.logistics ?? 0, broker: st.broker ?? undefined, payMarkup: st.payMarkup };
  const commission = st.commissionTouched ? st.commission : (s.commission ?? commissionFor(compute(st.id, { ...ruleBase, commission: 60000 }).total));
  const commInput = $('[data-k=commission]');
  if (!st.commissionTouched && document.activeElement !== commInput) commInput.value = commission;
  if (st.customs == null || !(st.price > 0) || !(rate > 0)) { out.innerHTML = `<h3>Расчёт</h3><div class="empty">Введите таможенные платежи</div>`; return; }
  const r = compute(st.id, { price: st.price, rate, abroad: st.abroad ?? undefined, customs: st.customs, docs: st.docs ?? undefined, commission, logistics: st.logistics ?? 0, broker: st.broker ?? undefined, payMarkup: st.payMarkup });
  const line = l => `<div class="line ${l.strong ? 'strong' : ''}"><span>${esc(l.label)}</span><span>${money(l.value, l.cur)}</span></div>`;
  out.innerHTML = `<div class="total"><span>${esc(r.totalLabel)}</span><b>${money(r.total)}</b></div>${r.route ? `<div class="line"><span>Маршрут</span><span>${esc(r.route)}</span></div>` : ''}<div class="lines">${r.lines.map(line).join('')}</div>
  ${auto.ok && !st.customsTouched ? `<div class="sub">Таможня</div><div class="lines">${line({ label: 'Пошлина', value: auto.duty, cur: 'RUB' })}${line({ label: 'Таможенное оформление', value: auto.fee, cur: 'RUB' })}${line({ label: 'Утильсбор', value: auto.util, cur: 'RUB' })}${auto.excise ? line({ label: 'Акциз', value: auto.excise, cur: 'RUB' }) : ''}${auto.vat ? line({ label: 'НДС', value: auto.vat, cur: 'RUB' }) : ''}</div>` : ''}
  <div class="sub">${esc(r.extraTitle || 'Дополнительно')}</div><div class="lines">${r.extra.map(line).join('')}</div>`;
}

/* Обновления */
const TYPES = { '': 'Все', added: 'Новые', price: 'Цена', removed: 'Снятые', returned: 'Вернулись' };
const chState = { type: '', page: 1 };
const STATUS = { done: ['Готово', 'ok'], running: ['Идёт', 'warn'], blocked: ['Нужна проверка', 'bad'], login: ['Нужен вход', 'bad'], error: ['Ошибка', 'bad'], aborted: ['Прервано', 'warn'] };
function renderUpdates() {
  view.innerHTML = `<h1>Обновления</h1><div class="src-grid">${meta.sources.map(s => { const [t, c] = s.last ? STATUS[s.last.status] : ['Нет данных', '']; return `<div class="src"><b>${esc(s.name)}</b><div class="n">${fmt(s.listings)}</div><span class="badge ${c}">${t}</span>${s.last?.finished ? `<small>${new Date(s.last.finished).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>` : ''}</div>`; }).join('')}</div>
  <div class="cond" id="ch-t" style="padding:0 0 8px">${Object.entries(TYPES).map(([k, v]) => `<button class="${chState.type === k ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div><div id="ch-list"><div class="sk sk-row"></div></div>`;
  $('#ch-t').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; chState.type = b.dataset.t; chState.page = 1; document.querySelectorAll('#ch-t button').forEach(x => x.classList.toggle('on', x === b)); loadChanges(); });
  loadChanges();
}
async function loadChanges() {
  const d = await api(`/api/changes?type=${chState.type}&page=${chState.page}`), el = $('#ch-list');
  if (!el) return;
  if (!d.items.length) { el.innerHTML = '<div class="box empty">Изменений нет</div>'; return; }
  const pages = Math.ceil(d.total / d.size);
  el.innerHTML = `<div class="feed">${d.items.map(c => `<div class="ch"><span class="k"><span class="badge ${c.type === 'removed' ? 'bad' : c.type === 'added' ? 'ok' : 'warn'}">${TYPES[c.type]}</span></span><span><div class="t">${esc(c.title)}</div><div class="d">${esc(meta.countries[c.country])} · ${new Date(c.at).toLocaleDateString('ru-RU')}</div></span><span class="p">${c.type === 'price' ? `${money(c.old_price, c.currency)} → ${money(c.new_price, c.currency)}` : money(c.new_price ?? c.old_price, c.currency)}</span></div>`).join('')}</div>
  ${pages > 1 ? `<div class="pager"><div class="nums"><button class="pg" data-p="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>‹</button><span class="pg-m" style="display:inline">${d.page} из ${pages}</span><button class="pg" data-p="${d.page + 1}" ${d.page >= pages ? 'disabled' : ''}>›</button></div></div>` : ''}`;
  $('.pager', el)?.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) { chState.page = +b.dataset.p; loadChanges(); scrollTo({ top: 0 }); } });
}

/* Навигация */
function route() {
  closeDropdown();
  const v = location.hash.slice(1) || 'cars';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === v));
  ({ cars: renderCars, calc: renderCalc, updates: renderUpdates }[v] || renderCars)();
  scrollTo({ top: 0 });
}
async function boot() {
  meta = await api('/api/meta');
  addEventListener('hashchange', route);
  route();
}
boot().catch(() => { view.innerHTML = '<div class="empty">Не удалось загрузить</div>'; });

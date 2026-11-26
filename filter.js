// Фильтры каталога. Один модуль для сервера, версии на GitHub и тестов.
import { generationOf } from './offers.js';

export const GEAR_OPTIONS = [{ value: 'auto', label: 'Автомат' }, { value: 'at', label: 'АКПП', sub: true }, { value: 'robot', label: 'Робот', sub: true }, { value: 'cvt', label: 'Вариатор', sub: true }, { value: 'mt', label: 'Механика' }];
export const DRIVE_OPTIONS = [{ value: 'full', label: '4WD' }, { value: 'front', label: 'Передний' }, { value: 'rear', label: 'Задний' }];
export const STEER_OPTIONS = [{ value: 'left', label: 'Левый' }, { value: 'right', label: 'Правый' }];
export const DAMAGE_OPTIONS = [{ value: 'clean', label: 'Без повреждений' }, { value: 'damaged', label: 'С повреждениями' }];
export const ORIGIN_OPTIONS = [{ value: 'jp', label: 'Япония' }, { value: 'cn', label: 'Китай' }, { value: 'kr', label: 'Корея' }];
export const VOLUMES = [0.7, 0.8, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.2, 2.4, 2.5, 2.7, 3, 3.3, 3.5, 4, 4.5, 5, 5.5, 6];
const DRIVE = { full: 'полный', front: 'передний', rear: 'задний' };
// Русские названия марок для поиска: «бмв» находит BMW, «хавал» находит Haval.
const RU = { toyota: 'тойота тоёта', nissan: 'ниссан нисан', honda: 'хонда', suzuki: 'сузуки судзуки', 'mercedes-benz': 'мерседес мерс бенц', daihatsu: 'дайхатсу дайхацу', mazda: 'мазда', bmw: 'бмв бэха', mitsubishi: 'мицубиси митсубиси мицубиши', porsche: 'порше порш', subaru: 'субару', lexus: 'лексус', volkswagen: 'фольксваген фольц', 'land rover': 'ленд ровер лэнд ровер рендж', audi: 'ауди', hyundai: 'хендай хундай хёндай хэндэ', roewe: 'роеве ровэ', xpeng: 'икспенг сяопэн', wey: 'вей', voyah: 'воя вояж', zeekr: 'зикр зекр', 'li auto': 'лисян ли авто лиауто', byd: 'бид бвд', deepal: 'дипал', aito: 'аито айто', jetta: 'джетта', tesla: 'тесла', leapmotor: 'липмотор', ford: 'форд', tank: 'танк', skoda: 'шкода', kia: 'киа', changan: 'чанган', haval: 'хавал хавейл', peugeot: 'пежо', jetour: 'джетур', chevrolet: 'шевроле шеви', geely: 'джили', rox: 'рокс', chery: 'чери', hongqi: 'хунци хончи', 'lynk & co': 'линк', wuling: 'вулинг', jeep: 'джип', exeed: 'эксид иксид', mg: 'мг эмджи', 'gac trumpchi': 'гак трампчи', 'rolls-royce': 'роллс ройс', buick: 'бьюик', ferrari: 'феррари', lamborghini: 'ламборгини ламба', renault: 'рено', isuzu: 'исузу', fiat: 'фиат', cadillac: 'кадиллак', gac: 'гак', citroen: 'ситроен', genesis: 'генезис дженезис', xiaomi: 'сяоми ксяоми', nio: 'нио', infiniti: 'инфинити', volvo: 'вольво', denza: 'денза', dodge: 'додж', smart: 'смарт', bentley: 'бентли', polestar: 'полестар', jaecoo: 'джейку джеку', avatr: 'аватр', jaguar: 'ягуар', ssangyong: 'санёнг санг енг', mini: 'мини', omoda: 'омода', jac: 'джак', acura: 'акура', maserati: 'мазерати', dongfeng: 'донгфенг', baic: 'баик', 'mercedes-maybach': 'майбах мерседес', seres: 'серес' };
const hay = c => { const b = (c.brand || '').toLowerCase(); return `${c.title} ${b} ${c.model || ''} ${RU[b] || ''}`.toLowerCase().replace(/ё/g, 'е'); };

const num = v => (v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? +v : null);
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const nn = (v, f) => v != null && f(v);

// q — URLSearchParams. skip — какие условия не применять (для подсчёта вариантов в самих списках).
export function matcher(q, skip = []) {
  const get = k => (skip.includes(k) ? '' : q.get(k) || '');
  const eq = ['country', 'source', 'brand', 'model', 'fuel'].map(k => [k, get(k)]).filter(([, v]) => v);
  const [pMin, pMax, yMin, yMax, kMin, kMax, ccMin, ccMax] = ['priceMin', 'priceMax', 'yearMin', 'yearMax', 'kmMin', 'kmMax', 'ccMin', 'ccMax'].map(k => num(get(k)));
  const [hMin, hMax] = ['hpMin', 'hpMax'].map(k => num(get(k))), hpOf = c => c.hp ?? c.hp_est;
  const cond = get('cond'), gear = get('gear'), drive = DRIVE[get('drive')], steer = get('steer'), dmg = get('dmg'), gen = get('gen');
  const bodies = new Set(list(get('body'))), origins = new Set(list(get('origin')));
  const words = get('q').trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean).slice(0, 5);
  return c => eq.every(([k, v]) => c[k] === v)
    && (pMin == null || c.rub >= pMin) && (pMax == null || c.rub <= pMax)
    && (yMin == null || nn(c.year, v => v >= yMin)) && (yMax == null || nn(c.year, v => v <= yMax))
    && (kMin == null || nn(c.mileage, v => v >= kMin)) && (kMax == null || (c.mileage ?? 0) <= kMax)
    && (ccMin == null || nn(c.volume_cc, v => v >= ccMin)) && (ccMax == null || nn(c.volume_cc, v => v <= ccMax))
    && (hMin == null || nn(hpOf(c), v => v >= hMin)) && (hMax == null || nn(hpOf(c), v => v <= hMax))
    && (cond !== 'new' || (c.mileage ?? 0) <= 1000) && (cond !== 'used' || nn(c.mileage, v => v > 1000))
    && (!gear || (gear === 'auto' ? ['at', 'robot', 'cvt'].includes(c.gear) : c.gear === gear))
    && (!drive || c.drive === drive) && (!steer || c.steer === steer)
    && (!dmg || (dmg === 'clean' ? c.damage === 0 : c.damage === 1))
    && (!bodies.size || bodies.has(c.body)) && (!origins.size || origins.has(c.origin))
    && (!gen || generationOf(c).key === gen)
    && (!words.length || (h => words.every(w => h.includes(w)))(hay(c)));
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

import { compute, scheme } from './calc.js';
import { customs, ageBand } from './customs.js';
import { japanScheme } from './sanctions.js';

const PICKUP = /\b(HILUX|TRITON|NAVARA|RANGER|L200|TACOMA|TUNDRA|RAM|D-?MAX|FRONTIER|TITAN|F-?150|SILVERADO|GLADIATOR|AMAROK|DATSUN TRUCK)\b/i;
const EV_MODELS = /^(Leaf|Ariya|Sakura|Bz4x|I-mievl?|Ek Cross Ev|Honda E|Model [3SXY]|Ioniq 5|Ioniq 6|Ev6|Ev9|Taycan|E-tron|I3|I4|Ix|Ix1|Ix3|Eqa|Eqb|Eqc|Eqe|Eqs)$/i;
const THRESHOLD = 5000000, COMMISSION = 60000, COMMISSION_HIGH = 100000;

export function engineType(c) {
  if (c.fuel === 'electric' || c.volume_cc === 0 || EV_MODELS.test(c.model || '')) return 'electric';
  if (/e-?power/i.test(c.trim || '')) return 'series';
  return c.fuel || 'petrol';
}
export const isPickup = c => c.body === 'pickup' || PICKUP.test(`${c.model || ''}`);

function target(c, cbr) {
  if (c.country === 'jp') return c.price_kind === 'start' ? { note: 'start' } : { id: japanScheme({ ...c, fuel: engineType(c) === 'petrol' ? c.fuel : engineType(c) === 'series' ? 'hybrid' : engineType(c) }), price: c.price };
  if (c.country === 'kr') return { id: 'kr', price: c.currency === 'USD' ? c.price * (cbr.USD / cbr.KRW) : c.price };
  if (c.country === 'cn') return { id: 'cn', price: c.price };
  return { note: 'delivery' };
}

// Мощность для утильсбора, когда площадка её не пишет (Encar, che168): по типовому двигателю того же объёма и типа.
// В расчёте такая мощность отмечена как оценка, менеджер сверяет её с объявлением.
const EURO = /^(Audi|BMW|Mercedes-Benz|Volkswagen|Porsche|Volvo|Land Rover|Jaguar|MINI|Mini|Skoda|Peugeot|Citroen|Renault)$/i;
const TURBO = /\b\d\.\dT\b|\bT-?GDI|\bTURBO\b|\bTFSI\b|\bTSI\b|\bTCE\b|\bECOBOOST\b|\b\d\.\d\s*T\b|\bT\d\b/i;
const step = (cc, table) => table.find(([max]) => cc <= max)?.[1] ?? table.at(-1)[1];
export function typicalHp(c) {
  const cc = c.volume_cc, fuel = c.fuel, text = `${c.title || ''} ${c.trim || ''}`;
  if (!(cc > 0) || fuel === 'electric') return null;
  if (fuel === 'diesel') return step(cc, [[1600, 136], [2000, 185], [2200, 200], [3000, 265], [Infinity, 300]]);
  if (fuel === 'lpg') return step(cc, [[2000, 150], [3000, 235], [Infinity, 240]]);
  // Гибриды 1.6 на больших моделях Hyundai и Kia идут с турбомотором (230 л.с.), на малых — атмосферные (141 л.с.).
  if (fuel === 'hybrid') return cc <= 1600 && /^(Grandeur|Sorento|Santa ?Fe|Tucson|Tuscon|Sportage|K8|Carnival|Canival|Palisade|Kona|Niro)$/i.test(c.model || '') ? (/^(Kona|Niro)$/i.test(c.model) ? 141 : 230) : step(cc, [[1600, 141], [2000, 195], [2500, 230], [Infinity, 300]]);
  const turbo = TURBO.test(text) || (EURO.test(c.brand || '') && cc >= 1300 && cc <= 3000) || (c.country === 'cn' && /\d\.\dT/i.test(text));
  if (turbo) return step(cc, [[1000, 120], [1400, 150], [1600, 180], [2000, c.country === 'cn' ? 230 : EURO.test(c.brand || '') ? 200 : 245], [2500, 300], [3500, 370], [Infinity, 450]]);
  return step(cc, [[1000, 75], [1200, 85], [1400, 100], [1600, 123], [2000, 152], [2500, 190], [3000, 250], [3500, 290], [3800, 315], [Infinity, 400]]);
}

// rates: { company: {код: ₽ за единицу}, cbr: {код: ₽ за единицу} }
export function turnkeyFor(c, { company, cbr }, now = new Date()) {
  if (isPickup(c)) return { note: 'pickup' };
  const t = target(c, cbr);
  if (t.note) return { note: t.note };
  if (!c.year) return { note: 'specs' };
  const s = scheme(t.id), electric = ['electric', 'series'].includes(engineType(c));
  if (!electric && !(c.volume_cc > 0)) return { note: 'specs' };
  const hpEst = c.hp || c.country !== 'kr' ? null : typicalHp(c), hp = c.hp || hpEst; // Оценка только для Кореи: двигатели Hyundai и Kia по объёму почти однозначны. Китай ждёт мощность из карточки che168.
  if (!hp && !electric) return { note: 'specs' };
  const duty = customs({ priceRub: t.price * cbr[s.cur], eurRate: cbr.EUR, age: ageBand(c.year, now), cc: electric ? c.volume_cc || 0 : c.volume_cc, hp, fuel: engineType(c) });
  if (!duty.ok) return { note: duty.reason };
  const input = { price: t.price, rate: company[s.cur], customs: duty.total };
  let r = compute(t.id, { ...input, commission: COMMISSION });
  if (r.total >= THRESHOLD) r = compute(t.id, { ...input, commission: COMMISSION_HIGH });
  return { turnkey: Math.round(r.total), hpEst, breakdown: { scheme: s.name, engine: engineType(c), route: r.route, hp, hpEst: !!hpEst, lines: r.lines, customs: { duty: duty.duty, fee: duty.fee, util: duty.util, excise: duty.excise, vat: duty.vat } } };
}

// Свыше 160 л.с. в каталоге только премиум-сегмент: под ключ от 5 млн ₽. Пикапы остаются.
export const isHiddenByPower = (c, turnkey, hp = c.hp) => c.country !== 'kg' && hp > 160 && !isPickup(c) && !(turnkey >= THRESHOLD);
// Эмираты: только новые машины без пробега.
export const isHiddenUae = c => c.country === 'ae' && c.mileage != null && c.mileage > 100;

// Китай: не старше 2015 года, новые не везём, регистрация должна быть старше полугода.
export function isHiddenChina(c, now = new Date()) {
  if (c.country !== 'cn') return false;
  if (!c.year || c.year < 2015) return true;
  const m = String(c.reg || '').match(/^(\d{4})[/-](\d{1,2})/);
  if (!m) return c.year >= 2025;
  return (now.getFullYear() - +m[1]) * 12 + now.getMonth() + 1 - +m[2] < 6;
}

export function recomputeTurnkey(db) {
  const rates = db.prepare('SELECT * FROM rates').all(), eff = Object.fromEntries(db.prepare('SELECT * FROM effective').all().map(r => [r.key, r.per_unit]));
  const cbr = Object.fromEntries(rates.map(r => [r.code, r.value / r.nominal]));
  if (!cbr.EUR || !eff.KRW) return null;
  const company = { USD: eff.USD, CNY: eff.CNY, JPY: eff.JPY, KRW: eff.KRW };
  const rows = db.prepare(`SELECT id,country,brand,model,title,trim,year,reg,mileage,fuel,volume_cc,hp,body,price,currency,price_kind,chassis FROM listings WHERE active=1 AND source<>'kyrgyz'`).all();
  const up = db.prepare('UPDATE listings SET turnkey=?, breakdown=?, turnkey_note=?, hidden=?, hp_est=? WHERE id=?'), stat = { ok: 0, hidden: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const c of rows) {
      const x = turnkeyFor(c, { company, cbr });
      if (x.turnkey) stat.ok++; else stat[x.note] = (stat[x.note] || 0) + 1;
      const hide = c.price_kind === 'start' || isHiddenChina(c) || isHiddenUae(c) || isHiddenByPower(c, x.turnkey, c.hp || (x.hpEst >= 180 ? x.hpEst : null)) ? 1 : 0; // Лот со стартовой ценой показывать нечем: это не цена машины.
      stat.hidden += hide;
      up.run(x.turnkey ?? null, x.breakdown ? JSON.stringify(x.breakdown) : null, x.note ?? null, hide, x.hpEst ?? null, c.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return stat;
}

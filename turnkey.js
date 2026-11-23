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

// rates: { company: {код: ₽ за единицу}, cbr: {код: ₽ за единицу} }
export function turnkeyFor(c, { company, cbr }, now = new Date()) {
  if (isPickup(c)) return { note: 'pickup' };
  const t = target(c, cbr);
  if (t.note) return { note: t.note };
  if (!c.year) return { note: 'specs' };
  const s = scheme(t.id), electric = ['electric', 'series'].includes(engineType(c));
  const duty = customs({ priceRub: t.price * cbr[s.cur], eurRate: cbr.EUR, age: ageBand(c.year, now), cc: electric ? c.volume_cc || 0 : c.volume_cc, hp: c.hp, fuel: engineType(c) });
  if (!duty.ok) return { note: duty.reason };
  const input = { price: t.price, rate: company[s.cur], customs: duty.total };
  let r = compute(t.id, { ...input, commission: COMMISSION });
  if (r.total >= THRESHOLD) r = compute(t.id, { ...input, commission: COMMISSION_HIGH });
  return { turnkey: Math.round(r.total), breakdown: { scheme: s.name, engine: engineType(c), route: r.route, lines: r.lines, customs: { duty: duty.duty, fee: duty.fee, util: duty.util, excise: duty.excise, vat: duty.vat } } };
}

export function recomputeTurnkey(db) {
  const rates = db.prepare('SELECT * FROM rates').all(), eff = Object.fromEntries(db.prepare('SELECT * FROM effective').all().map(r => [r.key, r.per_unit]));
  const cbr = Object.fromEntries(rates.map(r => [r.code, r.value / r.nominal]));
  if (!cbr.EUR || !eff.KRW) return null;
  const company = { USD: eff.USD, CNY: eff.CNY, JPY: eff.JPY, KRW: eff.KRW };
  const rows = db.prepare(`SELECT id,country,brand,model,trim,year,fuel,volume_cc,hp,body,price,currency,price_kind,chassis FROM listings WHERE active=1 AND source<>'kyrgyz'`).all();
  const up = db.prepare('UPDATE listings SET turnkey=?, breakdown=?, turnkey_note=? WHERE id=?'), stat = { ok: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const c of rows) {
      const x = turnkeyFor(c, { company, cbr });
      if (x.turnkey) stat.ok++; else stat[x.note] = (stat[x.note] || 0) + 1;
      up.run(x.turnkey ?? null, x.breakdown ? JSON.stringify(x.breakdown) : null, x.note ?? null, c.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return stat;
}

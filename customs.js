// Ставки для физлиц, личное пользование, 2026 год. Сверено с calcus.ru/rastamozhka-auto 23.11.2026.
const FEES = [[200000, 1231], [450000, 2462], [1200000, 4924], [2700000, 13541], [4200000, 18465], [5500000, 21344], [10000000, 49240], [Infinity, 73860]];
const UNDER3 = [[8500, 0.54, 2.5], [16700, 0.48, 3.5], [42300, 0.48, 5.5], [84500, 0.48, 7.5], [169000, 0.48, 15], [Infinity, 0.48, 20]];
const CC = [1000, 1500, 1800, 2300, 3000, Infinity];
const AGE_3_5 = [1.5, 1.7, 2.5, 2.7, 3, 3.6];
const AGE_5P = [3, 3.2, 3.5, 4.8, 5, 5.7];
const UTIL_BASE = 20000, UTIL_YOUNG = 0.17, UTIL_OLD = 0.26, EV_DUTY = 0.15, VAT = 0.22;
const EXCISE = [[90, 0], [150, 64], [200, 613], [300, 1004], [400, 1711], [500, 1771], [Infinity, 1829]];
const HP = [160, 190, 220, 250, 280, 310, 340, 370, 400, 430, 460, 500, Infinity];
const EV_HP = [80, 100, 130, 160, 190, 220, 250, 280, Infinity];
// Коэффициенты [до 3 лет, старше 3 лет] по строкам мощности HP.
const UTIL_ICE = [
  [1000, [[14.88, 27.6], [15.36, 28.43], [15.84, 29.28], [16.2, 30.12], [17.28, 30.12], [17.28, 30.12], [17.28, 30.12], [17.28, 30.12], [17.28, 30.12], [17.28, 30.12], [17.28, 30.12], [17.28, 30.12], [17.28, 30.12]]],
  [2000, [[40.04, 70.44], [45, 74.64], [47.64, 79.2], [50.52, 83.88], [57.12, 91.92], [64.56, 100.56], [72.96, 110.16], [83.16, 120.6], [94.8, 132], [108, 144.6], [123.24, 158.4], [140.4, 173.4], [160.08, 189.84]]],
  [3000, [[112.52, 170.36], [115.34, 172.8], [118.2, 175.08], [120.12, 177.6], [126, 183], [131.04, 188.52], [136.32, 193.68], [141.72, 199.08], [147.48, 204.72], [153.36, 210.48], [159.48, 216.36], [165.84, 222.36], [172.44, 228.6]]],
  [3500, [[129.2, 197.81], [131.76, 200.04], [134.4, 202.2], [137.16, 204.36], [140.52, 207.24], [144, 212.4], [151.92, 217.8], [160.32, 224.28], [169.2, 231], [178.44, 237.96], [188.28, 245.04], [198.6, 252.48], [209.52, 260.04]]],
  [Infinity, [[164.53, 216.29], [167.28, 219.48], [170.16, 222.84], [173.04, 226.2], [176.52, 231.36], [180, 236.64], [186.36, 249.6], [192.88, 263.4], [199.68, 277.92], [206.64, 293.16], [213.84, 309.36], [221.28, 326.4], [229.08, 344.28]]],
];
const UTIL_EV = [[40.04, 70.44], [49.56, 82.08], [65.88, 95.64], [78, 111.36], [92.4, 129.72], [109.68, 151.2], [129.96, 176.16], [153.96, 205.2], [182.4, 239.04]];

export const clearanceFee = rub => FEES.find(([max]) => rub <= max)[1];

export function duty({ priceEur, age, cc }) {
  if (age === 'under3') {
    const [, pct, min] = UNDER3.find(([max]) => priceEur <= max);
    return Math.max(priceEur * pct, cc * min);
  }
  const i = CC.findIndex(max => cc <= max);
  return cc * (age === '3to5' ? AGE_3_5 : AGE_5P)[i];
}

export function utilFee({ age, cc, hp, electric }) {
  const k = age === 'under3' ? 0 : 1;
  if (electric) return Math.round(UTIL_BASE * (hp <= 80 ? [UTIL_YOUNG, UTIL_OLD][k] : UTIL_EV[EV_HP.findIndex(m => hp <= m)][k]));
  if (hp <= 160 && cc <= 3000) return Math.round(UTIL_BASE * [UTIL_YOUNG, UTIL_OLD][k]);
  return Math.round(UTIL_BASE * UTIL_ICE.find(([m]) => cc <= m)[1][HP.findIndex(m => hp <= m)][k]);
}

// fuel: electric и series (последовательный гибрид) считаются как электромобиль.
export function customs({ priceRub, eurRate, age, cc, hp, fuel, body }) {
  if (!(priceRub > 0) || !(eurRate > 0)) return { ok: false, reason: 'price' };
  if (body === 'pickup') return pickupCustoms({ priceRub, age, fuel, cc });
  const electric = fuel === 'electric' || fuel === 'series';
  if (!(hp > 0) || (!electric && !(cc > 0))) return { ok: false, reason: 'specs' };
  const fee = clearanceFee(priceRub), util = utilFee({ age, cc, hp, electric });
  if (electric) {
    const d = priceRub * EV_DUTY, excise = hp * EXCISE.find(([m]) => hp <= m)[1], vat = (priceRub + d + excise) * VAT;
    return { ok: true, duty: d, fee, util, excise, vat, total: d + fee + util + excise + vat };
  }
  const d = duty({ priceEur: priceRub / eurRate, age, cc }) * eurRate;
  return { ok: true, duty: d, fee, util, excise: 0, vat: 0, total: d + fee + util };
}

// Пикап ввозится как грузовой N1 (полная масса 2,5–3,5 т): пошлина 10% дизель, 15% бензин и гибрид, без акциза, НДС 22% с цены и пошлины,
// утильсбор 150 000 ₽ × 6,6 до 3 лет и × 9,61 старше (утилка.онлайн по постановлению № 1291, расчёты Дрома, 26.11.2026). Мощность и объём не нужны.
// Кей-грузовики Японии (объём до 1 л) легче 2,5 т: 150 000 ₽ × 6,13 и × 8,91.
export const PICKUP_UTIL = { under3: 990000, older: 1441500, lightUnder3: 919500, lightOlder: 1336500 };
export function pickupCustoms({ priceRub, age, fuel, cc }) {
  const light = cc > 0 && cc <= 1000, young = age === 'under3';
  const d = priceRub * (fuel === 'diesel' ? 0.10 : 0.15), fee = clearanceFee(priceRub), vat = (priceRub + d) * VAT;
  const util = light ? (young ? PICKUP_UTIL.lightUnder3 : PICKUP_UTIL.lightOlder) : young ? PICKUP_UTIL.under3 : PICKUP_UTIL.older;
  return { ok: true, duty: d, fee, util, excise: 0, vat, total: d + fee + util + vat, pickup: true };
}

export function ageBand(year, now = new Date()) {
  const a = now.getFullYear() - year;
  return a < 3 ? 'under3' : a <= 5 ? '3to5' : 'over5';
}

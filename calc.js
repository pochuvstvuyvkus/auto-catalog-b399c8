// Формулы перенесены из таблицы калькуляторов. Общий модуль для браузера и тестов.
const DOCS = 'ЭПТС, СБКТС, услуги брокера, СВХ, временная регистрация';
const DOCS_PRR = 'ЭПТС, СБКТС, ПРР, услуги брокера, СВХ, временная регистрация';
const DOCS_TRUCK = `${DOCS}, автовоз Уссурийск-Владивосток`;

export const SCHEMES = [
  { id: 'kr', country: 'kr', name: 'Корея', cur: 'KRW', price: 10000000, abroad: 2200000, docs: 150000, docsLabel: DOCS_PRR, payMarkup: true, city: 'Владивосток' },
  { id: 'cn', country: 'cn', name: 'Китай', cur: 'CNY', price: 100000, abroad: 23900, docs: 160000, docsLabel: DOCS_TRUCK, bankInfo: 0.02, bankBase: 'all', bankName: 'ВТБ', city: 'Владивосток' },
  { id: 'cn_suifenhe', country: 'cn', name: 'Китай, новые, Суйфуньхэ', cur: 'CNY', price: 136121, abroad: 19900, docs: 160000, docsLabel: DOCS_TRUCK, bankIncluded: 0.025, bankName: 'ВТБ', payMarkup: true, city: 'Владивосток' },
  { id: 'cn_khorgos', country: 'cn', name: 'Китай, новые, Хоргос', cur: 'CNY', price: 150100, abroad: 19900, docs: 160000, docsLabel: `${DOCS}, эвакуатор`, bankIncluded: 0.025, bankName: 'ВТБ', logistics: true, city: 'Владивосток' },
  { id: 'jp', country: 'jp', name: 'Япония', cur: 'JPY', price: 3473000, abroad: 215000, docs: 90000, docsLabel: DOCS_PRR, bankInfo: 0.015, bankBase: 'all', bankName: 'АТБ', city: 'Владивосток' },
  { id: 'jp_s_low', country: 'jp', name: 'Япония, санкционные, до 2 млн ¥', route: 'Япония, Корея, РФ', cur: 'JPY', price: 1900000, abroad: 880000, docs: 90000, docsLabel: DOCS_PRR, rateMarkup: 0.03, city: 'Владивосток' },
  { id: 'jp_s_high', country: 'jp', name: 'Япония, санкционные, от 2 млн ¥', route: 'Япония, Корея, РФ', cur: 'JPY', price: 16040000, abroad: p => 680000 + p * 0.1, docs: 90000, docsLabel: DOCS_PRR, rateMarkup: 0.03, city: 'Владивосток' },
  { id: 'ae', country: 'ae', name: 'ОАЭ', cur: 'USD', price: 13500, uae: true, abroad: 2900, docs: 190000, docsLabel: 'ЭПТС, СБКТС, ПРР, услуги брокера, СВХ, временная регистрация', rf: 150000, commission: 60000, transferFee: 0.02, city: 'Астрахань' },
];

export const PAY_MARKUPS = [
  { id: 'none', label: 'Без надбавки', value: 0 },
  { id: 'msk', label: 'Москва/СПб +1,5%', value: 0.015 },
  { id: 'reg', label: 'Регионы +2,5%', value: 0.025 },
];

export const scheme = id => SCHEMES.find(s => s.id === id);
export const defaultAbroad = (s, price) => (typeof s.abroad === 'function' ? s.abroad(price) : s.abroad ?? 0);
export const commissionFor = (rub, threshold = 5000000, low = 60000, high = 100000) => (rub >= threshold ? high : low);

export function compute(id, input) {
  const s = scheme(id);
  if (!s) throw new Error(`Неизвестная схема: ${id}`);
  const n = (v, d = 0) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
  const price = n(input.price);
  const baseRate = n(input.rate);
  const customs = n(input.customs);
  const commission = n(input.commission, s.commission ?? 60000);
  if (s.uae) return computeUae(s, { price, rate: baseRate, customs, commission, abroad: n(input.abroad, s.abroad), rf: n(input.rf, s.rf), docs: n(input.docs, s.docs) });

  const markup = s.payMarkup ? (PAY_MARKUPS.find(m => m.id === input.payMarkup)?.value ?? 0) : 0;
  const rate = baseRate * (1 + markup) * (1 + (s.rateMarkup ?? 0));
  const abroad = n(input.abroad, defaultAbroad(s, price));
  const bankIncl = s.bankIncluded ? price * s.bankIncluded : 0;
  const invoice = price + abroad + bankIncl;
  const invoiceRub = invoice * rate;
  const docs = n(input.docs, s.docs);
  const logistics = s.logistics ? n(input.logistics) : 0;
  const russia = customs + docs + logistics + commission;
  const total = invoiceRub + russia;

  const lines = [
    { label: 'Цена авто', value: price, cur: s.cur },
    { label: 'Расходы в стране', value: abroad, cur: s.cur },
  ];
  if (bankIncl) lines.push({ label: `Комиссия банка ${s.bankName} ${pct(s.bankIncluded)}`, value: bankIncl, cur: s.cur });
  lines.push({ label: 'Итого за рубежом', value: invoice, cur: s.cur, strong: true });
  lines.push({ label: 'Итого за рубежом', value: invoiceRub, cur: 'RUB', strong: true });
  lines.push({ label: 'Таможенные платежи', value: customs, cur: 'RUB' });
  lines.push({ label: s.docsLabel, value: docs, cur: 'RUB' });
  if (s.logistics) lines.push({ label: 'Логистика до Москвы', value: logistics, cur: 'RUB' });
  lines.push({ label: 'Комиссия компании', value: commission, cur: 'RUB' });
  lines.push({ label: 'Итого в России', value: russia, cur: 'RUB', strong: true });

  const extra = [];
  if (s.bankInfo) extra.push({ label: `Комиссия банка ${s.bankName} ${pct(s.bankInfo)}, оплачивается отдельно`, value: invoice * s.bankInfo, cur: s.cur });
  extra.push({ label: 'Вклад в детский спорт', value: commission * 0.2, cur: 'RUB' });
  return { total, rate, lines, extra, route: s.route || null, totalLabel: `Итоговая цена, ${s.city}` };
}

// Лист «ОАЭ» таблицы калькуляторов (правка Василины 26.11): цена авто и расходы до Астрахани в долларах, комиссия за перевод 2% включена.
function computeUae(s, v) {
  const usd = v.price + v.abroad, rub = usd * v.rate, fee = rub * s.transferFee, shipped = rub + fee;
  const russia = v.customs + v.docs + v.rf + v.commission, total = shipped + russia;
  return {
    total, rate: v.rate, totalLabel: `Итоговая цена, ${s.city}`,
    lines: [
      { label: 'Автомобиль', value: v.price, cur: 'USD' },
      { label: 'Расходы до Астрахани: комиссия дилера, логистика по ОАЭ и страхование, экспортные документы, лицензия, логистика ОАЭ–РФ, учёт, стоянка', value: v.abroad, cur: 'USD' },
      { label: 'Итого', value: usd, cur: 'USD', strong: true },
      { label: 'Итого в рублях', value: rub, cur: 'RUB' },
      { label: `Комиссия за перевод ${pct(s.transferFee)}`, value: fee, cur: 'RUB' },
      { label: 'Автомобиль с отправкой', value: shipped, cur: 'RUB', strong: true },
      { label: 'Таможенные платежи', value: v.customs, cur: 'RUB' },
      { label: s.docsLabel, value: v.docs, cur: 'RUB' },
      { label: 'Расходы в РФ: портовые, ПРР, документация, повторный осмотр', value: v.rf, cur: 'RUB' },
      { label: 'Комиссия компании', value: v.commission, cur: 'RUB' },
      { label: 'Итого в России', value: russia, cur: 'RUB', strong: true },
    ],
    extra: [{ label: 'Вклад в детский спорт', value: v.commission * 0.2, cur: 'RUB' }],
  };
}

const pct = x => `${String(+(x * 100).toFixed(2)).replace('.', ',')}%`;

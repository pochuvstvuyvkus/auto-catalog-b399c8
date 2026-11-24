// Япония: санкционные авто считаются отдельно и идут через Корею.
// Список мягких гибридов прислан отделом (обновлён 24.11: Fronx, Audi A3 и Q3, новые кузова Golf): они остаются несанкционными.
const MILD = {
  Suzuki: 'MA37S MA36S FF21S ZC53S ZD53S MH95S MH55S MH44S MX91S MK94S MK54S MK53S MK42S HA97S MR92S MR52S MR41S MN71S WEB3S WDB3S',
  Mazda: 'MJ95S MJ55S MJ44S MS92S MS52S MS41S MM94S MM54S MM53S MM42S HB97S HB37S',
  Mitsubishi: 'MB37S MB36S B34A B37A B35A B38A B34W B37W B35W B38W',
  Nissan: 'B44W B47W B45W B48W B44A B47A B45A B48A',
  Honda: 'ZF1 ZF2 ZE2 ZE3 GP4 GP1 GP2 GP3',
  Volkswagen: 'CDDFY CDDFYV CDDLAV CDDLA',
  Audi: 'GYDLA F3DFY',
  'Mercedes-Benz': '205278 205278C 205277 205277C 205078C 205078 205077C 205077 238377C 213278C 213277 213077C 238477C 213078C',
};
const MILD_SET = Object.fromEntries(Object.entries(MILD).map(([b, s]) => [b, new Set(s.split(' '))]));
const HYBRID_ONLY = new Set(['Aqua', 'Prius', 'Prius Alpha', 'Sai']);
export const chassisCode = s => String(s ?? '').toUpperCase().trim().split('-').pop();
export const isMildHybrid = c => !!MILD_SET[c.brand]?.has(chassisCode(c.chassis));
export function isSanctioned(c) {
  if (c.country !== 'jp' || isMildHybrid(c)) return false;
  return c.volume_cc > 1800 || ['hybrid', 'electric'].includes(c.fuel) || HYBRID_ONLY.has(c.model) || /\b(HV|HYBRID|E-POWER|EV)\b/i.test(c.trim || '');
}
export const japanScheme = c => (isSanctioned(c) ? (c.price < 2000000 ? 'jp_s_low' : 'jp_s_high') : 'jp');

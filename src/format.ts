/**
 * Display formatting for balances/amounts: thousands separators, sensible
 * decimals (2 for values ≥ 1, up to 6 significant for dust amounts).
 * DISPLAY ONLY — never feed the output back into math or inputs.
 */
export function formatAmountDisplay(value: string | number | null | undefined): string {
  const num = Number.parseFloat(String(value ?? '0').replace(/,/g, ''));
  if (!Number.isFinite(num)) return String(value ?? '0');

  const abs = Math.abs(num);
  const decimals = abs !== 0 && abs < 1 ? 6 : 2;
  let [int, frac = ''] = num.toFixed(decimals).split('.');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (decimals > 2) frac = frac.replace(/0+$/, '') || '00';
  return frac ? `${int}.${frac}` : int;
}

/** "$1,234.56" — USD variant of formatAmountDisplay (always 2 decimals). */
export function formatUsdDisplay(value: string | number | null | undefined): string {
  const num = Number.parseFloat(String(value ?? '0').replace(/[$,]/g, ''));
  if (!Number.isFinite(num)) return '$0.00';
  const [int, frac] = num.toFixed(2).split('.');
  return `$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/** USD unit-price display that preserves meaningful precision for low prices. */
export function formatUsdPrice(value: string | number | null | undefined): string {
  const num = Number.parseFloat(String(value ?? '0').replace(/[$,]/g, ''));
  if (!Number.isFinite(num) || num <= 0) return 'No price';
  const decimals = Math.min(10, Math.max(2, Math.ceil(-Math.log10(num)) + 1));
  const text = num.toFixed(decimals).replace(/\.?(0+)$/, '');
  return `$${text}`;
}

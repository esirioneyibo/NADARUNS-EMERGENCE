/**
 * Centralised currency formatting. Single source of truth so changing locale
 * (e.g. Stockholm → Helsinki) only touches one file.
 */
export const CURRENCY_SYMBOL = "€";
export const CURRENCY_CODE = "EUR";

export function formatMoney(amount: number, opts?: { signed?: boolean; decimals?: number }): string {
  const decimals = opts?.decimals ?? 2;
  const abs = Math.abs(amount).toFixed(decimals);
  if (opts?.signed) {
    if (amount > 0) return `+${CURRENCY_SYMBOL}${abs}`;
    if (amount < 0) return `-${CURRENCY_SYMBOL}${abs}`;
  }
  return `${CURRENCY_SYMBOL}${abs}`;
}

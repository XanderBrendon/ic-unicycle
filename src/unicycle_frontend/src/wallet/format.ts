export function parseDecimalAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed === '.') return null;
  const match = /^(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return null;
  const whole = match[1] || '0';
  const frac = (match[2] ?? '').padEnd(decimals, '0').slice(0, decimals);
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0');
  } catch {
    return null;
  }
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fractional = abs % divisor;

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let out: string;
  if (decimals === 0 || fractional === 0n) {
    out = wholeStr;
  } else {
    const fracStr = fractional.toString().padStart(decimals, '0').replace(/0+$/, '');
    out = fracStr.length === 0 ? wholeStr : `${wholeStr}.${fracStr}`;
  }
  return negative ? `-${out}` : out;
}

/**
 * Splits `total` cents across `weights` in proportion, so the parts sum to `total` exactly.
 *
 * Largest remainder: every part is floored, and the cents that flooring lost go one each to the
 * parts that lost most, ties to the earliest. Rounding each part on its own is how an invoice's
 * lines come to disagree with its total by a cent, which is the discrepancy a customer's finance
 * team finds first. All weights zero spreads nothing and answers zeros — there is no fair share of
 * a charge nobody used.
 */
export function allocateCents(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + Math.max(0, weight), 0);
  if (sum === 0 || total <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (total * Math.max(0, weight)) / sum);
  const parts = exact.map((share) => Math.floor(share));
  let left = total - parts.reduce((acc, part) => acc + part, 0);
  const order = exact
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

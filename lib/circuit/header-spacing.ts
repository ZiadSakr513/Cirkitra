/** Widen tight horizontal headers while keeping their center in the same place. */
export function expandHorizontalHeader(
  x: number,
  count: number,
  spacing: number,
  minimumSpacing = 22,
): { x: number; spacing: number } {
  const nextSpacing = Math.max(spacing, minimumSpacing);
  return {
    x: x - Math.max(0, count - 1) * (nextSpacing - spacing) / 2,
    spacing: nextSpacing,
  };
}

export function getPdfCost(pages: number): number {
  if (pages <= 3) return 2;
  if (pages <= 5) return 3;
  if (pages <= 10) return 4;
  if (pages <= 20) return 7;
  return 10;
}

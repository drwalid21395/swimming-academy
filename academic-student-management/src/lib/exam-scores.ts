/** Splits a total exam score across its questions without losing points to rounding. */
export function distributeExamScores(totalScore: number, count: number): number[] {
  if (count <= 0) return [];

  const round = (value: number) => Math.round(value * 100) / 100;
  const base = Math.floor((totalScore / count) * 100) / 100;
  const scores = Array.from({ length: count }, () => base);
  let remainder = round(totalScore - base * count);

  for (let index = 0; index < count && remainder > 0; index += 1) {
    const add = Math.min(1, remainder);
    scores[index] = round(scores[index] + add);
    remainder = round(remainder - add);
  }

  return scores;
}

/** Compact summary of a distribution, e.g. "7 / 7 / 6". */
export function summarizeScores(scores: number[]): string {
  const parts: string[] = [];
  for (const score of scores) {
    const label = String(score);
    const last = parts[parts.length - 1];
    if (last && last.split(" × ")[1] === label) {
      const [value, count] = last.split(" × ");
      parts[parts.length - 1] = `${value} × ${Number(count) + 1}`;
    } else {
      parts.push(`${label} × 1`);
    }
  }
  return parts.join(" / ").replace(/ × 1/g, "");
}

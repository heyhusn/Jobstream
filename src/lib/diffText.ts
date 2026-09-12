export interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

/**
 * Minor m01's diff view. A plain LCS line diff — no library, since
 * resume text is small (a few hundred lines at most) and this app
 * has no diff dependency to reach for. O(n*m) time/space via the
 * classic DP table, which is fine at this size.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const n = linesA.length;
  const m = linesB.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        linesA[i] === linesB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (linesA[i] === linesB[j]) {
      result.push({ type: "same", text: linesA[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "removed", text: linesA[i] });
      i++;
    } else {
      result.push({ type: "added", text: linesB[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "removed", text: linesA[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: "added", text: linesB[j] });
    j++;
  }
  return result;
}

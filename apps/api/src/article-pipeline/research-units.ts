/**
 * Research units: the pieces a research step can be split into. Step 7
 * (facts for the questions people ask) splits by question; step 8 (facts for
 * the outline) splits by H2 heading. Shared by the grounded split fallback in
 * the step runner and the retrieval-first researcher.
 */
export function researchUnitsFor(stepNumber: number, completedSteps: Map<number, string>): string[] {
  if (stepNumber === 7) {
    const raw = completedSteps.get(6) ?? ''
    const qs = [...raw.matchAll(/"([^"\n]{12,200}\?)"/g)].map((m) => m[1].trim())
    return [...new Set(qs)]
  }
  const outline = completedSteps.get(4) ?? completedSteps.get(1) ?? ''
  const heads = outline
    .split(/\n/)
    .filter((l) => /^\s*(##\s|H2:)/i.test(l))
    .map((l) => l.replace(/^\s*##\s*|^\s*H2:\s*/i, '').trim())
    .filter((l) => l.length > 8 && l.length < 160)
  return [...new Set(heads)]
}

/** Group units for batched calls (B21: two per grounded split call halves the fee). */
export function batchUnits(units: string[], size: number): string[][] {
  const out: string[][] = []
  for (let i = 0; i < units.length; i += size) out.push(units.slice(i, i + size))
  return out
}

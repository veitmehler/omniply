/**
 * Mermaid label lint (Veit 2026-09-18): the diagram-writing LLM sometimes
 * emits bare Pascal/camelCase identifiers with no display label
 * (`HipsBelowKnees`, state diagrams without `state "..." as X`), so renders
 * show machine identifiers — and every downstream layer (raster, AI restyle)
 * faithfully reproduces them verbatim. Live example: run-5 article diagram 3.
 *
 * Deterministic auto-repair, applied right after generation so ALL consumers
 * inherit clean text. Never rewrites text the model actually labeled — only
 * derives display labels for label-LESS camelCase IDs. The AI restyle layer
 * must never be given text-rewrite permission (hallucination channel), which
 * is why this fix lives here.
 */

/** "HipsBelowKnees" → "Hips below knees"; acronym runs survive ("USDAPlan" → "USDA plan"). */
export function splitCamelLabel(id: string): string {
  const spaced = id
    // boundary between an acronym run and a normal word: "USDAPlan" → "USDA Plan"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // lower/digit → Upper boundary: "HipsBelow" → "Hips Below", "Step2Plan" → "Step2 Plan"
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
  return spaced
    .split(' ')
    .map((w, i) => {
      if (/^[A-Z]{2,}\d*$/.test(w)) return w // keep acronyms
      return i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()
    })
    .join(' ')
}

/** Mixed-case single token with at least one lower→Upper boundary and no spaces. */
const BARE_CAMEL = /^[A-Za-z][A-Za-z\d]*$/
function isBareCamel(id: string): boolean {
  return BARE_CAMEL.test(id) && /[a-z][A-Z]/.test(id)
}

const ID = String.raw`[A-Za-z][A-Za-z\d_]*`

/**
 * Repair a stateDiagram: any camelCase state referenced in transitions without
 * a `state "..." as X` display declaration gets one injected after the header.
 */
function repairStateDiagram(syntax: string): string {
  const declared = new Set<string>()
  for (const m of syntax.matchAll(new RegExp(String.raw`state\s+"[^"]*"\s+as\s+(${ID})`, 'g'))) {
    declared.add(m[1])
  }
  const referenced = new Set<string>()
  // Transition endpoints: `A --> B` (either side may be [*]).
  for (const m of syntax.matchAll(new RegExp(String.raw`(?:^|\s)(${ID})\s*-->`, 'gm'))) referenced.add(m[1])
  for (const m of syntax.matchAll(new RegExp(String.raw`-->\s*(${ID})`, 'g'))) referenced.add(m[1])

  const missing = [...referenced].filter((id) => id !== 'state' && !declared.has(id) && isBareCamel(id))
  if (!missing.length) return syntax

  const lines = syntax.split('\n')
  const headerIdx = lines.findIndex((l) => /^\s*stateDiagram/.test(l))
  if (headerIdx === -1) return syntax
  const indent = (lines[headerIdx + 1]?.match(/^\s*/) ?? ['    '])[0] || '    '
  const decls = missing.map((id) => `${indent}state "${splitCamelLabel(id)}" as ${id}`)
  lines.splice(headerIdx + 1, 0, ...decls)
  return lines.join('\n')
}

/**
 * Repair a flowchart/graph: a camelCase node that NEVER appears with a shape
 * label anywhere (`X[...]`, `X(...)`, `X{...}`, `X((...))`, `X>...]`) gets one
 * attached at its first bare occurrence.
 */
function repairFlowchart(syntax: string): string {
  const labeled = new Set<string>()
  for (const m of syntax.matchAll(new RegExp(String.raw`(${ID})\s*(?:\[|\(|\{|>)`, 'g'))) {
    labeled.add(m[1])
  }
  const referenced = new Set<string>()
  for (const m of syntax.matchAll(new RegExp(String.raw`(?:^|[\s&])(${ID})\s*(?:-->|---|-\.|==)`, 'gm'))) {
    referenced.add(m[1])
  }
  for (const m of syntax.matchAll(new RegExp(String.raw`(?:-->|---|\.->|==>|\|)\s*(${ID})(?=\s|$|;)`, 'gm'))) {
    referenced.add(m[1])
  }

  let out = syntax
  for (const id of referenced) {
    if (labeled.has(id) || !isBareCamel(id)) continue
    // Attach the label at the first occurrence of the bare id (word boundary,
    // not already followed by a shape opener).
    const re = new RegExp(String.raw`\b${id}\b(?!\s*[\[\(\{>])`)
    out = out.replace(re, `${id}[${splitCamelLabel(id)}]`)
  }
  return out
}

/**
 * Entry point: repairs flowchart/graph and stateDiagram syntaxes; any other
 * diagram type passes through unchanged. Never throws — on any internal
 * error the original syntax is returned (a rendered camelCase label beats a
 * lost diagram).
 */
export function repairBareLabels(syntax: string): string {
  try {
    const head = syntax
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('%%'))
    if (!head) return syntax
    if (/^stateDiagram/.test(head)) return repairStateDiagram(syntax)
    if (/^(flowchart|graph)\b/.test(head)) return repairFlowchart(syntax)
    return syntax
  } catch {
    return syntax
  }
}

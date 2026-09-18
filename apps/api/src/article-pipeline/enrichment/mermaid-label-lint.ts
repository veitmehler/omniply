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
 * Remove `|edge label|` spans before scanning for node references — the
 * target-side regex otherwise reads the first word INSIDE an edge label as a
 * node id (phantom "No" from `-->|No - Hip tight|`, found 2026-09-18 while
 * auditing a verify verdict). Edge-label TEXT is tallied separately from the
 * original string.
 */
function stripEdgeLabels(syntax: string): string {
  return syntax.replace(/\|[^|\n]*\|/g, ' ')
}

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
  const scan = stripEdgeLabels(syntax)
  const referenced = new Set<string>()
  for (const m of scan.matchAll(new RegExp(String.raw`(?:^|[\s&])(${ID})\s*(?:-->|---|-\.|==)`, 'gm'))) {
    referenced.add(m[1])
  }
  for (const m of scan.matchAll(new RegExp(String.raw`(?:-->|---|\.->|==>)\s*(${ID})(?=\s|$|;)`, 'gm'))) {
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

// ── Label inventory (Veit 2026-09-18) ────────────────────────────────────────
// Deterministic extraction of every display label from the mermaid source,
// with expected counts — the authoritative text ground truth handed to BOTH
// the restyle prompt (exact checklist) and the verify pass (compare against
// strings, not OCR of the source render).

export interface LabelCount {
  label: string
  count: number
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tally(map: Map<string, number>, label: string): void {
  const l = cleanLabel(label)
  if (!l) return
  map.set(l, (map.get(l) ?? 0) + 1)
}

/**
 * Extract every display label with its expected occurrence count.
 * Node labels count once per node; edge/transition labels once per edge.
 * Unknown diagram types return an empty inventory (callers then skip the
 * inventory block — behavior identical to before this feature).
 */
export function extractLabelInventory(syntax: string): LabelCount[] {
  try {
    const head = syntax
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('%%'))
    if (!head) return []
    const counts = new Map<string, number>()

    if (/^stateDiagram/.test(head)) {
      const declared = new Map<string, string>()
      for (const m of syntax.matchAll(new RegExp(String.raw`state\s+"([^"]+)"\s+as\s+(${ID})`, 'g'))) {
        declared.set(m[2], m[1])
      }
      const stateIds = new Set<string>()
      for (const m of syntax.matchAll(new RegExp(String.raw`(?:^|\s)(${ID})\s*-->`, 'gm'))) stateIds.add(m[1])
      for (const m of syntax.matchAll(new RegExp(String.raw`-->\s*(${ID})`, 'g'))) stateIds.add(m[1])
      stateIds.delete('state')
      for (const id of stateIds) tally(counts, declared.get(id) ?? id)
      // Transition labels: `A --> B: label`
      for (const m of syntax.matchAll(/-->\s*[A-Za-z[\]*][^:\n]*:\s*([^\n]+)/g)) tally(counts, m[1])
    } else if (/^(flowchart|graph)\b/.test(head)) {
      // Node shape labels — first definition wins per node id.
      const seen = new Set<string>()
      const shapeRe = new RegExp(
        String.raw`(${ID})\s*(\(\(|\(\[|\[\[|\[\(|\{\{|\[|\(|\{|>)\s*"?([^\])}"]+?)"?\s*(\)\)|\]\)|\]\]|\)\]|\}\}|\]|\)|\})`,
        'g',
      )
      for (const m of syntax.matchAll(shapeRe)) {
        if (seen.has(m[1])) continue
        seen.add(m[1])
        tally(counts, m[3])
      }
      // Bare camelCase nodes that never got a shape label display their id.
      // Scan a copy with |edge labels| stripped — otherwise the first word of
      // an edge label becomes a phantom node (the "No" false positive).
      const scan = stripEdgeLabels(syntax)
      const referenced = new Set<string>()
      for (const m of scan.matchAll(new RegExp(String.raw`(?:^|[\s&])(${ID})\s*(?:-->|---|-\.|==)`, 'gm'))) {
        referenced.add(m[1])
      }
      for (const m of scan.matchAll(new RegExp(String.raw`(?:-->|---|\.->|==>)\s*(${ID})(?=\s|$|;)`, 'gm'))) {
        referenced.add(m[1])
      }
      for (const id of referenced) if (!seen.has(id)) tally(counts, id)
      // Edge labels: `-->|text|` and `-- text -->`
      for (const m of syntax.matchAll(/\|\s*([^|\n]+?)\s*\|/g)) tally(counts, m[1])
      for (const m of syntax.matchAll(/--\s+([^-|>\n][^->\n]*?)\s+-->/g)) tally(counts, m[1])
    } else {
      return []
    }

    return [...counts.entries()].map(([label, count]) => ({ label, count }))
  } catch {
    return []
  }
}

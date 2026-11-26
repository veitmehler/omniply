/**
 * Core facts and reserve (author-voice plan, stage 2, section 3).
 *
 * Research still gathers and vets every fact. The writer used to be handed all
 * of them, 70 to 87 per article, and the article became a restatement of them.
 * Now a core set is chosen for this article and the writer sees only that; the
 * rest stays in reserve for the fact check and the later steps.
 *
 * A model proposes the core (it can read which fact answers which section and
 * which bears on the author's take). Code then makes the result safe: only real
 * fact numbers, nothing twice, warning signs always in, a ceiling per section
 * and per site, a floor per section, and a fallback when the model fails.
 */

export interface ResearchFact {
  /** Number shown to the selector; stable for one job. */
  id: number
  text: string
  /** The whole [Source: ...] tag as research wrote it, or '' for the author's own observation. */
  tag: string
  url: string
  host: string
  /** The heading research gathered this fact under. */
  unit: string
  figure: boolean
  safety: boolean
}

export interface CoreFacts {
  sections: Array<{ heading: string; facts: ResearchFact[] }>
  /** Warning signs and safety points the selector left out; they go in regardless. */
  safety: ResearchFact[]
  reserve: ResearchFact[]
}

export const CORE_LIMITS = { perSection: 4, perHost: 4, total: 26, extraSafety: 4, floorPerSection: 1 }

const SAFETY_RE =
  /\b(emergency|urgent(ly)?|immediately|right away|seek (medical |urgent |emergency )?(care|attention|help|advice)|red flags?|warning signs?|loss of (bladder|bowel)|bladder or bowel|numbness in the (groin|saddle|genital)|call (911|000|999|112|your doctor|an ambulance)|contraindicat\w+|should not (have|use|undergo|receive|be used)|not (safe|suitable|recommended) for|pregnan\w+|pacemaker|blood thinners?|seizures?|side effects?|adverse (events?|effects?))\b/i

/** A real figure, not the digits of a name such as L5, B12 or COVID-19. */
export function hasFigure(text: string): boolean {
  return /(?<![A-Za-z\d])(?<![A-Za-z]-)\d+(?:[.,]\d+)?\s*(%|percent|per cent|mg|g|kg|lb|lbs|ml|l|cm|mm|m|km|miles?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|times|sessions?|people|adults|patients|in \d+|out of|°|degrees|ATA|hz)(?![A-Za-z])/i.test(text) || /\b(one|two|three|four|five|six|seven|eight|nine|ten) (in|out of) (two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.test(text)
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The site a host belongs to, so subdomains count together (my.clevelandclinic.org and health.clevelandclinic.org). */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const twoPart = /^(co|com|org|net|gov|edu|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2
  return parts.slice(twoPart ? -3 : -2).join('.')
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Read the research outputs (FAQ facts and article facts) into one numbered list, without repeats. */
export function parseResearchFacts(...outputs: Array<string | undefined>): ResearchFact[] {
  const facts: ResearchFact[] = []
  const seen = new Set<string>()
  for (const out of outputs) {
    let unit = ''
    for (const line of (out ?? '').split('\n')) {
      const head = line.match(/^\s*\*\*(.+?)\*\*\s*$/) ?? line.match(/^\s*#{1,4}\s+(.+?)\s*$/)
      if (head) {
        unit = head[1].replace(/^H[1-3]:\s*/i, '').trim()
        continue
      }
      const m = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.+?)\s*$/)
      if (!m) continue
      const tagMatch = m[1].match(/\s*\[(Source:[^\]]*|OBS[^\]]*)\]\s*$/i)
      const text = (tagMatch ? m[1].slice(0, tagMatch.index) : m[1]).trim()
      if (text.split(/\s+/).length < 4) continue
      const k = key(text)
      if (seen.has(k)) continue
      seen.add(k)
      const tag = tagMatch ? tagMatch[0].trim() : ''
      const url = tag.match(/https?:\/\/[^\s,\]]+/)?.[0] ?? ''
      facts.push({ id: facts.length + 1, text, tag, url, host: hostOf(url), unit, figure: hasFigure(text), safety: SAFETY_RE.test(text) })
    }
  }
  return facts
}

/** The H2 headings of the outline, in order. */
export function outlineH2s(outline: string): string[] {
  const out: string[] = []
  for (const line of outline.split('\n')) {
    const m = line.match(/^\s*#{2,3}\s*H2:\s*(.+?)\s*$/i) ?? line.match(/^\s*##\s+(?!H[13]:)(.+?)\s*$/)
    if (m && !/^article outline/i.test(m[1])) out.push(m[1].replace(/\*+/g, '').trim())
  }
  return [...new Set(out)]
}

const tokens = (s: string) => new Set(key(s).split(' ').filter((w) => w.length > 3))
function overlap(a: string, b: string): number {
  const x = tokens(a)
  const y = tokens(b)
  if (!x.size || !y.size) return 0
  let n = 0
  for (const w of x) if (y.has(w)) n++
  return n / Math.min(x.size, y.size)
}

/** What the selector is shown: every fact with its number, grouped as research gathered it. */
export function factsForSelector(facts: ResearchFact[]): string {
  const lines: string[] = []
  let unit: string | null = null
  for (const f of facts) {
    if (f.unit !== unit) {
      unit = f.unit
      lines.push(`\n[${unit || 'General'}]`)
    }
    lines.push(`${f.id}. ${f.text}${f.host ? ` (${f.host})` : ' (the author\'s own observation)'}`)
  }
  return lines.join('\n').trim()
}

export function parseSelection(raw: string): Array<{ heading: string; facts: number[] }> {
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { sections?: unknown }
    if (!Array.isArray(j.sections)) return []
    return (j.sections as Array<Record<string, unknown>>).map((s) => ({
      heading: String(s.heading ?? '').trim(),
      facts: Array.isArray(s.facts) ? (s.facts as unknown[]).map((x) => Number(x)).filter((n) => Number.isInteger(n)) : [],
    }))
  } catch {
    return []
  }
}

/** Best unused facts for a heading: nearest in subject, figures first. */
function nearest(heading: string, pool: ResearchFact[], n: number): ResearchFact[] {
  return pool
    .map((f) => ({ f, s: Math.max(overlap(heading, f.unit), overlap(heading, f.text) * 0.8) + (f.figure ? 0.05 : 0) }))
    .filter((x) => x.s > 0.2)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.f)
}

/**
 * Turn the selector's picks into the core set. Every rule that must hold is
 * enforced here, so a poor or missing selection still gives a usable core.
 */
export function selectCore(facts: ResearchFact[], picks: Array<{ heading: string; facts: number[] }>, h2s: string[], limits = CORE_LIMITS): CoreFacts {
  const byId = new Map(facts.map((f) => [f.id, f]))
  const used = new Set<number>()
  const perSite = new Map<string, number>()
  const take = (f: ResearchFact): boolean => {
    if (used.has(f.id)) return false
    const site = siteOf(f.host)
    if (site && (perSite.get(site) ?? 0) >= limits.perHost) return false
    used.add(f.id)
    if (site) perSite.set(site, (perSite.get(site) ?? 0) + 1)
    return true
  }

  const headings = h2s.length ? h2s : picks.map((p) => p.heading).filter(Boolean)
  const sections = headings.map((heading) => ({ heading, facts: [] as ResearchFact[] }))
  const sectionFor = (heading: string) => sections.find((s) => key(s.heading) === key(heading)) ?? [...sections].sort((a, b) => overlap(b.heading, heading) - overlap(a.heading, heading))[0]

  for (const p of picks) {
    const sec = sectionFor(p.heading)
    if (!sec) continue
    for (const id of p.facts) {
      const f = byId.get(id)
      if (f && sec.facts.length < limits.perSection && take(f)) sec.facts.push(f)
    }
  }

  // Floor: a section the selector left empty gets the nearest fact research has for it.
  for (const sec of sections) {
    if (sec.facts.length >= limits.floorPerSection) continue
    const want = picks.length ? limits.floorPerSection : Math.min(3, limits.perSection)
    for (const f of nearest(sec.heading, facts.filter((x) => !used.has(x.id)), want * 3)) {
      if (sec.facts.length >= want) break
      if (take(f)) sec.facts.push(f)
    }
  }

  // Ceiling for the whole article: drop from the fullest sections first, never a warning sign, a figure last.
  const count = () => sections.reduce((n, s) => n + s.facts.length, 0)
  while (count() > limits.total) {
    const fullest = [...sections].sort((a, b) => b.facts.length - a.facts.length)[0]
    if (fullest.facts.length <= limits.floorPerSection) break
    const idx = [...fullest.facts.keys()].reverse().find((i) => !fullest.facts[i].safety && !fullest.facts[i].figure) ?? [...fullest.facts.keys()].reverse().find((i) => !fullest.facts[i].safety)
    if (idx === undefined) break
    used.delete(fullest.facts[idx].id)
    fullest.facts.splice(idx, 1)
  }

  // Warning signs and safety points always go in.
  const safety: ResearchFact[] = []
  for (const f of facts) {
    if (!f.safety || used.has(f.id) || safety.length >= limits.extraSafety) continue
    used.add(f.id)
    safety.push(f)
  }

  return { sections, safety, reserve: facts.filter((f) => !used.has(f.id)) }
}

/** The core as the writer reads it: by section, each fact with its source tag, as research wrote it. */
export function renderCore(core: CoreFacts): string {
  const out: string[] = []
  let n = 0
  for (const s of core.sections) {
    if (!s.facts.length) continue
    out.push(`**${s.heading}**`)
    for (const f of s.facts) out.push(`${++n}. ${f.text}${f.tag ? ` ${f.tag}` : ''}`)
    out.push('')
  }
  if (core.safety.length) {
    out.push('**Warning signs and safety points (place each where it belongs)**')
    for (const f of core.safety) out.push(`${++n}. ${f.text}${f.tag ? ` ${f.tag}` : ''}`)
  }
  return out.join('\n').trim() || '(research returned no usable facts for this article)'
}

export function coreStats(core: CoreFacts): { core: number; reserve: number; sites: number; emptySections: number } {
  const all = [...core.sections.flatMap((s) => s.facts), ...core.safety]
  return { core: all.length, reserve: core.reserve.length, sites: new Set(all.map((f) => siteOf(f.host)).filter(Boolean)).size, emptySections: core.sections.filter((s) => !s.facts.length).length }
}

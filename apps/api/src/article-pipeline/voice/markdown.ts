/**
 * The writer's markdown as body HTML (author-voice plan, stage 2).
 *
 * The correction step used to hand the whole draft to a model, which converted
 * it to HTML and rewrote it under the full rule set on the way. In the voice
 * path only flagged sentences are changed, so the conversion is done here, in
 * code, and cannot touch the wording.
 *
 * Covers what the writer is allowed to produce: H2 and H3 headings, paragraphs,
 * bullet and numbered lists, bold and italic. Anything else stays as text.
 */

const esc = (s: string) => s.replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(“"'])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?”"']|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(“"'])_([^_\s][^_\n]*?)_(?=[\s).,;:!?”"']|$)/g, '$1<em>$2</em>')
    .trim()
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`)
    list = null
  }
  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    const h = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (h) {
      flushPara()
      flushList()
      // No H1 in a body (the title is set elsewhere); deeper levels fold into H3.
      const level = h[1].length <= 2 ? 2 : 3
      out.push(`<h${level}>${inline(h[2].replace(/^\*\*(.+)\*\*$/, '$1'))}</h${level}>`)
      continue
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara()
      flushList()
      continue
    }
    const ul = line.match(/^\s*[-*+]\s+(.+)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (ul || ol) {
      flushPara()
      const type = ul ? 'ul' : 'ol'
      if (list && list.type !== type) flushList()
      if (!list) list = { type, items: [] }
      list.items.push((ul ?? ol)![1])
      continue
    }
    if (list && /^\s{2,}\S/.test(rawLine)) {
      // a wrapped line of the item above
      list.items[list.items.length - 1] += ' ' + line.trim()
      continue
    }
    flushList()
    para.push(line.replace(/^\s*>\s?/, '').trim())
  }
  flushPara()
  flushList()
  return out.join('\n')
}

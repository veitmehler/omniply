/**
 * Reverse-mapping for the review WYSIWYG: turns edited preview DOM (rendered,
 * normalized email HTML) back into the canonical section JSON the generator
 * stores — so a re-render reproduces exactly what was edited.
 */

/** Bullet/numbered line divs (render's normalizeBodyLists output) → ul/ol. */
export function unnormalizeBody(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')!

  const isGlyphLine = (el: Element): 'bullet' | 'number' | null => {
    if (el.tagName !== 'DIV') return null
    const first = el.firstElementChild
    if (!first || first.tagName !== 'SPAN') return null
    const t = (first.textContent ?? '').trim()
    if (t === '•') return 'bullet'
    if (/^\d+\.$/.test(t)) return 'number'
    return null
  }
  const lineContent = (el: Element): string => {
    const clone = el.cloneNode(true) as Element
    clone.firstElementChild?.remove() // the glyph span
    return clone.innerHTML.replace(/^(&nbsp;|\s)+/, '').trim()
  }

  // Group consecutive glyph-line divs (possibly nested one level in a wrapper
  // div) into ul/ol.
  const containers: Element[] = [root, ...Array.from(root.children).filter((c) => c.tagName === 'DIV')]
  for (const container of containers) {
    const kids = Array.from(container.children)
    let run: Element[] = []
    let runKind: 'bullet' | 'number' | null = null
    const flush = () => {
      if (!run.length || !runKind) return
      const list = doc.createElement(runKind === 'bullet' ? 'ul' : 'ol')
      for (const lineEl of run) {
        const li = doc.createElement('li')
        li.innerHTML = lineContent(lineEl)
        list.appendChild(li)
      }
      run[0].before(list)
      run.forEach((el) => el.remove())
      run = []
      runKind = null
    }
    for (const kid of kids) {
      const kind = isGlyphLine(kid)
      if (kind && (runKind === null || runKind === kind)) {
        runKind = kind
        run.push(kid)
      } else {
        flush()
        if (kind) {
          runKind = kind
          run.push(kid)
        }
      }
    }
    flush()
  }
  return root.innerHTML
}

/** Rendered list container (bulletList / bulletizeLines output) → plain lines. */
export function extractLines(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')!
  const markers = root.querySelectorAll('[data-nl-line-text]')
  const source = markers.length ? Array.from(markers) : Array.from(root.querySelectorAll('div'))
  return source
    .map((el) => (el.textContent ?? '').replace(/^\s*(?:•|\d+\.)\s*/, '').trim())
    .filter(Boolean)
}

/** Rendered ingredient/instruction container → canonical ul/ol HTML. */
export function linesToList(html: string, ordered: boolean): string {
  const lines = extractLines(html)
  if (!lines.length) return html
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag}>${lines.map((l) => `<li>${l}</li>`).join('')}</${tag}>`
}

export interface DirtyEdit {
  html: string
  text: string
}

/** Fold a map of `data-nl-section` edits into a PATCH payload. */
export function buildSectionPatch(
  dirty: Record<string, DirtyEdit>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const top = (key: string): Record<string, unknown> => {
    if (!patch[key]) patch[key] = JSON.parse(JSON.stringify(current[key] ?? {}))
    return patch[key] as Record<string, unknown>
  }
  for (const [section, edit] of Object.entries(dirty)) {
    const parts = section.split('.')
    if (parts[0] === 'featureArticle' || parts[0] === 'secondaryArticle') {
      const t = top(parts[0])
      if (parts[1] === 'title') t.title = edit.text.trim()
      else if (parts[1] === 'tldr') t.tldr = edit.text.replace(/^\s*TL;DR:\s*/i, '').trim()
      else if (parts[1] === 'body') t.body = unnormalizeBody(edit.html)
    } else if (parts[0] === 'teasers') {
      if (!patch.teasers) patch.teasers = JSON.parse(JSON.stringify(current.teasers ?? []))
      const arr = patch.teasers as Record<string, unknown>[]
      const i = Number(parts[1])
      if (!arr[i]) continue
      if (parts[2] === 'headline') arr[i].headline = edit.text.trim()
      else if (parts[2] === 'body') arr[i].body = unnormalizeBody(edit.html)
    } else if (parts[0] === 'quickHits') {
      const t = top('quickHits')
      if (parts[1] === 'tips') t.tips = extractLines(edit.html)
      else if (parts[1] === 'facts') t.facts = extractLines(edit.html)
    } else if (parts[0] === 'fun') {
      const t = top('fun')
      t[parts[1]] = edit.text.trim()
    } else if (parts[0] === 'modules') {
      const t = top('modules')
      const rec = (t[parts[1]] ?? {}) as Record<string, unknown>
      if (parts[2] === 'intro') rec.intro = unnormalizeBody(edit.html)
      else if (parts[2] === 'ingredients') rec.ingredients = linesToList(edit.html, false)
      else if (parts[2] === 'instructions') rec.instructions = linesToList(edit.html, true)
      t[parts[1]] = rec
    }
  }
  return patch
}

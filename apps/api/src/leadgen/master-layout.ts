/**
 * Master lead-magnet layout (leadgen master-library plan Phases A+B).
 *
 * One professionally-styled A4 print layout shared by every master document.
 * Content pours into <slot> elements; branding pours into {{brand.*}} tokens at
 * compile time. v2 adds the drafted documents' real structure: cover checklist,
 * part headers, inline-SVG figures, 2-up How/Why stretch cards, a reader-offer
 * box and a contact block whose optional lines (opening hours, …) are DROPPED
 * by the compiler when the token is empty (`data-optional` convention).
 *
 * Design rules the compiler relies on:
 *  - fixed typography/spacing — the LLM never touches layout, only slot text;
 *  - "How:" instructions and warning lists are NOT slots (frozen verbatim);
 *  - every page carries the footer contact strip (position: fixed in print);
 *  - elements with data-optional="<tokenKey>" are removed when the brand token
 *    is empty — never render empty labels;
 *  - print CSS with explicit page breaks between cover / content / back page.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Inline a repo-bundled SVG asset (seed-time only — templates ship self-contained). */
export function loadAsset(name: string): string {
  const file = path.join(__dirname, 'assets', `${name}.svg`)
  return fs
    .readFileSync(file, 'utf8')
    .replace(/<\?xml[^>]*\?>/, '')
    .trim()
}

export interface FigureRef {
  /** Asset basename in apps/api/src/leadgen/assets (no extension). */
  asset: string
  caption?: string
}

export interface MasterSection {
  heading: string
  slotName: string
  defaultHtml: string // paragraphs/lists; becomes the slot's neutral text
  /** Optional highlighted tip box below the section body. */
  tipHtml?: string
  /** Optional full-width illustration above the body. */
  figure?: FigureRef
  /** Frozen verbatim content below the body (warning lists, instructions). */
  frozenHtml?: string
  /** Skip the numbered circle (framework/summary sections the drafts don't number). */
  unnumbered?: boolean
}

/** 2-up exercise card: figure + frozen "How:" steps + rewriteable "Why it works". */
export interface StretchCard {
  heading: string
  slotName: string
  figure: FigureRef
  howHtml: string // FROZEN — never a slot
  whyHtml: string // slot `${slotName}_why`
}

export type MasterBlock =
  | { kind: 'part'; title: string; ledeHtml?: string; num?: number; startOnNewPage?: boolean }
  | ({ kind: 'section' } & MasterSection)
  | { kind: 'stretchGrid'; cards: StretchCard[] }

export interface MasterDocSpec {
  title: string
  subtitle: string
  /** Cover eyebrow; defaults to "A free guide from" (org name always follows). */
  eyebrow?: string
  /** Cover illustration asset (rendered inside a white panel on the brand cover). */
  coverAsset?: string
  /** "Inside this guide" ✓-list — FROZEN (mirrors the figures/sections). */
  coverChecklist?: string[]
  /** Opening paragraph(s); every real master should provide this. */
  introHtml?: string
  /** v1 API (demo/simple masters): flat sections. */
  sections?: MasterSection[]
  /** v2 API: ordered rich blocks. Takes precedence over `sections`. */
  blocks?: MasterBlock[]
  /** Back-page reader-offer box headline (offer text = {{brand.readerOffer}}). */
  offerHeadline?: string
  /** Compliance/disclaimer text — ALWAYS rewriteEligible: false. */
  disclaimerHtml: string
}

const esc = (s: string) => s.replace(/</g, '&lt;')

function figureHtml(f: FigureRef): string {
  return `<figure class="doc-figure">${loadAsset(f.asset)}${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}</figure>`
}

function sectionHtml(s: MasterSection, num: number | null): string {
  return `
    <section class="content-section">
      <div class="section-head"><h2>${num !== null ? `<span class="section-num">${num}</span>` : ''}${esc(s.heading)}</h2>
      ${s.figure ? figureHtml(s.figure) : ''}</div>
      <div class="section-body"><slot name="${s.slotName}">${s.defaultHtml}</slot></div>
      ${s.frozenHtml ? `<div class="section-body frozen">${s.frozenHtml}</div>` : ''}
      ${s.tipHtml ? `<aside class="tip-box"><span class="tip-label">Quick tip</span><slot name="${s.slotName}_tip">${s.tipHtml}</slot></aside>` : ''}
    </section>`
}

function stretchCardHtml(c: StretchCard, num: number): string {
  return `
      <div class="stretch-card">
        <h3><span class="section-num">${num}</span>${esc(c.heading)}</h3>
        ${figureHtml(c.figure)}
        <div class="how"><span class="mini-label">How</span>${c.howHtml}</div>
        <div class="why"><span class="mini-label">Why it works</span><slot name="${c.slotName}_why">${c.whyHtml}</slot></div>
      </div>`
}

export function buildMasterHtml(spec: MasterDocSpec): string {
  const blocks: MasterBlock[] =
    spec.blocks ?? (spec.sections ?? []).map((s) => ({ kind: 'section' as const, ...s }))

  let num = 0
  const body = blocks
    .map((b) => {
      if (b.kind === 'part') {
        const cls = `part-title${b.num !== undefined ? ' part-numbered' : ''}${b.startOnNewPage ? ' part-break' : ''}`
        const numeral = b.num !== undefined ? `<span class="section-num part-num">${b.num}</span>` : ''
        return `<h2 class="${cls}">${numeral}${esc(b.title)}</h2>${b.ledeHtml ? `<div class="section-body part-lede">${b.ledeHtml}</div>` : ''}`
      }
      if (b.kind === 'stretchGrid')
        // Cards number locally (1..n) under their part title — a grid titled
        // "the 6-stretch reset" must not open with card 4 (user decision).
        return `<div class="stretch-grid">${b.cards.map((c, i) => stretchCardHtml(c, i + 1)).join('\n')}</div>`
      return sectionHtml(b, b.unnumbered ? null : ++num)
    })
    .join('\n')

  const checklist = spec.coverChecklist?.length
    ? `<ul class="cover-checklist">${spec.coverChecklist.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : ''

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: {{brand.fontColor}}; }

  /* ── Cover ── */
  .cover { height: 297mm; background: {{brand.headerColor}}; color: #fff; display: flex; flex-direction: column; justify-content: space-between; padding: 24mm 22mm; page-break-after: always; }
  .cover .logo img { max-height: 22mm; max-width: 60mm; }
  .cover .logo-fallback { font-size: 20px; font-weight: 700; letter-spacing: .5px; }
  .cover .eyebrow { font-size: 12px; letter-spacing: 2.2px; text-transform: uppercase; opacity: .85; margin-bottom: 5mm; }
  .cover h1 { font-size: 38px; line-height: 1.15; font-weight: 700; max-width: 150mm; }
  .cover .subtitle { margin-top: 6mm; font-size: 16px; line-height: 1.5; opacity: .92; max-width: 140mm; }
  .cover .accent-bar { width: 42mm; height: 2.5mm; background: {{brand.accentColor}}; margin: 8mm 0 0; border-radius: 2px; }
  .cover .cover-art { background: #fff; border-radius: 3mm; padding: 6mm; margin-top: 9mm; max-width: 128mm; }
  .cover .cover-art svg { width: 100%; height: auto; display: block; }
  .cover-checklist { list-style: none; margin-top: 8mm; font-size: 13.5px; line-height: 2; max-width: 140mm; }
  .cover-checklist li::before { content: '✓'; color: {{brand.accentColor}}; font-weight: 700; margin-right: 3mm; }
  .cover .cover-footer { font-size: 13px; opacity: .85; }

  /* ── Content pages ── */
  .content { padding: 0 22mm; }
  .part-title { color: {{brand.headerColor}}; font-size: 15px; text-transform: uppercase; letter-spacing: 1.8px; border-bottom: 0.6mm solid {{brand.accentColor}}; padding-bottom: 2.5mm; margin: 10mm 0 8mm; page-break-after: avoid; }
  .part-lede { margin: -4mm 0 7mm; }
  .part-break { page-break-before: always; }
  .part-numbered { display: flex; align-items: center; gap: 4mm; text-transform: none; letter-spacing: 0; font-size: 20px; }
  .part-num { width: 9.5mm; height: 9.5mm; font-size: 14px; }
  .content-section { margin-bottom: 10mm; }
  .section-head { page-break-inside: avoid; }
  h2 { color: {{brand.headerColor}}; font-size: 18px; margin-bottom: 4mm; display: flex; align-items: center; gap: 4mm; page-break-after: avoid; }
  .section-num { display: inline-flex; align-items: center; justify-content: center; width: 8.5mm; height: 8.5mm; border-radius: 50%; background: {{brand.accentColor}}; color: #fff; font-size: 13px; flex-shrink: 0; }
  .section-body { font-size: 13px; line-height: 1.62; }
  .section-body p { margin-bottom: 3.5mm; }
  .section-body ul, .section-body ol { margin: 2mm 0 3.5mm 6mm; }
  .section-body li { margin-bottom: 1.8mm; }
  .section-body p, .section-body li { orphans: 3; widows: 3; }
  .section-body table { page-break-inside: auto; }
  .section-body tr { page-break-inside: avoid; }
  .section-body table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 3mm 0 4mm; }
  .section-body th, .section-body td { border: 0.3mm solid #dfe5e8; padding: 2.5mm 3mm; text-align: left; vertical-align: top; }
  .section-body th { background: color-mix(in srgb, {{brand.headerColor}} 8%, #ffffff); color: {{brand.headerColor}}; }
  .doc-figure { margin: 4mm 0 5mm; page-break-inside: avoid; }
  .doc-figure svg { width: 100%; height: auto; display: block; }
  .doc-figure figcaption { font-size: 11px; color: #667; text-align: center; margin-top: 1.5mm; }
  .tip-box { background: color-mix(in srgb, {{brand.accentColor}} 9%, #ffffff); border-left: 1.2mm solid {{brand.accentColor}}; padding: 4mm 5mm; margin-top: 4mm; font-size: 12.5px; line-height: 1.55; border-radius: 0 2mm 2mm 0; page-break-inside: avoid; }
  .tip-label { display: block; font-weight: 700; color: {{brand.accentColor}}; font-size: 11px; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 1.5mm; }

  /* ── Stretch cards (2-up) ── */
  .stretch-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 10mm; }
  .stretch-card { border: 0.35mm solid #dfe5e8; border-radius: 3mm; padding: 5mm; page-break-inside: avoid; }
  .stretch-card h3 { color: {{brand.headerColor}}; font-size: 14px; display: flex; align-items: center; gap: 3mm; margin-bottom: 3mm; }
  .stretch-card .section-num { width: 7mm; height: 7mm; font-size: 11.5px; }
  .stretch-card .doc-figure { margin: 0 0 3mm; }
  .stretch-card .doc-figure svg { max-height: 44mm; width: auto; max-width: 100%; margin: 0 auto; }
  .stretch-card .how, .stretch-card .why { font-size: 11.5px; line-height: 1.55; margin-top: 2.5mm; }
  .mini-label { display: block; font-weight: 700; color: {{brand.accentColor}}; font-size: 10px; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 1mm; }

  /* ── Back page ── */
  .back-page { page-break-before: always; height: 250mm; display: flex; flex-direction: column; text-align: center; padding: 10mm 25mm 0; }
  .back-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .back-page h2 { justify-content: center; font-size: 26px; }
  .back-page .accent-bar { width: 34mm; height: 2mm; background: {{brand.accentColor}}; border-radius: 2px; margin: 5mm auto 0; }
  .back-logo { margin-top: 10mm; }
  .back-logo img { max-height: 16mm; max-width: 55mm; }
  .offer-box { background: {{brand.headerColor}}; border-left: 1.5mm solid {{brand.accentColor}}; border-radius: 3mm; padding: 7mm 12mm; margin-top: 8mm; width: 100%; max-width: 135mm; box-sizing: border-box; color: #fff; }
  .offer-box .offer-label { font-weight: 700; color: {{brand.accentColor}}; filter: brightness(1.6); font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; }
  .offer-box .offer-text { font-size: 15px; line-height: 1.5; margin-top: 2.5mm; font-weight: 700; }
  .offer-box .offer-note { font-size: 12px; color: rgba(255,255,255,.8); margin-top: 2.5mm; }
  /* Same width as the offer box (Veit 2026-09-14: the two CTA boxes must align). */
  .back-page .cta-btn { display: block; margin-top: 8mm; background: {{brand.accentColor}}; color: #fff; padding: 5.5mm 14mm; border-radius: 3mm; font-size: 17px; font-weight: 700; width: 100%; max-width: 135mm; box-sizing: border-box; text-decoration: none; }
  .back-page .cta-btn .cta-phone { display: block; font-size: 26px; font-weight: 800; letter-spacing: 0.5px; margin-top: 2.5mm; }
  .back-page .contact { margin-top: 9mm; font-size: 13px; line-height: 1.9; color: {{brand.fontColor}}; }
  .disclaimer { margin: 6mm auto 2mm; font-size: 9.5px; line-height: 1.5; color: #777; max-width: 160mm; }
</style>
</head>
<body>

<div class="cover">
  <div class="logo">
    <img src="{{brand.logoUrl}}" onerror="this.outerHTML='<div class=&quot;logo-fallback&quot;>{{brand.organizationName}}</div>'"/>
  </div>
  <div>
    <div class="eyebrow">${esc(spec.eyebrow ?? 'A free guide from')} {{brand.organizationName}}</div>
    <h1>${esc(spec.title)}</h1>
    <div class="accent-bar"></div>
    <p class="subtitle"><slot name="cover_subtitle">${spec.subtitle}</slot></p>
    ${spec.coverAsset ? `<div class="cover-art">${loadAsset(spec.coverAsset)}</div>` : ''}
    ${checklist}
  </div>
  <div class="cover-footer">Prepared for you by {{brand.organizationName}} · {{brand.website}}</div>
</div>

<!--SPLIT-->

<div class="content">
  <section class="content-section">
    <div class="section-body"><slot name="intro">${spec.introHtml ?? 'A short, warm introduction to this guide and who it helps.'}</slot></div>
  </section>
${body}
</div>

<div class="back-page">
  <div class="back-main">
  <h2>Ready for the next step?</h2>
  <div class="accent-bar"></div>
  <p class="section-body" style="max-width:130mm"><slot name="cta_paragraph">If anything in this guide sounds like you, we'd love to help you get moving comfortably again.</slot></p>
  <div class="offer-box">
    <div class="offer-label">${esc(spec.offerHeadline ?? 'Reader offer')}</div>
    <div class="offer-text">{{brand.readerOffer}}</div>
    <div class="offer-note">Mention this guide when you book.</div>
  </div>
  <a class="cta-btn" href="tel:{{brand.phoneTel}}">{{brand.bookingCta}}<span class="cta-phone" data-optional="phone">{{brand.phone}}</span></a>
  <div class="contact">
    <strong>{{brand.organizationName}}</strong><br/>
    {{brand.address}}<br/>
    <span data-optional="phone"><a href="tel:{{brand.phoneTel}}" style="color:inherit;text-decoration:none">{{brand.phone}}</a> · </span><span data-optional="email">{{brand.email}}</span><br/>
    <span data-optional="bookingUrl">Book online: {{brand.bookingUrl}}<br/></span>
    <span data-optional="openingHours">{{brand.openingHours}}<br/></span>
    {{brand.website}}
  </div>
  <div class="back-logo" data-optional="logoDarkUrl"><img src="{{brand.logoDarkUrl}}"/></div>
  </div>
  <p class="disclaimer">${spec.disclaimerHtml}</p>
</div>

</body>
</html>`
}

/** Default slot metadata for a master built with this layout. */
export function defaultSlotMeta(spec: MasterDocSpec): Record<string, { maxChars?: number; rewriteEligible: boolean }> {
  const meta: Record<string, { maxChars?: number; rewriteEligible: boolean }> = {
    cover_subtitle: { maxChars: 260, rewriteEligible: true },
    intro: { maxChars: 1100, rewriteEligible: true },
    cta_paragraph: { maxChars: 420, rewriteEligible: true },
  }
  const addSection = (s: MasterSection) => {
    meta[s.slotName] = { maxChars: 2200, rewriteEligible: true }
    if (s.tipHtml) meta[`${s.slotName}_tip`] = { maxChars: 420, rewriteEligible: true }
  }
  for (const s of spec.sections ?? []) addSection(s)
  for (const b of spec.blocks ?? []) {
    if (b.kind === 'section') addSection(b)
    if (b.kind === 'stretchGrid')
      for (const c of b.cards) meta[`${c.slotName}_why`] = { maxChars: 380, rewriteEligible: true }
  }
  return meta
}


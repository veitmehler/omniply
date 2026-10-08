#!/usr/bin/env node
/**
 * Compiles the X-Ray nurture emails from the copy master into GHL-ready HTML.
 *
 *   node .documentation/marketing/email-template/build-emails.js
 *
 * Reads:  ../xray-nurture-sequence.md  (single source of truth for copy)
 *         ./xray-email-layout.html     (branded-lite layout)
 * Writes: ./out/email-NN-dayD.html     (one per email, import into GHL)
 *         ./out/sms.txt                (the SMS bodies, copy into SMS actions)
 *         ./out/INDEX.md               (subject + preview per email, for the
 *                                       workflow send steps)
 *
 * Copy conventions it understands (see the sequence doc):
 *   **Subject:** / **Preview:** lines; blank-line paragraphs; **bold**;
 *   "**[Label →]** (url)" on its own line → lime CTA button;
 *   lines starting "**+**"  → bullet rows;
 *   "— Veit" lines → signature; "P.S. …" → muted postscript;
 *   bare {{contact.xray_report_url}} / https:// URLs in text → links.
 */
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const SRC = join(__dirname, '..', 'xray-nurture-sequence.md')
const LAYOUT = join(__dirname, 'xray-email-layout.html')
const OUT = join(__dirname, 'out')

const md = readFileSync(SRC, 'utf8')
const layout = readFileSync(LAYOUT, 'utf8')
mkdirSync(OUT, { recursive: true })

const P_STYLE = 'margin:0 0 18px 0;'
const LINK_STYLE = 'color:#15803D; text-decoration:underline;'

/**
 * Hard-wrapped source lines reflow (join with a space); intentional stacks
 * (each line ending a sentence, like the Day-3 stat block) keep their breaks.
 */
function reflow(block) {
  const lines = block.split('\n').map((l) => l.trim())
  let out = lines[0]
  for (let i = 1; i < lines.length; i++) {
    out += /[.!?:*"]$/.test(lines[i - 1]) ? '<br />' + lines[i] : ' ' + lines[i]
  }
  return out
}

function inline(text) {
  let t = text
  // named links FIRST (before bold would eat the ** markers)
  t = t.replace(/\*\*\[(.+?)\]\*\*\s*\(([^)\s]+)\)/g,
    `<a href="$2" style="color:#15803D; font-weight:700; text-decoration:underline;">$1</a>`)
  // bold, then single-asterisk italics
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
  // bare report-url token → link (when not already inside an href)
  t = t.replace(/(?<!href=")(\{\{contact\.xray_report_url\}\})/g, `<a href="{{contact.xray_report_url}}" style="${LINK_STYLE}">$1</a>`)
  // bare URLs → links
  t = t.replace(/(?<!["=])(https:\/\/[a-zA-Z0-9./?=_&{}-]+)/g, (m) =>
    m.includes('{{') ? m : `<a href="${m}" style="${LINK_STYLE}">${m}</a>`)
  return t
}

function compileBody(body) {
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const html = []
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim())

    // bullet rows: block starts with **+**; continuation lines (hard wraps) join
    if (lines[0].startsWith('**+**')) {
      const bullets = []
      for (const l of lines) {
        if (l.startsWith('**+**')) bullets.push(l.replace(/^\*\*\+\*\*\s*/, ''))
        else bullets[bullets.length - 1] += ' ' + l
      }
      const items = bullets.map((text) =>
        `<tr><td valign="top" style="font-family:'Courier New',monospace; font-weight:700; color:#7CA023; padding:0 10px 12px 0;">+</td>` +
        `<td style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15.5px; line-height:1.6; color:#1A1A1C; padding:0 0 12px 0;">${inline(text)}</td></tr>`,
      )
      html.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">${items.join('')}</table>`)
      continue
    }
    // signature
    if (/^— Veit/.test(block)) {
      html.push(`<p style="margin:26px 0 4px 0; color:#1A1A1C;">${inline(block)}</p>`)
      continue
    }
    // postscript
    if (/^P\.S\./.test(block)) {
      html.push(`<p style="margin:35px 0 0 0; padding-top:16px; border-top:1px solid #ECEDEF; font-size:18px; color:#55555C;">${inline(reflow(block))}</p>`)
      continue
    }
    html.push(`<p style="${P_STYLE}">${inline(reflow(block))}</p>`)
  }
  return html.join('\n')
}

// ── parse the sequence doc ────────────────────────────────────────────────────
const emailRe = /^## EMAIL (\d+) · Day (\S+)[^\n]*\n\n\*\*Subject:\*\* (.+)\n\*\*Preview:\*\* (.+)\n\n([\s\S]*?)(?=\n---)/gm
const smsRe = /^## SMS (\d+) · ([^\n]+)\n\n([\s\S]*?)(?=\n---)/gm

const index = ['# Generated emails — subjects & previews (set these on the GHL send steps)\n']
let count = 0
let m
while ((m = emailRe.exec(md)) !== null) {
  const [, num, day, subject, preview, body] = m
  const file = `email-${String(num).padStart(2, '0')}-day${day.replace(/\D/g, '') || day}.html`
  // function replacements: immune to $-substitution and to stray tokens elsewhere
  const compiled = compileBody(body.trim())
  const out = layout.replace('__PREVIEW__', () => preview.trim()).replace('__BODY__', () => compiled)
  writeFileSync(join(OUT, file), out)
  index.push(`- **${file}** — Day ${day} · Subject: \`${subject.trim()}\` · Preview: \`${preview.trim()}\``)
  count++
}

const sms = ['X-Ray nurture — SMS bodies (paste into GHL SMS actions; only-if-phone branch)\n']
while ((m = smsRe.exec(md)) !== null) {
  const [, num, when, body] = m
  sms.push(`── SMS ${num} · ${when.trim()} ──\n${body.trim()}\n`)
}

writeFileSync(join(OUT, 'INDEX.md'), index.join('\n') + '\n')
writeFileSync(join(OUT, 'sms.txt'), sms.join('\n'))
console.log(`compiled ${count} emails + sms.txt → ${OUT}`)

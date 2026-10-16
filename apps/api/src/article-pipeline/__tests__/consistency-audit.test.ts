import { describe, it, expect } from 'vitest'
import {
  extractFigures,
  numericTokens,
  safeEvalExpr,
  tokenEditCount,
  guardOp,
  applyOps,
  type AuditOp,
  type AuditSurface,
} from '../enrichment/consistency-audit'

const op = (partial: Partial<AuditOp> & { find: string; replace: string }): AuditOp => ({
  surface: 'body',
  reason: 'test',
  ...partial,
})

describe('extractFigures', () => {
  it('finds dollar amounts, percentages, multipliers, and ranges with context', () => {
    const html = '<p>You pay $1,500 per patient. Volume drops 20% in 30 to 45 days, a 21 times difference.</p>'
    const rows = extractFigures('body', html)
    const joined = rows.join('\n')
    expect(joined).toContain('"$1,500"')
    expect(joined).toContain('"20%"')
    expect(joined).toContain('"21 times"')
    expect(joined).toContain('"30 to 45"')
    expect(rows[0]).toMatch(/^\[body\]/)
  })

  it('strips tags before matching', () => {
    const rows = extractFigures('kt', '<li><b>Impact</b>: lose $54,000 annually</li>')
    expect(rows.join()).toContain('"$54,000"')
    expect(rows.join()).not.toContain('<li>')
  })
})

describe('safeEvalExpr', () => {
  it('evaluates bare arithmetic with commas', () => {
    expect(safeEvalExpr('2,250*4*3')).toBe(27000)
    expect(safeEvalExpr('(10500+12000+7500+9000)')).toBe(39000)
  })

  it('rejects anything with identifiers', () => {
    expect(safeEvalExpr('Math.max(1,2)')).toBeNull()
    expect(safeEvalExpr('process.exit()')).toBeNull()
    expect(safeEvalExpr('2x3')).toBeNull()
  })
})

describe('tokenEditCount', () => {
  it('counts a single number swap as two edits', () => {
    expect(tokenEditCount('costs you $54,000 in revenue', 'costs you $27,000 in revenue')).toBe(2)
  })

  it('counts insertions', () => {
    expect(tokenEditCount('lose $39,000 monthly', 'can lose up to $39,000 monthly')).toBe(3)
  })
})

describe('guardOp', () => {
  const body = '<p>Three windows per year costs you $54,000 in direct revenue, plus churn.</p><p>Other text with $54,000 mentioned once more? No: unique here.</p>'

  it('accepts a verified number fix (the $54k regression case)', () => {
    const o = op({
      find: 'costs you $54,000 in direct revenue',
      replace: 'costs you $27,000 in direct revenue',
      math: '2250*4*3',
    })
    expect(guardOp(o, '<p>Three windows per year costs you $54,000 in direct revenue, plus churn.</p>')).toBeNull()
  })

  it('rejects a number change without math', () => {
    const o = op({ find: 'costs you $54,000 in direct revenue', replace: 'costs you $27,000 in direct revenue' })
    expect(guardOp(o, body)).toBe('number change without math')
  })

  it('rejects when the math does not produce the replacement number', () => {
    const o = op({
      find: 'costs you $54,000 in direct revenue',
      replace: 'costs you $30,000 in direct revenue',
      math: '2250*4*3',
    })
    expect(guardOp(o, body)).toContain('does not match')
  })

  it('rejects a non-unique find', () => {
    const o = op({ find: '$54,000', replace: '$27,000', math: '27000' })
    expect(guardOp(o, body)).toBe('find-string not unique')
  })

  it('rejects a missing find', () => {
    const o = op({ find: 'not present anywhere', replace: 'x y z' })
    expect(guardOp(o, body)).toBe('find-string not present verbatim')
  })

  it('rejects ops that touch protected structure', () => {
    const page = '<h2 id="x">The $22,000 Heading</h2><p>text</p>'
    expect(guardOp(op({ find: '<h2 id="x">The $22,000 Heading</h2>', replace: '<h2 id="x">Other</h2>' }), page)).toBe(
      'find-string touches protected structure',
    )
    expect(guardOp(op({ find: 'text', replace: 'see <a href="https://x.com">this</a>' }), page)).toBe(
      'replace introduces protected structure',
    )
  })

  it('rejects oversized rewrites (meaning-drift protection)', () => {
    const page = '<p>The short sentence lives here today.</p>'
    const o = op({
      find: 'The short sentence lives here today.',
      replace: 'A completely different thought with many brand new words appears in this spot instead of the original one.',
    })
    expect(guardOp(o, page)).toMatch(/diff too large/)
  })

  it('rejects replacements introducing URLs or dashes', () => {
    const page = '<p>Plain claim without source.</p>'
    expect(guardOp(op({ find: 'Plain claim without source.', replace: 'Plain claim, see www.example.com source.' }), page)).toBe(
      'replace introduces a URL',
    )
    expect(guardOp(op({ find: 'Plain claim without source.', replace: 'Plain claim — without source.' }), page)).toBe(
      'replace introduces a dash',
    )
  })

  it('accepts hedge softening with no number change (the "up to" case)', () => {
    const page = '<li><b>Leak</b>: practices lose $39,000 monthly across four axes.</li>'
    const o = op({
      surface: 'keyTakeaways',
      find: 'practices lose $39,000 monthly',
      replace: 'practices can lose up to $39,000 monthly',
    })
    expect(guardOp(o, page)).toBeNull()
  })

  it('accepts a verb-fidelity fix (qualify vs convert)', () => {
    const page = '<p>You are 21 times more likely to convert the lead when responding fast.</p>'
    const o = op({
      find: '21 times more likely to convert the lead',
      replace: '21 times more likely to qualify the lead',
    })
    expect(guardOp(o, page)).toBeNull()
  })
})

describe('applyOps', () => {
  const surfaces: Record<AuditSurface, string> = {
    title: 'The $54,000 Mistake',
    excerpt: 'Practices lose $54,000 every year.',
    intro: '',
    keyTakeaways: '<li>lose $54,000 annually from drops</li>',
    body: '<p>Inputs: $2,250 weekly over 4 weeks across 3 windows. Total: $54,000 per year.</p>',
  }

  it('applies passed ops per surface and keeps rejected ones original', () => {
    const ops: AuditOp[] = [
      { surface: 'body', find: 'Total: $54,000 per year.', replace: 'Total: $27,000 per year.', reason: 'r', math: '2250*4*3' },
      { surface: 'keyTakeaways', find: 'lose $54,000 annually', replace: 'lose $27,000 annually', reason: 'r', math: '2250*4*3' },
      { surface: 'excerpt', find: 'lose $54,000 every year', replace: 'lose $99,000 every year', reason: 'r', math: '2250*4*3' }, // wrong math → reject
    ]
    const res = applyOps(surfaces, ops)
    expect(res.applied).toHaveLength(2)
    expect(res.rejected).toHaveLength(1)
    expect(res.surfaces.body).toContain('$27,000')
    expect(res.surfaces.keyTakeaways).toContain('$27,000')
    expect(res.surfaces.excerpt).toContain('$54,000') // untouched
    expect(res.rejected[0].rejectedBecause).toContain('does not match')
  })

  it('caps at 10 ops', () => {
    const many: AuditOp[] = Array.from({ length: 14 }, (_, i) => ({
      surface: 'body' as const,
      find: `missing-${i}`,
      replace: `x-${i}`,
      reason: 'r',
    }))
    const res = applyOps(surfaces, many)
    expect(res.applied.length + res.rejected.length).toBe(10)
  })
})

describe('numericTokens', () => {
  it('normalizes separators', () => {
    expect(numericTokens('$54,000 and 14.8% of 1,500')).toEqual([54000, 14.8, 1500])
  })
})

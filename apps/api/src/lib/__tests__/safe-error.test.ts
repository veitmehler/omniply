import { describe, it, expect } from 'vitest'
import { safeErrorDetail } from '../safe-error'

describe('safeErrorDetail', () => {
  it('keeps plain provider messages intact (dashboard toasts rely on them)', () => {
    expect(safeErrorDetail(new Error('Rate limit exceeded. Please try again later.'))).toBe(
      'Rate limit exceeded. Please try again later.',
    )
  })

  it('redacts URLs — the loop-video SSRF response oracle', () => {
    const out = safeErrorDetail(new Error('Request to https://10.0.0.5:8080/internal/admin?x=1 failed with 403'))
    expect(out).toBe('Request to [url] failed with 403')
  })

  it('redacts bare IPs and host:port', () => {
    expect(safeErrorDetail(new Error('connect ECONNREFUSED 192.168.1.10:5432'))).toBe(
      'connect ECONNREFUSED [ip]',
    )
  })

  it('redacts filesystem paths', () => {
    const out = safeErrorDetail(new Error("ENOENT: no such file or directory, open '/opt/socioply/tmp/clip.mp4'"))
    expect(out).toContain('[path]')
    expect(out).not.toContain('/opt/')
  })

  it('handles non-Error throws and caps length at 300', () => {
    expect(safeErrorDetail('boom')).toBe('boom')
    expect(safeErrorDetail(new Error('x'.repeat(500)))).toHaveLength(300)
  })

  it('does not mangle version-like numbers with fewer than four octets', () => {
    expect(safeErrorDetail(new Error('model gpt-4.1 returned 503'))).toBe('model gpt-4.1 returned 503')
  })
})

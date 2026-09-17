'use client'

import { useState } from 'react'

export interface EditRequest {
  id: string
  quotedText: string
  prefixContext: string | null
  suffixContext: string | null
  note: string
  status: string
  createdAt: string
}

/**
 * Shared edit-request list (articles + newsletters): collapsed header with an
 * open-count badge, quote-locator rows, and a detail popup with explicit
 * "What to change / Where" labels + Done/Reopen + jump-to-text.
 */
export function EditRequestList({
  requests,
  onStatus,
  onJump,
  onNotify,
  open,
  onOpenChange,
}: {
  requests: EditRequest[]
  onStatus: (id: string, status: 'resolved' | 'open') => void
  onJump?: (quote: string) => void
  onNotify?: () => void
  /** Optional controlled expansion (e.g. a "publishing paused" banner toggles it). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const isOpen = open ?? internalOpen
  const setOpen = (v: boolean) => {
    setInternalOpen(v)
    onOpenChange?.(v)
  }
  const openCount = requests.filter((r) => r.status === 'open').length

  if (requests.length === 0) return null

  return (
    <>
      <div className="rounded-xl border border-border bg-card">
        <button onClick={() => setOpen(!isOpen)} className="flex w-full items-center justify-between p-4 text-left">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Edit requests</span>
          <span className="flex items-center gap-2">
            {openCount > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                {openCount} open
              </span>
            )}
            <span className="text-muted-foreground">{isOpen ? '▾' : '▸'}</span>
          </span>
        </button>
        {isOpen && (
          <div className="space-y-1.5 px-4 pb-4">
            {requests.map((r) => (
              <button
                key={r.id}
                onClick={() => setDetail(r.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-xs hover:bg-muted"
              >
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${r.status === 'open' ? 'bg-amber-500' : 'bg-green-600'}`} />
                <span className="min-w-0 truncate italic text-muted-foreground">“{r.quotedText}”</span>
              </button>
            ))}
            {onNotify && requests.every((r) => r.status !== 'open') && (
              <button onClick={onNotify} className="mt-1 w-full rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                All done — notify the reviewer
              </button>
            )}
          </div>
        )}
      </div>

      {detail &&
        (() => {
          const r = requests.find((x) => x.id === detail)
          if (!r) return null
          return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
              <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What to change</div>
                <p className="mb-4 text-sm font-medium text-foreground">{r.note}</p>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Where</div>
                <p className="mb-4 rounded-lg bg-muted/50 p-2 text-xs italic text-muted-foreground">
                  {r.prefixContext ? `…${r.prefixContext}` : ''}
                  <mark className="bg-amber-200 not-italic text-foreground">{r.quotedText}</mark>
                  {r.suffixContext ? `${r.suffixContext}…` : ''}
                </p>
                <div className="mb-4 text-[11px] text-muted-foreground">Requested {new Date(r.createdAt).toLocaleString()}</div>
                <div className="flex items-center justify-between gap-2">
                  {onJump ? (
                    <button
                      onClick={() => {
                        onJump(r.quotedText)
                        setDetail(null)
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      Show in text
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    {r.status === 'open' ? (
                      <button
                        onClick={() => {
                          onStatus(r.id, 'resolved')
                          setDetail(null)
                        }}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                      >
                        Mark done
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          onStatus(r.id, 'open')
                          setDetail(null)
                        }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                      >
                        Reopen
                      </button>
                    )}
                    <button onClick={() => setDetail(null)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
    </>
  )
}

/** Locate a quote inside a live container (tolerant of edited tails). */
export function findQuoteRange(container: HTMLElement, quote: string): Range | null {
  const nodes: { node: Text; start: number }[] = []
  let full = ''
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    nodes.push({ node: n as Text, start: full.length })
    full += n.textContent ?? ''
  }
  if (!nodes.length) return null
  let idx = full.indexOf(quote)
  let len = quote.length
  if (idx === -1) {
    const probe = quote.slice(0, 60)
    idx = full.indexOf(probe)
    len = probe.length
  }
  if (idx === -1) return null
  const locate = (pos: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].start <= pos) return { node: nodes[i].node, offset: pos - nodes[i].start }
    }
    return { node: nodes[0].node, offset: 0 }
  }
  const s = locate(idx)
  const e = locate(idx + len)
  const range = document.createRange()
  try {
    range.setStart(s.node, Math.min(s.offset, s.node.length))
    range.setEnd(e.node, Math.min(e.offset, e.node.length))
  } catch {
    return null
  }
  return range
}

/** Select + scroll a quote into view inside a container. */
export function jumpToQuote(container: HTMLElement, quote: string): void {
  const range = findQuoteRange(container, quote)
  if (!range) return
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  const anchor =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement)
  anchor?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

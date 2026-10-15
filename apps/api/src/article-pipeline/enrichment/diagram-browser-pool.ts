/**
 * Singleton Chromium browser for diagram PNG rasterization (Puppeteer).
 * Re-used across sections in one enrichment run to avoid startup cost.
 *
 * Page usage is gated by a GLOBAL semaphore (max concurrent pages across ALL
 * jobs on this worker) so the Phase-1 parallelization can't stack unbounded
 * Chromium pages — see .plans/production-throughput.implementation-plan.md 1a.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { Semaphore } from '../../lib/concurrency'

function chromiumPath(): string {
  return (
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    process.env.CHROME_BIN ??
    '/usr/bin/chromium-browser'
  )
}

const MAX_CONCURRENT_PAGES = Number(process.env.CHROMIUM_MAX_PAGES) > 0
  ? Number(process.env.CHROMIUM_MAX_PAGES)
  : 4
const pageSemaphore = new Semaphore(MAX_CONCURRENT_PAGES)

let pooled: Browser | null = null

export async function getDiagramRasterBrowser(): Promise<Browser> {
  if (!pooled?.connected) {
    pooled = await puppeteer.launch({
      executablePath: chromiumPath(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      // Under full-droplet load (15-article backfill, 2026-10-15) a screenshot
      // took >180s (the library default) and killed the section permanently —
      // the CDP command had no answer from a CPU-starved Chromium, not a hang.
      protocolTimeout: 300_000,
    })
  }
  return pooled
}

/**
 * Run `fn` with a fresh page under the global page cap. Always closes the page
 * and releases the permit, even on throw. All raster/overlay/cover work must go
 * through this rather than calling browser.newPage() directly.
 */
export async function withRasterPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return pageSemaphore.run(async () => {
    const browser = await getDiagramRasterBrowser()
    const page = await browser.newPage()
    try {
      return await fn(page)
    } finally {
      await page.close().catch(() => {})
    }
  })
}

export async function closeDiagramRasterBrowser(): Promise<void> {
  if (pooled) {
    await pooled.close().catch(() => {})
    pooled = null
  }
}

/**
 * SVG → PNG rasterization via Puppeteer + headless Chromium.
 *
 * @resvg/resvg-js cannot render Mermaid-style <foreignObject> labels. Browsers do,
 * so we screenshot an HTML page embedding the sanitized SVG — same fidelity as SVG→screen.
 */

import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { withRasterPage } from './diagram-browser-pool'

export interface RasterizeResult {
  png: Buffer
  width: number
  height: number
}

export async function rasterizeSvg(
  svg: string,
  targetWidth = 1200,
  background = '#ffffff',
): Promise<RasterizeResult> {
  // One retry on a fresh page/permit: a screenshot timeout under droplet-wide
  // load pressure is transient, and a failure here loses the section's diagram
  // for good (the enrichment retry path only covers Mermaid render errors).
  try {
    return await rasterizeSvgOnce(svg, targetWidth, background)
  } catch {
    return rasterizeSvgOnce(svg, targetWidth, background)
  }
}

async function rasterizeSvgOnce(
  svg: string,
  targetWidth: number,
  background: string,
): Promise<RasterizeResult> {
  const scale = 2

  return withRasterPage(async (page) => {
    const dims = extractSvgDimensions(svg, targetWidth)

    await page.setViewport({
      width: dims.width,
      height: dims.height,
      deviceScaleFactor: scale,
    })

    const html = buildHtmlWrapper(svg, dims.width, dims.height, background)
    const tmpFile = join(tmpdir(), `raster-${randomUUID()}.html`)
    await writeFile(tmpFile, html, 'utf8')

    try {
      await page.goto(pathToFileURL(tmpFile).href, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      })
      await new Promise((r) => setTimeout(r, 150))

      const pngBuffer = (await page.screenshot({
        type: 'png',
        fullPage: true,
      })) as Buffer

      return {
        png: Buffer.from(pngBuffer),
        width: dims.width * scale,
        height: dims.height * scale,
      }
    } finally {
      await unlink(tmpFile).catch(() => {})
    }
  })
}

function buildHtmlWrapper(svg: string, width: number, height: number, background: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:${background};width:${width}px;height:${height}px;overflow:hidden;}
svg{display:block;max-width:100%;max-height:100%}
</style>
</head>
<body>
${svg}
</body>
</html>`
}

/** Parse viewBox / width-height from output SVG so viewport matches intrinsic layout. */
function extractSvgDimensions(svg: string, fallbackWidth: number): { width: number; height: number } {
  const vb =
    /\bviewBox\s*=\s*["'](\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)["']/i.exec(
      svg,
    )
  if (vb) {
    const vbWidth = Number.parseFloat(vb[3])
    const vbHeight = Number.parseFloat(vb[4])
    const scale = fallbackWidth / vbWidth
    return { width: Math.round(fallbackWidth), height: Math.max(1, Math.round(vbHeight * scale)) }
  }

  const w = /\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(svg)
  const h = /\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(svg)
  if (w && h) {
    const origW = Number.parseFloat(w[1])
    const origH = Number.parseFloat(h[1])
    const scale = fallbackWidth / origW
    return { width: Math.round(fallbackWidth), height: Math.max(1, Math.round(origH * scale)) }
  }

  return { width: fallbackWidth, height: Math.round(fallbackWidth * 0.6) }
}

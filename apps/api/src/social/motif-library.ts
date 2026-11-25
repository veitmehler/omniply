/**
 * The motif library (Veit, 2026-11-25).
 *
 * Carousel and story slides carry a faint motif behind the brand colour for
 * depth. Until now each post asked an image model for one (about $0.07, a few
 * seconds, and a failure mode). The motif was never tied to the post's content,
 * so it is now picked from a library of hand-approved drawings instead.
 *
 * A library item is a colourless shape: a single-channel PNG in which white is
 * line and black is nothing. The slide draws it in its own text colour, so the
 * brand colour is never shifted and every item suits every brand.
 *
 * Files live in apps/api/assets/motifs/<set>/ and ship with the image; adding
 * an item is adding a file. There are two sets, one per niche we sell to. A
 * niche without a set gets a plain brand-colour slide, and a new niche does
 * not launch until its set exists (see .documentation/new-vertical-playbook.md).
 *
 * Style rule for the drawings: fine line art, stylish, never bold. If the motif
 * needs to show more, raise MOTIF_STRENGTH, not the line weight.
 */
import { readdirSync } from 'fs'
import path from 'path'
import sharp from 'sharp'
import { logger } from '../lib/logger'

export type MotifSet = 'chiropractic' | 'wellness'

/**
 * How strongly the shape is laid onto the brand canvas. The slide's colour wash
 * (85%) then sits on top, so the motif reads at about 0.7 x 0.15 = 10% in the
 * finished slide, the level Veit confirmed on 2026-11-25.
 */
export const MOTIF_STRENGTH = 0.7

/** The set for an account's niche, or null when we have none for it. Azavea's own account (practice-growth software for chiropractors) uses the chiropractic set. */
export function motifSetFor(industry: string | null | undefined): MotifSet | null {
  const i = industry ?? ''
  if (/chiro|practice-growth/i.test(i)) return 'chiropractic'
  if (/wellness|recovery|well-being|wellbeing|spa\b|massage/i.test(i)) return 'wellness'
  return null
}

const motifDir = (set: MotifSet) => path.join(process.cwd(), 'assets', 'motifs', set)
const cache = new Map<MotifSet, string[]>()

/** The set's files in name order. Read once per process. */
export function listMotifs(set: MotifSet): string[] {
  const hit = cache.get(set)
  if (hit) return hit
  let files: string[] = []
  try {
    files = readdirSync(motifDir(set)).filter((f) => f.endsWith('.png')).sort()
  } catch (err) {
    logger.warn({ set, err }, '[motif-library] set folder missing')
  }
  cache.set(set, files)
  return files
}

/** Test hook. */
export function resetMotifCache(): void {
  cache.clear()
  pointers.clear()
}

function hash(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

/**
 * The order one account steps through a set in. Each account starts at its own
 * place and takes a stride that visits every item before any repeats, so two
 * accounts do not show the same sequence and consecutive posts of one account
 * are never the same drawing.
 */
export function motifAt(count: number, userId: string, step: number): number {
  if (count <= 1) return 0
  const start = hash(userId) % count
  // A stride coprime with the count walks the whole set; odd candidates near a third of the set spread neighbours apart.
  let stride = Math.max(1, Math.floor(count / 3)) | 1
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  while (gcd(stride, count) !== 1) stride += 2
  return (start + step * stride) % count
}

/** Where each account is in its set, kept in memory: posts built in one batch each take the next item. */
const pointers = new Map<string, number>()

/**
 * The next motif file for this account, or null when its niche has no set.
 * `seed` is the step to start from when this process has not served the account
 * yet (the caller passes how many backgrounds the account already has, so a
 * restart carries on roughly where it left off).
 */
export function nextMotif(industry: string | null | undefined, userId: string, seed = 0): { set: MotifSet; file: string; path: string } | null {
  const set = motifSetFor(industry)
  if (!set) return null
  const files = listMotifs(set)
  if (files.length === 0) return null
  const key = `${set}:${userId}`
  const step = pointers.has(key) ? pointers.get(key)! + 1 : seed
  pointers.set(key, step)
  const file = files[motifAt(files.length, userId, step)]
  return { set, file, path: path.join(motifDir(set), file) }
}

const rgb = (hex: string) => {
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

/**
 * The slide background: the brand colour, with the shape drawn on it in the
 * slide's text colour. With no shape it is the plain brand colour.
 */
export async function renderMotifCanvas(opts: { shapePath: string | null; canvasHex: string; inkHex: string; size?: number; strength?: number }): Promise<Buffer> {
  const size = opts.size ?? 1080
  const canvas = sharp({ create: { width: size, height: size, channels: 4, background: { ...rgb(opts.canvasHex), alpha: 1 } } })
  if (!opts.shapePath) return canvas.png().toBuffer()
  try {
    const strength = opts.strength ?? MOTIF_STRENGTH
    // The file is the shape's coverage (white = line). Scale it to the canvas and weaken it to the chosen strength.
    const alpha = await sharp(opts.shapePath).resize(size, size, { fit: 'cover' }).extractChannel(0).linear(strength, 0).raw().toBuffer()
    const ink = await sharp({ create: { width: size, height: size, channels: 3, background: rgb(opts.inkHex) } })
      .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } })
      .png()
      .toBuffer()
    return await canvas.composite([{ input: ink }]).png().toBuffer()
  } catch (err) {
    // A motif is decoration. A missing or unreadable file never holds a post up.
    logger.warn({ shapePath: opts.shapePath, err }, '[motif-library] could not draw the motif; using the plain brand colour')
    return sharp({ create: { width: size, height: size, channels: 4, background: { ...rgb(opts.canvasHex), alpha: 1 } } }).png().toBuffer()
  }
}

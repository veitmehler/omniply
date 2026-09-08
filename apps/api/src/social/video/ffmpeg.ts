import { execFile } from 'node:child_process'
import { REEL_HEADLINE_MAX_CHARS, REEL_HEADLINE_MAX_LINES } from '../generators/reel-bullets'
import { Semaphore } from '../../lib/concurrency'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)

export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

export function ffprobeBin(): string {
  return process.env.FFPROBE_PATH || 'ffprobe'
}

export function defaultFontPath(): string {
  return process.env.FFMPEG_FONT_PATH || '/usr/share/fonts/liberation/LiberationSans-Bold.ttf'
}

/** Bundled Helvetica Neue Regular. */
export function helveticaNeueRegularFontPath(): string {
  return (
    process.env.HELVETICA_NEUE_REGULAR_FONT_PATH ||
    '/usr/share/fonts/helvetica-neue/HelveticaNeue-Regular.ttf'
  )
}

/** Bundled Helvetica Neue Medium — used for F2/S2 video reel headline overlays. */
export function helveticaNeueMediumFontPath(): string {
  return (
    process.env.HELVETICA_NEUE_MEDIUM_FONT_PATH ||
    '/usr/share/fonts/helvetica-neue/HelveticaNeue-Medium.ttf'
  )
}

/** Bundled Helvetica Neue Light — used for F2/S2 video reel bullet overlays. */
export function helveticaNeweLightFontPath(): string {
  return (
    process.env.HELVETICA_NEUE_LIGHT_FONT_PATH ||
    '/usr/share/fonts/helvetica-neue/HelveticaNeue-Light.ttf'
  )
}

/** Bundled DejaVu Sans — used to render ✓ glyphs that Helvetica Neue lacks. */
export function dejaVuSansFontPath(): string {
  return (
    process.env.DEJAVU_SANS_FONT_PATH ||
    '/usr/share/fonts/helvetica-neue/DejaVuSans.ttf'
  )
}

// A stuck/runaway ffmpeg process (corrupt input, filter hang) has no natural
// end — bound it like every network call (Phase 1 of the resilience plan).
// Generous: legitimate single operations (concat, overlay, crop) run in
// seconds; only pathological input should ever approach this.
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000

// Global encode gate (Phase 1g): ffmpeg is the one CPU-BOUND stage — concurrent
// encodes on a small droplet just steal each other's cores. Max 2 across ALL
// jobs; env-tunable.
const ffmpegSemaphore = new Semaphore(
  Number(process.env.FFMPEG_MAX_CONCURRENT) > 0 ? Number(process.env.FFMPEG_MAX_CONCURRENT) : 2,
)

export async function runFfmpeg(args: string[]): Promise<void> {
  await ffmpegSemaphore.run(async () => {
    await execFileAsync(ffmpegBin(), ['-y', ...args], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: FFMPEG_TIMEOUT_MS,
    })
  })
}

export interface VideoProbe {
  duration: number
  width: number
  height: number
}

export async function probeVideo(filePath: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync(ffprobeBin(), [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,duration',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    filePath,
  ], { timeout: 60_000 })
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; duration?: string }>
    format?: { duration?: string }
  }
  const stream = parsed.streams?.[0]
  const duration = parseFloat(stream?.duration ?? parsed.format?.duration ?? '0')
  return {
    duration,
    width: stream?.width ?? 0,
    height: stream?.height ?? 0,
  }
}

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3 * 60 * 1000) })
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`)
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

/** Enforce IG/FB story video constraints (≤60s, ≥540×960, ~9:16). */
export function assertStoryVideoConstraints(probe: VideoProbe): void {
  if (probe.duration > 60.5) {
    throw new Error(`Story video is ${probe.duration.toFixed(1)}s — maximum is 60s`)
  }
  if (probe.width < 540 || probe.height < 960) {
    throw new Error(`Story video is ${probe.width}×${probe.height} — minimum is 540×960`)
  }
  const ratio = probe.width / probe.height
  if (Math.abs(ratio - 9 / 16) > 0.08) {
    throw new Error(`Story video aspect ratio must be 9:16 (got ${probe.width}×${probe.height})`)
  }
}

export async function concatVideos(segmentPaths: string[], outputPath: string): Promise<void> {
  const listPath = outputPath.replace(/\.mp4$/, '-concat.txt')
  const listContent = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  await fs.writeFile(listPath, listContent)
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath])
}

/**
 * Mux a voiceover track onto a (silent) video, starting at `offsetSec` and
 * padded with silence to the full video length so downstream music mixing
 * (amix duration=first / -shortest) keeps the whole clip. Video is stream-copied.
 */
export async function muxVoiceover(
  videoPath: string,
  audioPath: string,
  offsetSec: number,
  outputPath: string,
): Promise<void> {
  const { duration } = await probeVideo(videoPath)
  const ms = Math.max(0, Math.round(offsetSec * 1000))
  await runFfmpeg([
    '-i', videoPath,
    '-i', audioPath,
    '-filter_complex',
    `[1:a]adelay=${ms}|${ms},apad,atrim=0:${duration.toFixed(3)},aformat=sample_rates=44100:channel_layouts=stereo[a]`,
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    outputPath,
  ])
}

export async function hasAudioStream(filePath: string): Promise<boolean> {
  const { stdout } = await execFileAsync(ffprobeBin(), [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    filePath,
  ])
  return stdout.trim().length > 0
}

export interface ConcatVideosReencodeOptions {
  width?: number
  height?: number
  fps?: number
}

/** Scale/pad segments to a common resolution, normalize audio, and concat with re-encode.
 *  Segments without audio get a silent stereo track so intro+body can be joined reliably. */
async function normalizeSegmentForConcat(
  inputPath: string,
  outputPath: string,
  opts: { width: number; height: number; fps: number },
): Promise<void> {
  const { width, height, fps } = opts
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`
  const af = 'aformat=sample_rates=44100:channel_layouts=stereo'
  const encode = [
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '192k',
    outputPath,
  ]

  if (await hasAudioStream(inputPath)) {
    await runFfmpeg([
      '-i', inputPath,
      '-filter_complex', `[0:v]${vf}[v];[0:a]${af}[a]`,
      '-map', '[v]', '-map', '[a]',
      ...encode,
    ])
    return
  }

  await runFfmpeg([
    '-i', inputPath,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-filter_complex', `[0:v]${vf}[v];[1:a]${af}[a]`,
    '-map', '[v]', '-map', '[a]',
    '-shortest',
    ...encode,
  ])
}

export async function concatVideosReencode(
  segmentPaths: string[],
  outputPath: string,
  opts: ConcatVideosReencodeOptions = {},
): Promise<void> {
  const width = opts.width ?? 1080
  const height = opts.height ?? 1080
  const fps = opts.fps ?? 30
  const normOpts = { width, height, fps }

  if (segmentPaths.length === 0) throw new Error('No video segments to concatenate')

  if (segmentPaths.length === 1) {
    await normalizeSegmentForConcat(segmentPaths[0], outputPath, normOpts)
    return
  }

  const tmpDir = path.dirname(outputPath)
  const normalized: string[] = []
  for (let i = 0; i < segmentPaths.length; i++) {
    const normPath = path.join(tmpDir, `reencode-seg-${i}.mp4`)
    await normalizeSegmentForConcat(segmentPaths[i], normPath, normOpts)
    normalized.push(normPath)
  }

  const inputs = normalized.flatMap((p) => ['-i', p])
  const filter =
    normalized.map((_, i) => `[${i}:v][${i}:a]`).join('') +
    `concat=n=${normalized.length}:v=1:a=1[v][a]`

  await runFfmpeg([
    ...inputs,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '192k',
    outputPath,
  ])
}

/**
 * Center-crop (then scale) to 540×960 so feed reels (e.g. 1:1 F2) satisfy story constraints.
 */
export async function cropCenterToStoryAspect(
  inputPath: string,
  outputPath: string,
): Promise<VideoProbe> {
  await runFfmpeg([
    '-i',
    inputPath,
    '-vf',
    'scale=540:960:force_original_aspect_ratio=increase,crop=540:960',
    '-c:a',
    'copy',
    outputPath,
  ])
  return probeVideo(outputPath)
}

/**
 * Scale and letterbox/pillarbox a video to an exact target resolution.
 * The source is shrunk to fit inside the target box and centred over a black
 * background — preserving aspect ratio without cropping.
 */
export async function rescaleVideo(
  inputPath: string,
  outputPath: string,
  width: number,
  height: number,
): Promise<VideoProbe> {
  await runFfmpeg([
    '-i', inputPath,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    '-c:a', 'copy',
    outputPath,
  ])
  return probeVideo(outputPath)
}

export async function loopVideo(inputPath: string, outputPath: string, times: number): Promise<void> {
  if (times < 2) {
    await fs.copyFile(inputPath, outputPath)
    return
  }
  await runFfmpeg([
    '-stream_loop',
    String(times - 1),
    '-i',
    inputPath,
    '-c',
    'copy',
    outputPath,
  ])
}

export async function mergeAudioVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  // Explicitly map the video from input 0 and the audio from input 1. Without
  // explicit maps ffmpeg auto-selects one audio stream across all inputs, which
  // can pick a stray/silent track on the video container instead of the
  // narration we want to mux in.
  await runFfmpeg([
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    outputPath,
  ])
}

/** Generate a silent stereo AAC clip of the given duration (seconds). */
export async function makeSilenceAudio(outputPath: string, durationSec: number): Promise<void> {
  await runFfmpeg([
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', String(durationSec),
    '-c:a', 'aac',
    outputPath,
  ])
}

/**
 * Re-encode an audio file to exactly `durationSec` seconds, padding the tail
 * with silence when the source is shorter. Used to make each slide's narration
 * clip a fixed length so the concatenated track aligns with slide boundaries.
 */
export async function padAudioToDuration(
  inputPath: string,
  outputPath: string,
  durationSec: number,
): Promise<void> {
  await runFfmpeg([
    '-i', inputPath,
    '-af', 'apad',
    '-t', String(durationSec),
    '-ar', '44100',
    '-ac', '2',
    '-c:a', 'aac',
    outputPath,
  ])
}

/** Concatenate audio files into a single contiguous AAC track (re-encoded). */
export async function concatAudioFiles(paths: string[], outputPath: string): Promise<void> {
  if (paths.length === 0) throw new Error('No audio files to concatenate')
  if (paths.length === 1) {
    await fs.copyFile(paths[0], outputPath)
    return
  }
  const inputs = paths.flatMap((p) => ['-i', p])
  const filter =
    paths.map((_, i) => `[${i}:a]`).join('') + `concat=n=${paths.length}:v=0:a=1[a]`
  await runFfmpeg([
    ...inputs,
    '-filter_complex', filter,
    '-map', '[a]',
    '-ar', '44100',
    '-ac', '2',
    '-c:a', 'aac',
    outputPath,
  ])
}

/**
 * Write a drawtext string to a temp file and return its path, so the text can be
 * referenced via `drawtext=textfile=<path>` instead of `text=<inline>`.
 *
 * This sidesteps FFmpeg's two-level filtergraph escaping entirely: file contents
 * are rendered verbatim and never pass through either the filtergraph parser
 * (which splits on `,` `;` `[` `]` and processes `\` `'`) or the option parser
 * (which splits on `:`). As a result, arbitrary LLM-generated text — apostrophes,
 * colons, commas, percent signs, em-dashes, brackets, emoji — renders correctly
 * with zero escaping. Combined with `expansion=none`, even `%` and `\` are literal.
 *
 * Files live inside the per-render temp directory (dirname of the output path),
 * which `withTempDir` removes after the job completes, so no manual cleanup is needed.
 */
let drawtextFileSeq = 0
async function writeDrawtextFile(dir: string, text: string): Promise<string> {
  const filePath = path.join(dir, `drawtext-${drawtextFileSeq++}.txt`)
  await fs.writeFile(filePath, text, 'utf8')
  return filePath
}

/** Minimal word-wrap used for title overlay sizing (mirrors svg-utils wrapText). */
function wrapTitle(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
      if (lines.length >= maxLines) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines.slice(0, maxLines)
}

/**
 * Overlay the article title on a video clip using the carousel title-slide
 * design: a dark semi-transparent box sized only around the text (not a
 * full-frame veil), centred slightly above the vertical midpoint.
 *
 * Layout values are scaled to the actual video dimensions so the design holds
 * for both 720×720 Seedance clips and 1080×1080 slideshow frames.
 */
export async function overlayTitleOnVideo(
  inputPath: string,
  outputPath: string,
  title: string,
  fontPath: string = defaultFontPath(),
): Promise<void> {
  const { width, height } = await probeVideo(inputPath)
  const scale = height / 1080

  const lines = wrapTitle(title, 22, 5)
  const fontSize  = Math.round(52  * scale)
  const lineH     = Math.round(68  * scale)
  const boxPadV   = Math.round(36  * scale)
  const boxPadH   = Math.round(60  * scale)
  const boxW      = width - 2 * boxPadH
  const boxH      = lines.length * lineH + 2 * boxPadV
  const boxX      = boxPadH
  // Slightly above vertical centre, matching the carousel title slide
  const boxY      = Math.round((height - boxH) / 2) - Math.round(40 * scale)

  const darkBox = `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=black@0.65:t=fill`

  const dir = path.dirname(outputPath)
  // ffmpeg drawtext y is the TOP of the text; centre each line in its lineH slot.
  const lineOffset = Math.round((lineH - fontSize) / 2)
  const textFilters = await Promise.all(
    lines.map(async (line, i) => {
      const y = boxY + boxPadV + i * lineH + lineOffset
      const tf = await writeDrawtextFile(dir, line)
      return `drawtext=fontfile=${fontPath}:textfile=${tf}:expansion=none:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=${y}`
    }),
  )

  const vf = [darkBox, ...textFilters].join(',')
  await runFfmpeg(['-i', inputPath, '-vf', vf, '-c:a', 'copy', outputPath])
}

export interface TitleFadeFilters {
  /** Comma-joined drawbox + drawtext chain rendering the title box. */
  overlayChain: string
}

/**
 * Filtergraph lines that composite a fading-in title layer over `inputLabel`,
 * writing the result to `outLabel`.
 *
 * ffmpeg 8 regressed `blend=all_expr` (the old crossfade approach) to
 * ~0.01x realtime — a 3s 1080x1920 clip took 90s+ of CPU (observed on both
 * droplets, 2026-08-19). This replaces it with native filters: the title
 * box+text is drawn once on a transparent RGBA canvas, alpha-faded in with
 * `fade`, and composited with `overlay` — visually identical, orders of
 * magnitude faster, and version-stable.
 *
 * fadeDuration <= 0 → the title is baked directly into the stream (no layer,
 * no fade), which is also the cheapest possible path.
 */
export function titleFadeGraph(
  inputLabel: string,
  outLabel: string,
  overlayChain: string,
  width: number,
  height: number,
  fadeStart: number,
  fadeDuration: number,
): string[] {
  if (fadeDuration <= 0) {
    return [`[${inputLabel}]${overlayChain}[${outLabel}]`]
  }
  const layer =
    `color=c=black@0.0:s=${width}x${height}:r=30,format=rgba,` +
    `${overlayChain},fade=t=in:st=${fadeStart}:d=${fadeDuration}:alpha=1[__ttl_${outLabel}]`
  return [layer, `[${inputLabel}][__ttl_${outLabel}]overlay=shortest=1[${outLabel}]`]
}

/**
 * Build the title-box overlay chain + fade-in blend expression used by
 * overlayTitleOnVideoFadeIn, laid out for the given frame dimensions.
 * Exposed separately so single-pass pipelines (buildHookVideo) can embed the
 * same design inside a larger filter graph without an intermediate encode.
 *
 * Blend ramp: 0 → base (clean), 1 → overlaid.
 * clip((T - fadeStart) / fadeDuration, 0, 1) gives 0 before fade, 1 after.
 * Commas inside the clip() call must be escaped as \\, inside the expression string.
 */
export async function buildTitleFadeFilters(
  dir: string,
  title: string,
  width: number,
  height: number,
  fontPath: string = defaultFontPath(),
): Promise<TitleFadeFilters> {
  const scale = height / 1080

  const lines = wrapTitle(title, 22, 5)
  const fontSize = Math.round(52 * scale)
  const lineH    = Math.round(68 * scale)
  const boxPadV  = Math.round(36 * scale)
  const boxPadH  = Math.round(60 * scale)
  const boxW     = width - 2 * boxPadH
  const boxH     = lines.length * lineH + 2 * boxPadV
  const boxX     = boxPadH
  const boxY     = Math.round((height - boxH) / 2) - Math.round(40 * scale)

  // Write each text line to a temp file (avoids all filtergraph escaping issues).
  // ffmpeg drawtext y is the TOP of the text; centre each line in its lineH slot.
  const lineOffset = Math.round((lineH - fontSize) / 2)
  const textFilters = await Promise.all(
    lines.map(async (line, i) => {
      const y = boxY + boxPadV + i * lineH + lineOffset
      const tf = await writeDrawtextFile(dir, line)
      return `drawtext=fontfile=${fontPath}:textfile=${tf}:expansion=none:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=${y}`
    }),
  )

  const overlayChain = [
    // replace=1: this chain renders onto titleFadeGraph's TRANSPARENT layer,
    // where plain drawbox blends color channels but never writes alpha — the
    // box has been invisible since the ffmpeg-8 fade+overlay rework (found
    // 2026-09-07). replace=1 writes the alpha so the box actually composites.
    `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=black@0.65:t=fill:replace=1`,
    ...textFilters,
  ].join(',')

  return { overlayChain }
}

/**
 * Same as overlayTitleOnVideo but the title box + text fade in smoothly.
 *
 * Implementation: splits the video into two streams — a clean base and a
 * fully-overlaid copy — then blends them using a time-based ramp so the
 * overlay is invisible before `fadeStart`, fully opaque after
 * `fadeStart + fadeDuration`, and cross-fades linearly in between.
 *
 * Uses `-filter_complex` with FFmpeg's `blend` filter.
 */
export async function overlayTitleOnVideoFadeIn(
  inputPath: string,
  outputPath: string,
  title: string,
  fontPath: string = defaultFontPath(),
  fadeStart = 1.0,
  fadeDuration = 0.5,
): Promise<void> {
  const { width, height } = await probeVideo(inputPath)
  const dir = path.dirname(outputPath)

  const { overlayChain } = await buildTitleFadeFilters(dir, title, width, height, fontPath)

  const filterComplex = titleFadeGraph('0:v', 'out', overlayChain, width, height, fadeStart, fadeDuration).join(';')

  await runFfmpeg([
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:a', 'copy',
    outputPath,
  ])
}

/**
 * Same as overlayTitleOnVideoFadeIn but uses a full-width horizontal strip
 * instead of a narrower box.
 *
 * The strip spans the full video width, is vertically centred, and its height
 * is sized around the wrapped title lines.  Layout is anchored to video WIDTH
 * (not height) so that 9:16 story videos (1080×1920) get the same font size
 * as 1:1 feed videos — using height-based scale would produce enormous text on
 * portrait clips.
 */
export async function overlayTitleOnVideoStripFadeIn(
  inputPath: string,
  outputPath: string,
  title: string,
  fontPath: string = defaultFontPath(),
  fadeStart = 1.0,
  fadeDuration = 0.5,
  // Full-frame dark brand veil (e.g. "0x052234") replacing the title strip:
  // the strip alone left ~80% of a bright title screen untreated (user
  // 2026-09-07); with the veil the title sits directly on the darkened frame,
  // matching the KT music video treatment.
  veilHex?: string,
): Promise<void> {
  const { width, height } = await probeVideo(inputPath)
  // Anchor to width so 9:16 and 1:1 clips get the same font size
  const scale = width / 1080

  // 4 lines (was 3, user 2026-09-07): story hooks used as titles run ~12-20
  // words; 3×30 chars cut them mid-sentence ("...airbags into a").
  const lines    = wrapTitle(title, 30, 4)
  const fontSize = Math.round(52 * scale)
  const lineH    = Math.round(68 * scale)
  const padV     = Math.round(40 * scale)
  const stripH   = lines.length * lineH + 2 * padV
  const stripY   = Math.round((height - stripH) / 2)

  const dir = path.dirname(outputPath)

  // ffmpeg drawtext y is the TOP of the text. Centre each line inside its lineH
  // slot with (lineH - fontSize)/2 so the block sits symmetrically in the strip.
  const lineOffset = Math.round((lineH - fontSize) / 2)
  const textFilters = await Promise.all(
    lines.map(async (line, i) => {
      const y = stripY + padV + i * lineH + lineOffset
      const tf = await writeDrawtextFile(dir, line)
      return `drawtext=fontfile=${fontPath}:textfile=${tf}:expansion=none:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=${y}`
    }),
  )

  const overlayChain = [
    // replace=1 on both: see buildTitleFadeFilters — drawbox without it is
    // invisible on the transparent fade layer (alpha never written).
    veilHex
      ? `drawbox=x=0:y=0:w=iw:h=ih:color=${veilHex}@0.85:t=fill:replace=1`
      : // 0.8 (was 0.65, 2026-09-03): near-white motif canvases left the strip
        // mid-grey and the white title marginal.
        `drawbox=x=0:y=${stripY}:w=iw:h=${stripH}:color=black@0.8:t=fill:replace=1`,
    ...textFilters,
  ].join(',')

  const filterComplex = titleFadeGraph('0:v', 'out', overlayChain, width, height, fadeStart, fadeDuration).join(';')

  await runFfmpeg([
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:a', 'copy',
    outputPath,
  ])
}

/**
 * Word-wrap a single bullet into display lines of at most `maxChars` content
 * characters each. The first line is prefixed with "- " and continuation lines
 * with "  " so the text stays aligned under the first character after the dash.
 * Used by `overlayBulletsOnVideo` (no-headline variant).
 */
function wrapBulletLines(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/)
  const contentLines: string[] = []
  let current = ''

  for (const word of words) {
    const w = word.slice(0, maxChars) // guard against a single word longer than the limit
    if (!current) {
      current = w
    } else {
      const candidate = `${current} ${w}`
      if (candidate.length <= maxChars) {
        current = candidate
      } else {
        contentLines.push(current)
        current = w
      }
    }
  }
  if (current) contentLines.push(current)

  return contentLines.map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`))
}

/**
 * Word-wrap text into plain lines (no prefix). Used for ✓-prefixed bullets
 * where the checkmark is rendered as a separate drawtext layer.
 */
function wrapTextLines(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const w = word.slice(0, maxChars)
    if (!current) {
      current = w
    } else {
      const candidate = `${current} ${w}`
      if (candidate.length <= maxChars) {
        current = candidate
      } else {
        lines.push(current)
        current = w
      }
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Overlay a full-frame dark veil + vertically centred bullet list (F2/S2 Video Reel).
 * Bullet text word-wraps at 50 characters per line; continuation lines are indented
 * to align with the text after the "- " prefix. An empty-line gap separates bullets.
 */
import { KT_BULLET_LEADING, KT_INTER_BULLET_EM, KT_HEADLINE_SCALE, KT_HEADLINE_LEADING, KT_HEADLINE_GAP_FACTOR, KT_BULLET_GLYPH_W, KT_HEADLINE_GLYPH_W } from '../kt-frame-metrics'

export async function overlayBulletsOnVideo(
  inputPath: string,
  outputPath: string,
  bullets: string[],
  fontPath: string = helveticaNeweLightFontPath(),
  /** Veil color as 0xRRGGBB (ffmpeg drawbox syntax). Default black. */
  veilColor: string = 'black',
  veilOpacity = 0.75,
  /** Curiosity headline rendered above the list (KT loop-bait, 2026-09-08). */
  headline?: string,
): Promise<void> {
  const { width, height } = await probeVideo(inputPath)
  const scale = height / 1080

  // Fit the block to the ACTUAL frame (2026-08-24 KT-video QA: fixed 50-char
  // wrap overflowed a 704px-wide Seedance frame, and long verbatim bullets
  // overflowed vertically). Wrap width derives from the frame width; the font
  // auto-shrinks to fit the height, then trailing bullets drop with an
  // ellipsis as the last resort.
  const usableW = width * 0.84 // x = 8% margin each side
  const maxBlockH = height * 0.88
  const list = bullets.slice(0, 6)

  let bulletFontSize = Math.round(36 * scale)
  let bulletLineHeight = Math.round(52 * scale)
  let interBulletGap = bulletLineHeight
  let wrappedBullets: string[][] = []
  let headlineFontSize = 0
  let headlineLineHeight = 0
  let headlineGap = 0
  let headlineLines: string[] = []
  for (let base = 36; base >= 24; base -= 2) {
    bulletFontSize = Math.round(base * scale)
    bulletLineHeight = Math.round(base * KT_BULLET_LEADING * scale)
    interBulletGap = Math.round(base * KT_INTER_BULLET_EM * scale)
    const chars = Math.max(20, Math.floor(usableW / (bulletFontSize * KT_BULLET_GLYPH_W)))
    wrappedBullets = list.map((b) => wrapBulletLines(b, chars))
    let headlineBlockH = 0
    if (headline) {
      headlineFontSize = Math.round(base * KT_HEADLINE_SCALE * scale)
      headlineLineHeight = Math.round(base * KT_HEADLINE_SCALE * KT_HEADLINE_LEADING * scale)
      headlineGap = Math.round(interBulletGap * KT_HEADLINE_GAP_FACTOR)
      const hChars = Math.max(14, Math.floor(usableW / (headlineFontSize * KT_HEADLINE_GLYPH_W)))
      headlineLines = wrapTitle(headline, hChars, 3)
      headlineBlockH = headlineLines.length * headlineLineHeight + headlineGap
    }
    const lines = wrappedBullets.reduce((n, g) => n + g.length, 0)
    const h = headlineBlockH + lines * bulletLineHeight + (wrappedBullets.length - 1) * interBulletGap
    if (h <= maxBlockH) break
  }
  const headlineBlockHeight = headline ? headlineLines.length * headlineLineHeight + headlineGap : 0

  // Still too tall at the floor → drop trailing bullets, mark with ellipsis.
  {
    const fits = (groups: string[][]) =>
      headlineBlockHeight +
        groups.reduce((n, g) => n + g.length, 0) * bulletLineHeight +
        Math.max(0, groups.length - 1) * interBulletGap <=
      maxBlockH
    while (wrappedBullets.length > 1 && !fits(wrappedBullets)) {
      wrappedBullets.pop()
    }
    if (wrappedBullets.length < list.length) {
      const last = wrappedBullets[wrappedBullets.length - 1]
      last[last.length - 1] = last[last.length - 1].replace(/[.,;:\s]*$/, '') + '…'
    }
  }

  // Total block height: all wrapped lines + one gap between each bullet pair.
  const totalLines = wrappedBullets.reduce((n, lines) => n + lines.length, 0)
  const totalGaps  = wrappedBullets.length - 1
  const bulletBlockHeight = headlineBlockHeight + totalLines * bulletLineHeight + totalGaps * interBulletGap
  const startY = Math.max(Math.round(height * 0.06), Math.round((height - bulletBlockHeight) / 2))

  const dir = path.dirname(outputPath)
  const bulletFilters: string[] = []
  let currentY = startY
  if (headline && headlineLines.length) {
    const headFont = helveticaNeueMediumFontPath()
    for (const line of headlineLines) {
      const tf = await writeDrawtextFile(dir, line)
      bulletFilters.push(
        `drawtext=fontfile=${headFont}:textfile=${tf}:expansion=none:fontcolor=white:fontsize=${headlineFontSize}:x=w*0.08:y=${currentY}`,
      )
      currentY += headlineLineHeight
    }
    currentY += headlineGap
  }
  for (let bi = 0; bi < wrappedBullets.length; bi++) {
    for (const line of wrappedBullets[bi]) {
      const tf = await writeDrawtextFile(dir, line)
      bulletFilters.push(
        `drawtext=fontfile=${fontPath}:textfile=${tf}:expansion=none:fontcolor=white:fontsize=${bulletFontSize}:x=w*0.08:y=${currentY}`,
      )
      currentY += bulletLineHeight
    }
    if (bi < wrappedBullets.length - 1) currentY += interBulletGap
  }

  const vf = [
    `drawbox=x=0:y=0:w=iw:h=ih:color=${veilColor}@${veilOpacity}:t=fill`,
    ...bulletFilters,
  ].join(',')

  await runFfmpeg(['-i', inputPath, '-vf', vf, '-c:a', 'copy', outputPath])
}

/**
 * Overlay a full-frame dark veil + headline + ✓ bullet list on a video (F2/S2 Video Reel).
 *
 * - Full-frame black@0.75 dark veil
 * - Headline: Helvetica Neue Medium, 32 px, left-aligned, word-wraps at 38 chars/line (max 3 lines)
 * - Bullets: ✓ glyph rendered with DejaVu Sans (which carries the glyph) and the
 *   bullet text rendered side-by-side with Helvetica Neue Light, both 24 px.
 *   Continuation lines are indented to align with the text start.
 * - Word-wrap at 50 chars per line for bullet text; up to 7 bullets.
 * - Empty-line gap between consecutive bullets.
 */
export async function overlayTitleAndBulletsOnVideo(
  inputPath: string,
  outputPath: string,
  title: string,
  bullets: string[],
  titleFontPath: string = helveticaNeueMediumFontPath(),
  bulletFontPath: string = helveticaNeweLightFontPath(),
  checkFontPath: string = dejaVuSansFontPath(),
): Promise<void> {
  const TITLE_FS     = 32
  const BULLET_FS    = 24
  const TITLE_LH     = 40   // px per title line
  const BULLET_LH    = 30   // px per bullet line
  const INTER_GAP    = 18   // empty-line gap between consecutive bullets
  const CHECK_OFFSET = 24   // px the bullet text is shifted right of the ✓
  const TOP_PAD      = 80   // px from top of frame to first title line
  const TITLE_GAP    = 28   // px between last title line and first bullet

  const titleLines = wrapTitle(title, REEL_HEADLINE_MAX_CHARS, REEL_HEADLINE_MAX_LINES)
  const list = bullets.slice(0, 7)
  const wrappedBullets = list.map((b) => wrapTextLines(b, 50))

  const xMargin = 'w*0.08'
  const xText   = `w*0.08+${CHECK_OFFSET}`
  const dir = path.dirname(outputPath)

  const filters: string[] = [
    `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.75:t=fill`,
  ]

  // Title lines
  for (let i = 0; i < titleLines.length; i++) {
    const y = TOP_PAD + i * TITLE_LH
    const tf = await writeDrawtextFile(dir, titleLines[i])
    filters.push(
      `drawtext=fontfile=${titleFontPath}:textfile=${tf}:expansion=none:fontcolor=white:fontsize=${TITLE_FS}:x=${xMargin}:y=${y}`,
    )
  }

  // Bullet block starts below the title
  const bulletStartY = TOP_PAD + titleLines.length * TITLE_LH + TITLE_GAP

  let currentY = bulletStartY
  for (let bi = 0; bi < wrappedBullets.length; bi++) {
    const lines = wrappedBullets[bi]
    for (let li = 0; li < lines.length; li++) {
      const y = currentY + li * BULLET_LH
      if (li === 0) {
        // ✓ glyph in DejaVu. The checkmark (U+2713) carries no ffmpeg-special
        // characters, so it stays safe inline without a textfile.
        filters.push(
          `drawtext=fontfile=${checkFontPath}:text=✓:expansion=none:fontcolor=white:fontsize=${BULLET_FS}:x=${xMargin}:y=${y}`,
        )
      }
      // Bullet text in Helvetica Neue Light (all lines, including first)
      const tf = await writeDrawtextFile(dir, lines[li])
      filters.push(
        `drawtext=fontfile=${bulletFontPath}:textfile=${tf}:expansion=none:fontcolor=white:fontsize=${BULLET_FS}:x=${xText}:y=${y}`,
      )
    }
    currentY += lines.length * BULLET_LH
    if (bi < wrappedBullets.length - 1) currentY += INTER_GAP
  }

  const vf = filters.join(',')
  await runFfmpeg(['-i', inputPath, '-vf', vf, '-c:a', 'copy', outputPath])
}

/**
 * Shared layout factors for the KT music-video frame. The ffmpeg overlay
 * (video/ffmpeg.ts overlayBulletsOnVideo) and the short-takeaways fit
 * estimator (generators/short-takeaways.ts) MUST use the same numbers —
 * duplicated constants drifted twice on 2026-09-08.
 */
/** Within-bullet leading, × font size (user 2026-09-08: 1.44 read too airy). */
export const KT_BULLET_LEADING = 1.25
/** Gap between bullets, × font size. */
export const KT_INTER_BULLET_EM = 0.9
/** Headline font, × bullet base font. */
export const KT_HEADLINE_SCALE = 1.35
/** Headline leading, × headline font size. */
export const KT_HEADLINE_LEADING = 1.3
/** Gap below the headline block, × inter-bullet gap. */
export const KT_HEADLINE_GAP_FACTOR = 1.2
/** Average glyph width, × font size (Helvetica Neue Light wrap estimate). */
export const KT_BULLET_GLYPH_W = 0.52
/** Average glyph width for the Medium headline face. */
export const KT_HEADLINE_GLYPH_W = 0.55

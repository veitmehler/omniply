import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../middleware/admin'
import { prisma, uploadBufferWithKey, deleteS3Keys } from '@omniply/shared'
import { withTempDir, runFfmpeg, probeVideo } from '../../social/video/ffmpeg'

// Music uploads go DIRECT from the admin browser to this API (the Vercel
// proxy caps request bodies at 4.5 MB — unusable for WAV). 100 MB covers
// ~10 min of raw stereo WAV; everything is transcoded to AAC on arrival.
const MAX_FILE_BYTES = 100 * 1024 * 1024

/** Magic-number sniff (L4 convention) — never trust the multipart mimetype. */
function sniffAudioFormat(buf: Buffer): 'mp3' | 'm4a' | 'wav' | null {
  if (buf.length < 12) return null
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3'
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3'
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'm4a'
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WAVE'
  ) {
    return 'wav'
  }
  return null
}

export async function musicAdminRoutes(app: FastifyInstance) {
  // GET /api/admin/music — list all tracks
  app.get('/music', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    const tracks = await prisma.musicTrack.findMany({ orderBy: { createdAt: 'desc' } })
    return reply.send(tracks)
  })

  // POST /api/admin/music — multipart upload (field "file", optional field "title").
  // Loudness-normalizes (EBU R128, −16 LUFS) and transcodes to AAC so every
  // track mixes at a predictable level in the video pipeline.
  app.post('/music', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return

    // Per-request override of the global 25 MB multipart cap (sized for
    // voice samples); toBuffer() throws when the stream exceeds it.
    const data = await request.file({ limits: { fileSize: MAX_FILE_BYTES } })
    if (!data) return reply.status(400).send({ error: 'No file uploaded (field "file")' })

    let buf: Buffer
    try {
      buf = await data.toBuffer()
    } catch {
      return reply.status(400).send({ error: 'File too large (max 100 MB)' })
    }
    if (buf.length > MAX_FILE_BYTES) {
      return reply.status(400).send({ error: 'File too large (max 100 MB)' })
    }

    const format = sniffAudioFormat(buf)
    if (!format) {
      return reply.status(400).send({ error: 'Unsupported audio format — upload MP3, M4A, or WAV' })
    }

    const titleField = data.fields?.title
    const title =
      (titleField && 'value' in titleField ? String(titleField.value).trim() : '') ||
      path.parse(data.filename ?? 'Untitled track').name

    const id = randomUUID()

    const { normalized, duration } = await withTempDir('music-ingest-', async (tmpDir) => {
      const rawPath = path.join(tmpDir, `raw.${format}`)
      const outPath = path.join(tmpDir, 'normalized.m4a')
      await fs.writeFile(rawPath, buf)

      await runFfmpeg([
        '-i', rawPath,
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ar', '44100', '-ac', '2',
        '-c:a', 'aac', '-b:a', '192k',
        '-vn',
        outPath,
      ])

      const probe = await probeVideo(outPath) // audio-only: duration comes from format
      return { normalized: await fs.readFile(outPath), duration: probe.duration }
    })

    if (!duration || duration <= 0) {
      return reply.status(400).send({ error: 'Could not read audio duration after normalization' })
    }

    const s3Key = `system/music/${id}.m4a`
    const { url } = await uploadBufferWithKey(s3Key, normalized, 'audio/mp4')

    const track = await prisma.musicTrack.create({
      data: { id, title, s3Key, url, duration },
    })

    request.log.info({ trackId: id, title, duration }, '[admin] music track uploaded')
    return reply.status(201).send(track)
  })

  // PATCH /api/admin/music/:id — rename / toggle active
  app.patch<{ Params: { id: string }; Body: { title?: string; isActive?: boolean } }>(
    '/music/:id',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply)
      if (!admin) return

      const { title, isActive } = request.body ?? {}
      const data: { title?: string; isActive?: boolean } = {}
      if (typeof title === 'string' && title.trim()) data.title = title.trim()
      if (typeof isActive === 'boolean') data.isActive = isActive
      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: 'Nothing to update' })
      }

      const track = await prisma.musicTrack
        .update({ where: { id: request.params.id }, data })
        .catch(() => null)
      if (!track) return reply.status(404).send({ error: 'Track not found' })
      return reply.send(track)
    },
  )

  // DELETE /api/admin/music/:id
  app.delete<{ Params: { id: string } }>('/music/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return

    const track = await prisma.musicTrack
      .delete({ where: { id: request.params.id } })
      .catch(() => null)
    if (!track) return reply.status(404).send({ error: 'Track not found' })

    await deleteS3Keys([track.s3Key]).catch((err) =>
      request.log.warn({ err, s3Key: track.s3Key }, '[admin] failed to delete music S3 object'),
    )

    return reply.send({ ok: true })
  })
}

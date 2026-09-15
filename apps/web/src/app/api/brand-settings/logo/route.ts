import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { prisma, brandSettingsForUser, canonicalAccountUserId } from '@omniply/shared'

// ── S3 helpers ───────────────────────────────────────────────────────────────

function getS3Client(): S3Client {
  const accessKeyId = process.env.ACCESS_KEY_ID
  const secretAccessKey = process.env.SECRET_ACCESS_KEY
  const region = process.env.S3_REGION ?? 'us-east-1'
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing S3 credentials')
  }
  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET
  if (!bucket) throw new Error('S3_BUCKET env var is not set')
  return bucket
}

function getCdnBase(): string {
  return (process.env.CDN_BASE ?? '').replace(/\/$/, '')
}

/** Derive a stable S3 key for the user's logo, e.g. brand-assets/{userId}/logo.png */
function logoKey(userId: string, ext: string): string {
  return `brand-assets/${userId}/logo.${ext}`
}

/** Extract the S3 key from a full CDN URL. */
function keyFromUrl(cdnUrl: string): string | null {
  try {
    const path = new URL(cdnUrl).pathname.replace(/^\//, '')
    return path || null
  } catch {
    return null
  }
}

async function getUserId(clerkId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } })
  return user?.id ?? null
}

// ── MIME → extension map ─────────────────────────────────────────────────────

const ALLOWED: Record<string, string> = {
  'image/png':       'png',
  'image/jpeg':      'jpg',
  'image/jpg':       'jpg',
  'image/webp':      'webp',
  'image/svg+xml':   'svg',
}

// ── POST /api/brand-settings/logo — upload / replace logo ───────────────────

export async function POST(request: NextRequest) {
  try {
    const clerkId = await resolveClerkId()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userId = await getUserId(clerkId)
    if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    // Validate type
    const ext = ALLOWED[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: 'Unsupported file type. Use PNG, JPG, WebP or SVG.' },
        { status: 400 },
      )
    }

    // Validate size (max 2 MB)
    const MAX_BYTES = 2 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Logo must be smaller than 2 MB.' },
        { status: 400 },
      )
    }

    // If user already has a logo with a DIFFERENT key (different extension), delete the old object
    const existing = await brandSettingsForUser(userId)
    const ownerUserId = await canonicalAccountUserId(userId)
    const newKey = logoKey(userId, ext)
    if (existing?.organizationLogoUrl) {
      const oldKey = keyFromUrl(existing.organizationLogoUrl)
      if (oldKey && oldKey !== newKey) {
        try {
          await getS3Client().send(
            new DeleteObjectCommand({ Bucket: getBucket(), Key: oldKey }),
          )
        } catch { /* non-fatal — continue even if old file can't be deleted */ }
      }
    }

    // Upload with stable key (overwriting any previous file at the same key)
    const buffer = Buffer.from(await file.arrayBuffer())
    await getS3Client().send(
      new PutObjectCommand({
        Bucket:      getBucket(),
        Key:         newKey,
        Body:        buffer,
        ContentType: file.type,
      }),
    )

    const url = `${getCdnBase()}/${newKey}`

    // Persist URL immediately — no need for a separate Save click
    await prisma.brandSettings.upsert({
      where:  { userId: ownerUserId },
      create: { userId: ownerUserId, organizationLogoUrl: url },
      update: { organizationLogoUrl: url },
    })

    return NextResponse.json({ url })
  } catch (err) {
    console.error('[brand-settings/logo] POST error:', err)
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
  }
}

// ── DELETE /api/brand-settings/logo — remove logo ───────────────────────────

export async function DELETE() {
  try {
    const clerkId = await resolveClerkId()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userId = await getUserId(clerkId)
    if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const settings = await brandSettingsForUser(userId)

    if (settings?.organizationLogoUrl) {
      const key = keyFromUrl(settings.organizationLogoUrl)
      if (key) {
        try {
          await getS3Client().send(
            new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
          )
        } catch { /* non-fatal */ }
      }
    }

    await prisma.brandSettings.updateMany({
      where: { userId: await canonicalAccountUserId(userId) },
      data:  { organizationLogoUrl: null },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[brand-settings/logo] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to remove logo' }, { status: 500 })
  }
}

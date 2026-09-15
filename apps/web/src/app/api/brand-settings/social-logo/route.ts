import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { prisma, brandSettingsForUser, canonicalAccountUserId } from '@omniply/shared'

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

function socialLogoKey(userId: string, ext: string): string {
  return `brand-assets/${userId}/social-logo.${ext}`
}

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

const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
}

export async function POST(request: NextRequest) {
  try {
    const clerkId = await resolveClerkId()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userId = await getUserId(clerkId)
    if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const ext = ALLOWED[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: 'Unsupported file type. Use PNG, JPG, or WebP.' },
        { status: 400 },
      )
    }

    const MAX_BYTES = 2 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Logo must be smaller than 2 MB.' }, { status: 400 })
    }

    const existing = await brandSettingsForUser(userId)
    const ownerUserId = await canonicalAccountUserId(userId)
    const newKey = socialLogoKey(userId, ext)
    if (existing?.socialLogoUrl) {
      const oldKey = keyFromUrl(existing.socialLogoUrl)
      if (oldKey && oldKey !== newKey) {
        try {
          await getS3Client().send(
            new DeleteObjectCommand({ Bucket: getBucket(), Key: oldKey }),
          )
        } catch { /* non-fatal */ }
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: newKey,
        Body: buffer,
        ContentType: file.type,
      }),
    )

    const url = `${getCdnBase()}/${newKey}`

    await prisma.brandSettings.upsert({
      where: { userId: ownerUserId },
      create: { userId: ownerUserId, socialLogoUrl: url },
      update: { socialLogoUrl: url },
    })

    return NextResponse.json({ url })
  } catch (err) {
    console.error('[brand-settings/social-logo] POST error:', err)
    return NextResponse.json({ error: 'Failed to upload social logo' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const clerkId = await resolveClerkId()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userId = await getUserId(clerkId)
    if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const settings = await brandSettingsForUser(userId)

    if (settings?.socialLogoUrl) {
      const key = keyFromUrl(settings.socialLogoUrl)
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
      data: { socialLogoUrl: null },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[brand-settings/social-logo] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to remove social logo' }, { status: 500 })
  }
}

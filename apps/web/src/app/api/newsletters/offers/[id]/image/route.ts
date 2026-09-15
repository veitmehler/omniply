import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '@omniply/shared'

// Manual offer banner upload (alternative to AI generation). Persists
// NewsletterOffer.imageUrl. Verifies the offer belongs to the caller.

function getS3Client(): S3Client {
  const accessKeyId = process.env.ACCESS_KEY_ID
  const secretAccessKey = process.env.SECRET_ACCESS_KEY
  const region = process.env.S3_REGION ?? 'us-east-1'
  if (!accessKeyId || !secretAccessKey) throw new Error('Missing S3 credentials')
  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
}
const bucket = () => {
  const b = process.env.S3_BUCKET
  if (!b) throw new Error('S3_BUCKET not set')
  return b
}
const cdn = () => (process.env.CDN_BASE ?? '').replace(/\/$/, '')
const keyFromUrl = (u: string) => {
  try {
    return new URL(u).pathname.replace(/^\//, '') || null
  } catch {
    return null
  }
}
async function userId(clerkId: string) {
  const u = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } })
  return u?.id ?? null
}
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
}
type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const clerkId = await resolveClerkId()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const uid = await userId(clerkId)
    if (!uid) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const { id } = await params
    const offer = await prisma.newsletterOffer.findFirst({ where: { id, userId: uid }, select: { id: true, imageUrl: true } })
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

    const file = (await request.formData()).get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    const ext = ALLOWED[file.type]
    if (!ext) return NextResponse.json({ error: 'Use PNG, JPG or WebP.' }, { status: 400 })
    if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: 'Image must be under 4 MB.' }, { status: 400 })

    // Unique key per upload — CloudFront ignores query strings in its cache key.
    const key = `newsletter/offers/${uid}/${id}-upload-${Date.now().toString(36)}.${ext}`
    await getS3Client().send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: Buffer.from(await file.arrayBuffer()), ContentType: file.type }),
    )
    const url = `${cdn()}/${key}`
    await prisma.newsletterOffer.update({ where: { id }, data: { imageUrl: url } })
    return NextResponse.json({ imageUrl: url })
  } catch (err) {
    console.error('[offers/image] POST', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const clerkId = await resolveClerkId()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const uid = await userId(clerkId)
    if (!uid) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const { id } = await params
    const offer = await prisma.newsletterOffer.findFirst({ where: { id, userId: uid }, select: { id: true, imageUrl: true } })
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    if (offer.imageUrl) {
      const k = keyFromUrl(offer.imageUrl)
      if (k) {
        try {
          await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: k }))
        } catch {
          /* non-fatal */
        }
      }
      await prisma.newsletterOffer.update({ where: { id }, data: { imageUrl: null } })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[offers/image] DELETE', err)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}

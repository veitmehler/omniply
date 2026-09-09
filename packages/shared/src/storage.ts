/**
 * Object Storage — AWS S3 + CloudFront
 *
 * Drop-in replacement for the Supabase Storage functions in src/lib/supabase.ts.
 * All four function signatures are identical so call-sites only need an import change.
 *
 * File layout in S3:
 *   {userId}/{timestamp}-{randomId}.{ext}
 *
 * Public URL pattern (served via CloudFront OAC):
 *   https://cdn.omniply.io/{userId}/{timestamp}-{randomId}.{ext}
 *
 * Backward compatibility:
 *   extractFilePathFromUrl() and downloadImageFromStorage() transparently handle
 *   legacy Supabase Storage URLs so posts written before the migration keep working
 *   until all imageUrl values are updated by scripts/migrate-images.ts.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'

function getS3Client(): S3Client {
  const accessKeyId = process.env.ACCESS_KEY_ID
  const secretAccessKey = process.env.SECRET_ACCESS_KEY
  const region = process.env.S3_REGION ?? 'us-east-1'

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS credentials: ACCESS_KEY_ID and SECRET_ACCESS_KEY must be set')
  }

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET
  if (!bucket) throw new Error('S3_BUCKET env var is not set')
  return bucket
}

function getCdnBase(): string {
  const cdnBase = process.env.CDN_BASE
  if (!cdnBase) throw new Error('CDN_BASE env var is not set')
  return cdnBase.replace(/\/$/, '')
}

const SUPABASE_STORAGE_PATTERN = /\/storage\/v1\/object\/public\/post-images\/(.+)$/

/**
 * Upload an image to S3 and return its CloudFront public URL.
 * Accepts a File object (multipart upload) or a base64 data URL string (AI-generated images).
 */
export async function uploadImageToStorage(
  file: File | string,
  userId: string,
  fileName?: string
): Promise<{ url: string; path: string }> {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 9)
  const extension = fileName
    ? fileName.split('.').pop()
    : file instanceof File
    ? file.name.split('.').pop() || 'jpg'
    : 'jpg'

  const filePath = `${userId}/${timestamp}-${randomId}.${extension}`

  let fileBuffer: Buffer
  let contentType: string

  if (file instanceof File) {
    const arrayBuffer = await file.arrayBuffer()
    fileBuffer = Buffer.from(arrayBuffer)
    contentType = file.type || 'image/jpeg'
  } else {
    // base64 data URL: "data:image/png;base64,..."
    const base64Data = file.replace(/^data:image\/\w+;base64,/, '')
    fileBuffer = Buffer.from(base64Data, 'base64')
    const match = file.match(/^data:image\/(\w+);base64/)
    contentType = match ? `image/${match[1]}` : 'image/jpeg'
  }

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: filePath,
      Body: fileBuffer,
      ContentType: contentType,
    })
  )

  return {
    url: `${getCdnBase()}/${filePath}`,
    path: filePath,
  }
}

/**
 * Delete an image from S3 by its storage path (e.g. "userId/timestamp-id.jpg").
 */
export async function deleteImageFromStorage(filePath: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: filePath,
    })
  )
}

/**
 * Extract the storage path from a full image URL.
 * Handles both new CloudFront URLs and legacy Supabase Storage URLs.
 *
 * CloudFront:  https://cdn.omniply.io/userId/file.jpg  → "userId/file.jpg"
 * Supabase:    https://xxx.supabase.co/storage/v1/object/public/post-images/userId/file.jpg
 *              → "userId/file.jpg"
 */
export function extractFilePathFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)

    // Legacy Supabase Storage URL
    if (url.includes('supabase.co/storage')) {
      const match = urlObj.pathname.match(SUPABASE_STORAGE_PATTERN)
      return match ? match[1] : null
    }

    // CloudFront URL — pathname is "/{filePath}"
    const path = urlObj.pathname.replace(/^\//, '')
    return path || null
  } catch {
    return null
  }
}

/**
 * Upload a raw Buffer to S3 at an explicit key (for article featured images, diagrams, etc.).
 * Returns the CloudFront CDN URL.
 */
export async function uploadBufferWithKey(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ url: string; path: string }> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )
  return { url: `${getCdnBase()}/${key}`, path: key }
}

/**
 * Delete a specific list of S3 keys in one (or more) batched DeleteObjects calls.
 * Safe to call with an empty array — returns immediately.
 * Silently ignores keys that no longer exist.
 */
export async function deleteS3Keys(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const s3 = getS3Client()
  const bucket = getBucket()
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }))
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true },
      }),
    )
  }
}

/**
 * Delete all S3 objects whose keys start with `prefix`.
 * Processes up to 1000 objects per ListObjectsV2 page (S3 max per DeleteObjects call).
 * Safe to call even if no objects exist under the prefix.
 */
export async function deleteS3Prefix(prefix: string): Promise<void> {
  const s3 = getS3Client()
  const bucket = getBucket()
  let continuationToken: string | undefined

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )

    const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }))
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys, Quiet: true },
        }),
      )
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (continuationToken)
}

/**
 * Delete every object under `prefix` EXCEPT `keepKey`. Used to garbage-collect
 * superseded versions of an asset that uses unique (time-tokened) keys — call it
 * right after uploading the new version so prior versions don't accumulate.
 * Best-effort: never throws (cleanup must not break the caller).
 */
export async function deleteOldVersions(prefix: string, keepKey: string): Promise<number> {
  try {
    const s3 = getS3Client()
    const bucket = getBucket()
    const stale: string[] = []
    let continuationToken: string | undefined
    do {
      const list = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
      )
      for (const o of list.Contents ?? []) {
        if (o.Key && o.Key !== keepKey) stale.push(o.Key)
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
    } while (continuationToken)
    await deleteS3Keys(stale)
    return stale.length
  } catch {
    return 0
  }
}

/** List every key under `prefix` (paginated; oldest-first as S3 returns them). */
export async function listS3Keys(prefix: string): Promise<string[]> {
  const s3 = getS3Client()
  const bucket = getBucket()
  const keys: string[] = []
  let continuationToken: string | undefined
  do {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    )
    for (const o of list.Contents ?? []) if (o.Key) keys.push(o.Key)
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (continuationToken)
  return keys
}

/**
 * Read an object from S3 by its key and return its body as a Buffer.
 * Used server-side to proxy private/CORS-restricted objects to the browser.
 */
export async function readS3Object(key: string): Promise<{ body: Buffer; contentType: string }> {
  const s3 = getS3Client()
  const result = await s3.send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  )
  if (!result.Body) throw new Error(`S3 object empty: ${key}`)
  const bytes = await result.Body.transformToByteArray()
  return {
    body: Buffer.from(bytes),
    contentType: result.ContentType ?? 'application/octet-stream',
  }
}

/**
 * Download an image by its public URL and return a Buffer.
 * Works for both CloudFront URLs (new) and legacy Supabase Storage URLs.
 * Used server-side when attaching images to OAuth platform API calls.
 */
export async function downloadImageFromStorage(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl)

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

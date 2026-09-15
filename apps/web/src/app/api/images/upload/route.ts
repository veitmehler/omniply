import { NextRequest, NextResponse } from 'next/server'
import { resolveClerkId } from '@/lib/requestAuth'
import { uploadImageToStorage } from '@omniply/shared'
import { prisma } from '@omniply/shared'

/**
 * POST /api/images/upload - Upload an image to Supabase Storage
 * 
 * Accepts:
 * - FormData with 'file' field (File object)
 * - OR JSON with 'imageDataUrl' field (base64 data URL string)
 * 
 * Returns:
 * - { url: string, path: string } - Public URL and storage path
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { clerkId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check content type
    const contentType = request.headers.get('content-type') || ''

    let file: File | string
    let fileName: string | undefined

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData (File object)
      const formData = await request.formData()
      const fileData = formData.get('file') as File | null

      if (!fileData) {
        return NextResponse.json(
          { error: 'No file provided' },
          { status: 400 }
        )
      }

      // Validate file type
      if (!fileData.type.startsWith('image/')) {
        return NextResponse.json(
          { error: 'File must be an image' },
          { status: 400 }
        )
      }

      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024 // 10MB
      if (fileData.size > maxSize) {
        return NextResponse.json(
          { error: 'File size must be less than 10MB' },
          { status: 400 }
        )
      }

      file = fileData
      fileName = fileData.name
    } else {
      // Handle JSON (base64 data URL)
      const body = await request.json()
      const imageDataUrl = body.imageDataUrl

      if (!imageDataUrl || typeof imageDataUrl !== 'string') {
        return NextResponse.json(
          { error: 'No imageDataUrl provided' },
          { status: 400 }
        )
      }

      // Validate it's a data URL
      if (!imageDataUrl.startsWith('data:image/')) {
        return NextResponse.json(
          { error: 'Invalid image data URL format' },
          { status: 400 }
        )
      }

      // Validate size (base64 is ~33% larger, so check for ~13MB base64 = ~10MB image)
      const base64Size = imageDataUrl.length
      const maxBase64Size = 13 * 1024 * 1024 // ~13MB base64 = ~10MB image
      if (base64Size > maxBase64Size) {
        return NextResponse.json(
          { error: 'Image size must be less than 10MB' },
          { status: 400 }
        )
      }

      file = imageDataUrl
    }

    // Upload to S3
    const { url, path } = await uploadImageToStorage(file, user.id, fileName)

    await prisma.media.create({
      data: {
        userId: user.id,
        s3Key: path,
        url,
        source: 'upload',
        title: fileName ?? 'Uploaded image',
      },
    }).catch(() => {/* non-fatal */})

    return NextResponse.json({
      success: true,
      url,
      path,
    })
  } catch (error) {
    console.error('Error uploading image:', error)
    return NextResponse.json(
      {
        error: 'Failed to upload image',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/images/upload - Delete an image from Supabase Storage
 * 
 * Accepts:
 * - JSON with 'url' field (full Supabase Storage URL)
 * - OR JSON with 'path' field (storage path)
 */
export async function DELETE(request: NextRequest) {
  try {
    // Authenticate user
    const authResult = { userId: await resolveClerkId() }
    const clerkId = authResult.userId

    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { url, path: filePath } = body

    if (!url && !filePath) {
      return NextResponse.json(
        { error: 'Either url or path must be provided' },
        { status: 400 }
      )
    }

    // Extract path from URL if needed
    const { deleteImageFromStorage, extractFilePathFromUrl } = await import('@omniply/shared')
    const finalPath = filePath || extractFilePathFromUrl(url)

    if (!finalPath) {
      return NextResponse.json(
        { error: 'Could not extract file path from URL' },
        { status: 400 }
      )
    }

    // Verify user owns this file (path starts with userId)
    const user = await prisma.user.findUnique({
      where: { clerkId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (!finalPath.startsWith(`${user.id}/`)) {
      return NextResponse.json(
        { error: 'Unauthorized: You can only delete your own images' },
        { status: 403 }
      )
    }

    // Delete from storage
    await deleteImageFromStorage(finalPath)

    return NextResponse.json({
      success: true,
      message: 'Image deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting image:', error)
    return NextResponse.json(
      {
        error: 'Failed to delete image',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}


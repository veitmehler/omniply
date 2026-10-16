export const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
export const GHL_API_VERSION = '2021-07-28'

export const GHL_PLATFORMS = ['linkedin', 'facebook', 'instagram', 'threads'] as const
export type GhlPlatform = (typeof GHL_PLATFORMS)[number]

export type GhlAccountIds = {
  facebook?: string
  instagram?: string
  linkedin?: string
  /** Personal LinkedIn profile — story/authority posts route here when set. */
  linkedinPersonal?: string
  threads?: string
}

export type GhlPostType = 'post' | 'story' | 'reel'

export type GhlPostStatus = 'draft' | 'scheduled' | 'published'

export interface GhlMediaItem {
  url: string
  type?: string
  caption?: string
  thumbnail?: string
}

export interface GhlSocialAccount {
  id: string
  name?: string
  platform?: string
  type?: string
  isExpired?: boolean
  expire?: string
}

export interface GhlTag {
  id: string
  name: string
  locationId?: string
}

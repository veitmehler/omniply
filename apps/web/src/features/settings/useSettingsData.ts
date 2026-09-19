'use client'

import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import type { ApiKeyData } from './types'

// Owns everything loaded by the combined settings/api-keys/brand-settings fetch:
// writing style, Telegram key + channel, and the full Article Brand Profile
// (incl. diagram style and article typography), plus their save handlers.
export function useSettingsData() {
  const [isSaving, setIsSaving] = useState(false)

  // Writing style settings
  const [writingStyle, setWritingStyle] = useState('')
  const [isSavingWritingStyle, setIsSavingWritingStyle] = useState(false)
  const [isAnalyzingStyle, setIsAnalyzingStyle] = useState(false)
  const [showStyleAnalysisModal, setShowStyleAnalysisModal] = useState(false)
  const [sampleText, setSampleText] = useState('')

  // Telegram bot token (per-user, stays in ApiKey table)
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [telegramMaskedKey, setTelegramMaskedKey] = useState('')
  const [isEditingTelegram, setIsEditingTelegram] = useState(false)
  const [showTelegramKey, setShowTelegramKey] = useState(false)

  // Telegram channel settings
  const [telegramChatId, setTelegramChatId] = useState('')
  const [isSavingTelegramChatId, setIsSavingTelegramChatId] = useState(false)

  // Standing preference: auto-generate the whole next billing cycle once review-spidering
  // completes for it (see .plans/client-story-review-mining.implementation-plan.md).
  const [autoGenerateNextCycle, setAutoGenerateNextCycleState] = useState(false)
  const [isSavingAutoGenerate, setIsSavingAutoGenerate] = useState(false)

  // Article Brand Profile — content fields
  const [industry, setIndustry]                         = useState('')
  const [specialization, setSpecialization]             = useState('') // legacy free-text (kept for back-compat)
  const [specializations, setSpecializations]           = useState<string[]>([]) // keys the client serves
  const [primarySpecialization, setPrimarySpecialization] = useState('') // one of `specializations`
  const [hemisphereOverride, setHemisphereOverride]     = useState('') // '', 'north', 'south' (edge countries only)
  const [availableSpecializations, setAvailableSpecializations] =
    useState<Array<{ key: string; label: string }>>([])
  const [businessDescription, setBusinessDescription]   = useState('')
  const [geolocation, setGeolocation]                   = useState('')
  const [who, setWho]                                   = useState('')
  const [ourExperience, setOurExperience]               = useState('')
  const [articleGoal, setArticleGoal]                   = useState('')
  const [brandSpecialInstructions, setBrandSpecialInst] = useState('')
  const [defaultAuthorName, setDefaultAuthorName]           = useState('')
  const [defaultAuthorWebsite, setDefaultAuthorWebsite]     = useState('')
  const [defaultAuthorLinkedIn, setDefaultAuthorLinkedIn]   = useState('')
  const [defaultAuthorJobTitle, setDefaultAuthorJobTitle]   = useState('')
  const [defaultAuthorAlumniOf, setDefaultAuthorAlumniOf]   = useState('')
  const [schemaArticleType, setSchemaArticleType]           = useState('')

  // Article Brand Profile — organization / schema markup fields
  const [organizationName, setOrganizationName]         = useState('')
  const [organizationWebsite, setOrganizationWebsite]   = useState('')
  const [organizationEmail, setOrganizationEmail]       = useState('')
  const [organizationPhone, setOrganizationPhone]       = useState('')
  const [organizationLogoUrl, setOrganizationLogoUrl]   = useState('')
  const [socialLogoUrl, setSocialLogoUrl]               = useState('')
  const [socialAccountName, setSocialAccountName]       = useState('')
  const [instagramVerified, setInstagramVerified]       = useState(false)
  const [videoSpecialInstructions, setVideoSpecialInstructions] = useState('')
  const [socialCallToAction, setSocialCallToAction]             = useState('')
  const [socialPrimaryGoal, setSocialPrimaryGoal]               = useState('')
  const [socialBioUrl, setSocialBioUrl]                         = useState('')
  const [isUploadingLogo, setIsUploadingLogo]           = useState(false)
  const [isUploadingSocialLogo, setIsUploadingSocialLogo] = useState(false)
  const logoFileInputRef                                = useRef<HTMLInputElement>(null)
  const socialLogoFileInputRef                          = useRef<HTMLInputElement>(null)
  // Structured address sub-fields
  const [addressLine1, setAddressLine1]                 = useState('')
  const [addressLine2, setAddressLine2]                 = useState('')
  const [addressLocality, setAddressLocality]           = useState('') // city
  const [addressRegion, setAddressRegion]               = useState('') // state / province
  const [postalCode, setPostalCode]                     = useState('')
  const [addressCountryName, setAddressCountryName]     = useState('') // full name
  const [organizationCountryCode, setOrganizationCountryCode] = useState('') // ISO, auto-set from dropdown
  // Legacy combined string — only used to show a migration hint when structured fields are empty
  const [legacyAddress, setLegacyAddress]               = useState('')
  const [googleBusinessProfileUrl, setGoogleBusinessProfileUrl] = useState('')
  const [socialMediaLinks, setSocialMediaLinks]         = useState<Array<{ platform: string; url: string }>>([])

  const [diagramPrimaryColor, setDiagramPrimaryColor]       = useState('')
  const [diagramSecondaryColor, setDiagramSecondaryColor]   = useState('')
  const [diagramLineColor, setDiagramLineColor]             = useState('')
  const [diagramFontFamily, setDiagramFontFamily]           = useState('')
  const [diagramStyleGuide, setDiagramStyleGuide]           = useState('')
  const [diagramStyleGuideDefault, setDiagramStyleGuideDefault] = useState('')
  const [diagramLogoVariant, setDiagramLogoVariant]         = useState('light')
  const [isSavingDiagramStyle, setIsSavingDiagramStyle]     = useState(false)

  const [articleFontFamily, setArticleFontFamily] = useState('')
  const [articleDisclaimer, setArticleDisclaimer] = useState('')
  const [articleFontWeight, setArticleFontWeight] = useState('400')
  const [articleFontSizeBase, setArticleFontSizeBase] = useState('16px')
  const [isSavingArticleFonts, setIsSavingArticleFonts] = useState(false)

  const [isSavingBrand, setIsSavingBrand]               = useState(false)

  // Fetch settings and Telegram key on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [settingsRes, keysRes, brandRes, specsRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/api-keys'),
          fetch('/api/brand-settings'),
          fetch('/api/specializations'),
        ])

        if (specsRes.ok) {
          const { specializations: list } = await specsRes.json()
          if (Array.isArray(list)) setAvailableSpecializations(list)
        }

        if (settingsRes.ok) {
          const settings = await settingsRes.json()
          if (settings.writingStyle) setWritingStyle(settings.writingStyle)
          if (settings.telegramChatId) setTelegramChatId(settings.telegramChatId)
          setAutoGenerateNextCycleState(Boolean(settings.autoGenerateNextCycle))
        }

        if (keysRes.ok) {
          const keys: ApiKeyData[] = await keysRes.json()
          const telegramRow = keys.find((k) => k.provider === 'telegram')
          if (telegramRow) setTelegramMaskedKey(telegramRow.maskedKey)
        }

        if (brandRes.ok) {
          const brand = await brandRes.json()
          if (brand.industry)             setIndustry(brand.industry)
          if (brand.specialization)       setSpecialization(brand.specialization)
          if (Array.isArray(brand.specializations)) setSpecializations(brand.specializations)
          if (brand.primarySpecialization) setPrimarySpecialization(brand.primarySpecialization)
          if (brand.hemisphereOverride)   setHemisphereOverride(brand.hemisphereOverride)
          if (brand.businessDescription) setBusinessDescription(brand.businessDescription)
          if (brand.geolocation)          setGeolocation(brand.geolocation)
          if (brand.who)                  setWho(brand.who)
          if (brand.ourExperience)        setOurExperience(brand.ourExperience)
          if (brand.articleGoal)          setArticleGoal(brand.articleGoal)
          if (brand.specialInstructions)  setBrandSpecialInst(brand.specialInstructions)
          if (brand.defaultAuthorName)    setDefaultAuthorName(brand.defaultAuthorName)
          if (brand.defaultAuthorWebsite) setDefaultAuthorWebsite(brand.defaultAuthorWebsite)
          if (brand.defaultAuthorLinkedIn) setDefaultAuthorLinkedIn(brand.defaultAuthorLinkedIn)
          if (brand.defaultAuthorJobTitle) setDefaultAuthorJobTitle(brand.defaultAuthorJobTitle)
          if (brand.defaultAuthorAlumniOf) setDefaultAuthorAlumniOf(brand.defaultAuthorAlumniOf)
          if (brand.schemaArticleType)    setSchemaArticleType(brand.schemaArticleType)
          // Organization fields
          if (brand.organizationName)     setOrganizationName(brand.organizationName)
          if (brand.organizationWebsite)  setOrganizationWebsite(brand.organizationWebsite)
          if (brand.organizationEmail)    setOrganizationEmail(brand.organizationEmail)
          if (brand.organizationPhone)    setOrganizationPhone(brand.organizationPhone)
          if (brand.organizationLogoUrl)  setOrganizationLogoUrl(brand.organizationLogoUrl)
          if (brand.socialLogoUrl)        setSocialLogoUrl(brand.socialLogoUrl)
          if (brand.socialAccountName)    setSocialAccountName(brand.socialAccountName)
          if (brand.instagramVerified != null) setInstagramVerified(Boolean(brand.instagramVerified))
          if (brand.videoSpecialInstructions) setVideoSpecialInstructions(brand.videoSpecialInstructions)
          if (brand.socialCallToAction)       setSocialCallToAction(brand.socialCallToAction)
          if (brand.socialPrimaryGoal)        setSocialPrimaryGoal(brand.socialPrimaryGoal)
          if (brand.socialBioUrl)             setSocialBioUrl(brand.socialBioUrl)
          // Structured address sub-fields
          if (brand.addressLine1)       setAddressLine1(brand.addressLine1)
          if (brand.addressLine2)       setAddressLine2(brand.addressLine2)
          if (brand.addressLocality)    setAddressLocality(brand.addressLocality)
          if (brand.addressRegion)      setAddressRegion(brand.addressRegion)
          if (brand.postalCode)         setPostalCode(brand.postalCode)
          if (brand.addressCountryName) setAddressCountryName(brand.addressCountryName)
          if (brand.organizationCountryCode) setOrganizationCountryCode(brand.organizationCountryCode)
          // Store legacy combined string so we can show a migration hint
          if (brand.organizationAddress && !brand.addressLine1) setLegacyAddress(brand.organizationAddress)
          if (brand.googleBusinessProfileUrl) setGoogleBusinessProfileUrl(brand.googleBusinessProfileUrl)
          if (Array.isArray(brand.socialMediaLinks)) setSocialMediaLinks(brand.socialMediaLinks)
          setDiagramPrimaryColor(brand.diagramPrimaryColor ?? '')
          setDiagramSecondaryColor(brand.diagramSecondaryColor ?? '')
          setDiagramLineColor(brand.diagramLineColor ?? '')
          setDiagramFontFamily(brand.diagramFontFamily ?? '')
          // Seed the style-guide textarea with the saved value, or the server
          // default when the business hasn't customized it yet.
          setDiagramStyleGuideDefault(brand.diagramStyleGuideDefault ?? '')
          setDiagramStyleGuide(
            brand.diagramStyleGuide?.trim() ? brand.diagramStyleGuide : (brand.diagramStyleGuideDefault ?? ''),
          )
          setDiagramLogoVariant(brand.diagramLogoVariant === 'dark' ? 'dark' : 'light')
          setArticleFontFamily(brand.articleFontFamily ?? '')
          setArticleDisclaimer(brand.articleDisclaimer ?? '')
          setArticleFontWeight(brand.articleFontWeight ?? '400')
          setArticleFontSizeBase(brand.articleFontSizeBase ?? '16px')
        }
      } catch (error) {
        console.error('Error fetching settings:', error)
      }
    }

    fetchSettings()
  }, [])

  const handleSaveWritingStyle = async () => {
    try {
      setIsSavingWritingStyle(true)
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          writingStyle: writingStyle || null,
        }),
      })

      if (response.ok) {
        toast.success('Writing style saved successfully')
      } else {
        const error = await response.json()
        console.error('Failed to save writing style:', error)
        toast.error(error.details || error.error || 'Failed to save writing style')
      }
    } catch (error) {
      console.error('Error saving writing style:', error)
      toast.error('Failed to save writing style')
    } finally {
      setIsSavingWritingStyle(false)
    }
  }

  const handleToggleAutoGenerate = async (next: boolean) => {
    const prev = autoGenerateNextCycle
    setAutoGenerateNextCycleState(next) // optimistic
    setIsSavingAutoGenerate(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoGenerateNextCycle: next }),
      })
      if (response.ok) {
        toast.success(next ? 'Auto-generate enabled for next month' : 'Auto-generate disabled')
      } else {
        setAutoGenerateNextCycleState(prev)
        toast.error('Failed to update auto-generate preference')
      }
    } catch {
      setAutoGenerateNextCycleState(prev)
      toast.error('Failed to update auto-generate preference')
    } finally {
      setIsSavingAutoGenerate(false)
    }
  }

  const handleAnalyzeWritingStyle = async () => {
    if (!sampleText.trim() || sampleText.trim().split(/\s+/).length < 500) {
      toast.error('Please paste at least 500 words of sample text')
      return
    }

    try {
      setIsAnalyzingStyle(true)
      const response = await fetch('/api/ai/analyze-writing-style', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sampleText: sampleText.trim(),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setWritingStyle(data.writingStyle || '')
        setShowStyleAnalysisModal(false)
        setSampleText('')
        toast.success('Writing style analyzed and applied successfully')
      } else {
        const error = await response.json()
        console.error('Failed to analyze writing style:', error)
        toast.error(error.details || error.error || 'Failed to analyze writing style')
      }
    } catch (error) {
      console.error('Error analyzing writing style:', error)
      toast.error('Failed to analyze writing style')
    } finally {
      setIsAnalyzingStyle(false)
    }
  }

  const handleLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset so the same file can be re-selected if needed
    e.target.value = ''

    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Please upload a PNG, JPG or WebP image. SVG is not supported by Google structured data.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be smaller than 2 MB')
      return
    }

    setIsUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/brand-settings/logo', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setOrganizationLogoUrl(data.url)
      toast.success('Logo uploaded and saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload logo')
    } finally {
      setIsUploadingLogo(false)
    }
  }

  const handleRemoveLogo = async () => {
    try {
      const res = await fetch('/api/brand-settings/logo', { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove logo')
      setOrganizationLogoUrl('')
      toast.success('Logo removed')
    } catch {
      toast.error('Failed to remove logo')
    }
  }

  const handleSocialLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Please upload a PNG, JPG, or WebP image.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be smaller than 2 MB')
      return
    }

    setIsUploadingSocialLogo(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/brand-settings/social-logo', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setSocialLogoUrl(data.url)
      toast.success('Social post logo uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload social logo')
    } finally {
      setIsUploadingSocialLogo(false)
    }
  }

  const handleRemoveSocialLogo = async () => {
    try {
      const res = await fetch('/api/brand-settings/social-logo', { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove social logo')
      setSocialLogoUrl('')
      toast.success('Social post logo removed')
    } catch {
      toast.error('Failed to remove social logo')
    }
  }

  const handleSaveBrandProfile = async () => {
    setIsSavingBrand(true)
    try {
      const res = await fetch('/api/brand-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geolocation: geolocation || null,
          industry: industry || null,
          specialization: specialization || null,
          specializations,
          primarySpecialization: primarySpecialization || null,
          hemisphereOverride: hemisphereOverride || null,
          businessDescription: businessDescription || null,
          who: who || null,
          ourExperience: ourExperience || null,
          articleGoal: articleGoal || null,
          specialInstructions: brandSpecialInstructions || null,
          defaultAuthorName: defaultAuthorName || null,
          defaultAuthorWebsite: defaultAuthorWebsite || null,
          defaultAuthorLinkedIn: defaultAuthorLinkedIn.trim() || null,
          defaultAuthorJobTitle: defaultAuthorJobTitle.trim() || null,
          defaultAuthorAlumniOf: defaultAuthorAlumniOf.trim() || null,
          schemaArticleType: schemaArticleType.trim() || null,
          organizationName: organizationName || null,
          organizationWebsite: organizationWebsite || null,
          organizationEmail: organizationEmail || null,
          organizationPhone: organizationPhone || null,
          organizationLogoUrl: organizationLogoUrl.trim() || null,
          socialLogoUrl: socialLogoUrl.trim() || null,
          socialAccountName: socialAccountName.trim() || null,
          instagramVerified,
          videoSpecialInstructions: videoSpecialInstructions.trim() || null,
          socialCallToAction: socialCallToAction.trim() || null,
          socialPrimaryGoal: socialPrimaryGoal || null,
          socialBioUrl: socialBioUrl.trim() || null,
          addressLine1: addressLine1.trim() || null,
          addressLine2: addressLine2.trim() || null,
          addressLocality: addressLocality.trim() || null,
          addressRegion: addressRegion.trim() || null,
          postalCode: postalCode.trim() || null,
          addressCountryName: addressCountryName.trim() || null,
          organizationCountryCode: organizationCountryCode || null,
          googleBusinessProfileUrl: googleBusinessProfileUrl.trim() || null,
          socialMediaLinks: socialMediaLinks.filter((l) => l.platform && l.url),
          diagramPrimaryColor: diagramPrimaryColor.trim() || null,
          diagramSecondaryColor: diagramSecondaryColor.trim() || null,
          diagramLineColor: diagramLineColor.trim() || null,
          diagramFontFamily: diagramFontFamily.trim() || null,
          // Store null when the guide is empty or unchanged from the default, so
          // those businesses keep using the server default at render time.
          diagramStyleGuide:
            diagramStyleGuide.trim() && diagramStyleGuide.trim() !== diagramStyleGuideDefault.trim()
              ? diagramStyleGuide.trim()
              : null,
          diagramLogoVariant,
        }),
      })
      if (res.ok) {
        toast.success('Brand profile saved')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to save brand profile')
      }
    } catch {
      toast.error('Failed to save brand profile')
    } finally {
      setIsSavingBrand(false)
    }
  }

  const handleSaveDiagramStyle = async () => {
    setIsSavingDiagramStyle(true)
    try {
      const res = await fetch('/api/brand-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diagramPrimaryColor: diagramPrimaryColor.trim() || null,
          diagramSecondaryColor: diagramSecondaryColor.trim() || null,
          diagramLineColor: diagramLineColor.trim() || null,
          diagramFontFamily: diagramFontFamily.trim() || null,
          // Store null when the guide is empty or unchanged from the default, so
          // those businesses keep using the server default at render time.
          diagramStyleGuide:
            diagramStyleGuide.trim() && diagramStyleGuide.trim() !== diagramStyleGuideDefault.trim()
              ? diagramStyleGuide.trim()
              : null,
          diagramLogoVariant,
        }),
      })
      if (res.ok) {
        toast.success('Diagram style saved')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to save diagram style')
      }
    } catch {
      toast.error('Failed to save diagram style')
    } finally {
      setIsSavingDiagramStyle(false)
    }
  }

  const handleSaveArticleTypography = async () => {
    setIsSavingArticleFonts(true)
    try {
      const res = await fetch('/api/brand-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleFontFamily: articleFontFamily.trim() || null,
          articleDisclaimer: articleDisclaimer.trim() || null,
          articleFontWeight: articleFontWeight.trim() || null,
          articleFontSizeBase: articleFontSizeBase.trim() || null,
        }),
      })
      if (res.ok) {
        toast.success('Article typography saved')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to save article typography')
      }
    } catch {
      toast.error('Failed to save article typography')
    } finally {
      setIsSavingArticleFonts(false)
    }
  }

  return {
    isSaving, setIsSaving,
    // Writing style
    writingStyle, setWritingStyle,
    isSavingWritingStyle,
    isAnalyzingStyle,
    showStyleAnalysisModal, setShowStyleAnalysisModal,
    sampleText, setSampleText,
    handleSaveWritingStyle,
    handleAnalyzeWritingStyle,
    // Telegram
    telegramBotToken, setTelegramBotToken,
    telegramMaskedKey, setTelegramMaskedKey,
    isEditingTelegram, setIsEditingTelegram,
    showTelegramKey, setShowTelegramKey,
    telegramChatId, setTelegramChatId,
    isSavingTelegramChatId, setIsSavingTelegramChatId,
    // Auto-generate next cycle
    autoGenerateNextCycle,
    isSavingAutoGenerate,
    handleToggleAutoGenerate,
    // Brand profile — content
    industry, setIndustry,
    specialization, setSpecialization,
    specializations, setSpecializations,
    primarySpecialization, setPrimarySpecialization,
    hemisphereOverride, setHemisphereOverride,
    availableSpecializations,
    businessDescription, setBusinessDescription,
    geolocation, setGeolocation,
    who, setWho,
    ourExperience, setOurExperience,
    articleGoal, setArticleGoal,
    brandSpecialInstructions, setBrandSpecialInst,
    defaultAuthorName, setDefaultAuthorName,
    defaultAuthorWebsite, setDefaultAuthorWebsite,
    defaultAuthorLinkedIn, setDefaultAuthorLinkedIn,
    defaultAuthorJobTitle, setDefaultAuthorJobTitle,
    defaultAuthorAlumniOf, setDefaultAuthorAlumniOf,
    schemaArticleType, setSchemaArticleType,
    // Brand profile — organization / schema markup
    organizationName, setOrganizationName,
    organizationWebsite, setOrganizationWebsite,
    organizationEmail, setOrganizationEmail,
    organizationPhone, setOrganizationPhone,
    organizationLogoUrl, setOrganizationLogoUrl,
    socialLogoUrl, setSocialLogoUrl,
    socialAccountName, setSocialAccountName,
    instagramVerified, setInstagramVerified,
    videoSpecialInstructions, setVideoSpecialInstructions,
    socialCallToAction, setSocialCallToAction,
    socialPrimaryGoal, setSocialPrimaryGoal,
    socialBioUrl, setSocialBioUrl,
    isUploadingLogo,
    isUploadingSocialLogo,
    logoFileInputRef,
    socialLogoFileInputRef,
    addressLine1, setAddressLine1,
    addressLine2, setAddressLine2,
    addressLocality, setAddressLocality,
    addressRegion, setAddressRegion,
    postalCode, setPostalCode,
    addressCountryName, setAddressCountryName,
    organizationCountryCode, setOrganizationCountryCode,
    legacyAddress,
    googleBusinessProfileUrl, setGoogleBusinessProfileUrl,
    socialMediaLinks, setSocialMediaLinks,
    handleLogoUpload,
    handleRemoveLogo,
    handleSocialLogoUpload,
    handleRemoveSocialLogo,
    handleSaveBrandProfile,
    isSavingBrand,
    // Diagram style
    diagramPrimaryColor, setDiagramPrimaryColor,
    diagramSecondaryColor, setDiagramSecondaryColor,
    diagramLineColor, setDiagramLineColor,
    diagramFontFamily, setDiagramFontFamily,
    diagramStyleGuide, setDiagramStyleGuide,
    diagramStyleGuideDefault,
    diagramLogoVariant, setDiagramLogoVariant,
    isSavingDiagramStyle,
    handleSaveDiagramStyle,
    // Article typography
    articleFontFamily, setArticleFontFamily,
    articleDisclaimer, setArticleDisclaimer,
    articleFontWeight, setArticleFontWeight,
    articleFontSizeBase, setArticleFontSizeBase,
    isSavingArticleFonts,
    handleSaveArticleTypography,
  }
}

export type SettingsData = ReturnType<typeof useSettingsData>

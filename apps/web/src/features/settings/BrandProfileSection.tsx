'use client'

import { useState } from 'react'
import { Save, Loader2, X, Plus, Upload, Building2, Search, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { COUNTRIES } from './countries'
import type { SettingsData } from './useSettingsData'

interface GbpCandidate {
  description: string | null
  website: string | null
  address: string | null
  mapsSearchUrl: string
}

// Equator-straddling countries (mirror of packages/shared/src/hemisphere.ts EDGE map).
// Kept inline so this client component doesn't pull the server bundle into the browser.
const EDGE_COUNTRIES = new Set([
  'BR', 'ID', 'EC', 'CD', 'CG', 'TZ', 'PG', 'CO', 'KE', 'UG', 'GA', 'SO', 'ST', 'KI', 'MV',
])

export function BrandProfileSection({ settings }: { settings: SettingsData }) {
  const {
    industry, setIndustry,
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
    organizationName, setOrganizationName,
    organizationWebsite, setOrganizationWebsite,
    organizationEmail, setOrganizationEmail,
    organizationPhone, setOrganizationPhone,
    organizationLogoUrl, setOrganizationLogoUrl,
    isUploadingLogo,
    logoFileInputRef,
    handleLogoUpload,
    handleRemoveLogo,
    addressLine1, setAddressLine1,
    addressLine2, setAddressLine2,
    addressLocality, setAddressLocality,
    addressRegion, setAddressRegion,
    postalCode, setPostalCode,
    setAddressCountryName,
    organizationCountryCode, setOrganizationCountryCode,
    legacyAddress,
    googleBusinessProfileUrl, setGoogleBusinessProfileUrl,
    socialMediaLinks, setSocialMediaLinks,
    handleSaveBrandProfile,
    isSavingBrand,
  } = settings

  const [discovering, setDiscovering] = useState(false)
  const [candidate, setCandidate] = useState<GbpCandidate | null>(null)
  const [candidateMatched, setCandidateMatched] = useState(false)
  const [discoverAttempted, setDiscoverAttempted] = useState(false)

  async function findBusiness() {
    setDiscovering(true)
    setCandidate(null)
    try {
      const res = await fetch('/api/brand-settings/discover-gbp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      setDiscoverAttempted(true)
      if (!res.ok) return toast.error(body.error ?? 'Could not search for your business')
      if (!body.found) return toast.error('No Google Business listing found — enter your GBP URL manually below.')
      setCandidate(body.candidate)
      setCandidateMatched(!!body.websiteMatches)
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-card-foreground mb-2">Article Brand Profile</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Context about you and your business that the AI uses when writing long-form articles.
        These fields are <strong>not</strong> used for social posts — only article generation.
        Leave any field blank and the AI will work in general terms for that aspect.
      </p>

      <div className="space-y-5">
        {/* Industry / profession & business description — primes AI article prompts */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Industry / profession
          </label>
          <input
            type="text"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder='e.g. "Chiropractic", "Accounting", "Real Estate"'
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Appears as the <code className="rounded bg-muted px-1">{'{{industry}}'}</code> variable in article prompts.
          </p>
        </div>

        {/* Specializations — drives newsletter calendar matching + voice */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Specializations
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            Select every area you serve, then mark one as <strong>primary</strong>. The primary
            specialization (combined with your country) decides which newsletter content calendar
            you receive, and supplies the{' '}
            <code className="rounded bg-muted px-1">{'{{specialization}}'}</code> variable.
          </p>
          {availableSpecializations.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No specializations are available yet. Please contact your administrator.
            </p>
          ) : (
            <div className="space-y-2">
              {availableSpecializations.map((s) => {
                const checked = specializations.includes(s.key)
                const isPrimary = primarySpecialization === s.key
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-card-foreground">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSpecializations([...specializations, s.key])
                            // First one selected becomes primary by default
                            if (!primarySpecialization) setPrimarySpecialization(s.key)
                          } else {
                            setSpecializations(specializations.filter((k) => k !== s.key))
                            if (isPrimary) setPrimarySpecialization('')
                          }
                        }}
                        className="h-4 w-4 rounded border-input"
                      />
                      {s.label}
                    </label>
                    {checked && (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="radio"
                          name="primarySpecialization"
                          checked={isPrimary}
                          onChange={() => setPrimarySpecialization(s.key)}
                          className="h-3.5 w-3.5"
                        />
                        Primary
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Hemisphere override — only meaningful for equator-straddling countries */}
        {EDGE_COUNTRIES.has((organizationCountryCode || '').toUpperCase()) && (
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">
              Hemisphere
            </label>
            <select
              value={hemisphereOverride}
              onChange={(e) => setHemisphereOverride(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Auto (based on your country)</option>
              <option value="north">Northern hemisphere</option>
              <option value="south">Southern hemisphere</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Your country straddles the equator. Choose the hemisphere whose seasons match your
              location so the newsletter&apos;s seasonal content lines up.
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Business description
          </label>
          <textarea
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder='e.g. "We are a family chiropractic clinic focused on gentle, evidence-based care for desk workers and young families in the Denver metro area."'
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Optional: what you do and who you serve. Injected as the{' '}
            <code className="rounded bg-muted px-1">{'{{business_description}}'}</code>{' '}
            variable in article prompts.
          </p>
        </div>

        {/* Geographic focus */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Geographic focus
          </label>
          <input
            type="text"
            value={geolocation}
            onChange={(e) => setGeolocation(e.target.value)}
            placeholder='e.g. "United States", "Sydney, Australia", or "Global"'
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="text-xs text-muted-foreground mt-1">Used to constrain facts and statistics to your market.</p>
        </div>

        {/* About you / your business */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            About you / your business
          </label>
          <textarea
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder="Who are you? What do you do? Who do you serve? Write in your own voice."
            rows={4}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
        </div>

        {/* Relevant experience */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Your relevant experience
          </label>
          <textarea
            value={ourExperience}
            onChange={(e) => setOurExperience(e.target.value)}
            placeholder="Years in the field, types of work, areas of expertise. Concrete details only — no fluff."
            rows={4}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
          <p className="text-xs text-muted-foreground mt-1">Grounds the article&apos;s authority claims in real experience.</p>
        </div>

        {/* Article goal */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Goal of your articles
          </label>
          <textarea
            value={articleGoal}
            onChange={(e) => setArticleGoal(e.target.value)}
            placeholder="What outcome do you want each article to drive? E.g. newsletter sign-ups, leads, brand authority, education."
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
          <p className="text-xs text-muted-foreground mt-1">Steers tone and calls-to-action across all articles.</p>
        </div>

        {/* Special instructions */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Standing instructions for every article
          </label>
          <textarea
            value={brandSpecialInstructions}
            onChange={(e) => setBrandSpecialInst(e.target.value)}
            placeholder="Rules that apply to every article: e.g., always use Oxford commas, never mention competitors by name, write at 8th-grade reading level."
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
          <p className="text-xs text-muted-foreground mt-1">Different from per-article special instructions — these apply globally.</p>
        </div>

        {/* Author info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">
              Default author name
            </label>
            <input
              type="text"
              value={defaultAuthorName}
              onChange={(e) => setDefaultAuthorName(e.target.value)}
              placeholder="e.g. Dr. Jane Smith, PhD, PT"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground mt-1">Include all professional credentials (e.g. Dr., PhD, MD, RN). Appears as the article byline and in schema markup.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">
              Default author website
            </label>
            <input
              type="url"
              value={defaultAuthorWebsite}
              onChange={(e) => setDefaultAuthorWebsite(e.target.value)}
              placeholder="https://example.com/about"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground mt-1">Used in schema markup alongside the organization details below.</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Author LinkedIn
          </label>
          <input
            type="url"
            value={defaultAuthorLinkedIn}
            onChange={(e) => setDefaultAuthorLinkedIn(e.target.value)}
            placeholder="https://linkedin.com/in/jane-smith"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="text-xs text-muted-foreground mt-1">Used in schema markup and included in the final article review.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">
              Author job title
            </label>
            <input
              type="text"
              value={defaultAuthorJobTitle}
              onChange={(e) => setDefaultAuthorJobTitle(e.target.value)}
              placeholder="e.g. Chiropractor, Physiotherapist"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground mt-1">Added to the author&apos;s schema as <code>jobTitle</code>.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">
              Author alma mater / institution
            </label>
            <input
              type="text"
              value={defaultAuthorAlumniOf}
              onChange={(e) => setDefaultAuthorAlumniOf(e.target.value)}
              placeholder="e.g. University of Melbourne"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground mt-1">Added to the author&apos;s schema as <code>alumniOf</code>.</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Schema article type override
          </label>
          <input
            type="text"
            value={schemaArticleType}
            onChange={(e) => setSchemaArticleType(e.target.value)}
            placeholder="Leave blank for auto-detection (e.g. MedicalArticle, NewsArticle)"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Overrides the auto-detected <code>@type</code> for all articles. Leave blank to let industry keyword rules determine the type automatically.
            Common values: <code>Article</code>, <code>MedicalArticle</code>, <code>NewsArticle</code>, <code>TechArticle</code>, <code>BlogPosting</code>.
          </p>
        </div>

        {/* Organization / Schema Markup sub-section */}
        <div className="pt-2">
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-card-foreground">Organization &amp; Schema Markup</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Used to generate JSON-LD structured data injected into every published article.
                These details appear in search engines as publisher information.
              </p>
            </div>

            {/* Logo */}
            <div>
              <label className="block text-xs font-medium text-card-foreground mb-1">
                Organization logo
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                Used as the publisher logo in schema markup. Recommended: square PNG, at least 112 × 112 px. SVG is not supported by Google structured data.
              </p>
              <div className="flex items-start gap-4">
                {/* Preview */}
                <div className="w-20 h-20 rounded-lg border border-border bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {organizationLogoUrl ? (
                    <img
                      src={organizationLogoUrl}
                      alt="Organization logo preview"
                      className="w-full h-full object-contain p-1"
                      onError={() => setOrganizationLogoUrl('')}
                    />
                  ) : (
                    <Building2 className="w-8 h-8 text-muted-foreground/40" />
                  )}
                </div>

                {/* Controls */}
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    {/* Hidden file input */}
                    <input
                      ref={logoFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => logoFileInputRef.current?.click()}
                      disabled={isUploadingLogo}
                    >
                      {isUploadingLogo ? (
                        <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Uploading…</>
                      ) : (
                        <><Upload className="w-3.5 h-3.5 mr-1.5" />Upload file</>
                      )}
                    </Button>
                    {organizationLogoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveLogo}
                        disabled={isUploadingLogo}
                      >
                        <X className="w-3.5 h-3.5 mr-1.5" />Remove
                      </Button>
                    )}
                  </div>

                  {/* Manual URL input */}
                  <input
                    type="url"
                    value={organizationLogoUrl}
                    onChange={(e) => setOrganizationLogoUrl(e.target.value)}
                    placeholder="or paste logo URL from your website…"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="text-xs text-muted-foreground">PNG, JPG or WebP · Max 2 MB · SVG not supported by Google</p>
                </div>
              </div>
            </div>

            {/* Name + Website */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-card-foreground mb-1">
                  Organization name
                </label>
                <input
                  type="text"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Acme Legal Group"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-card-foreground mb-1">
                  Organization website
                </label>
                <input
                  type="url"
                  value={organizationWebsite}
                  onChange={(e) => setOrganizationWebsite(e.target.value)}
                  placeholder="https://acmelegal.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Email + Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-card-foreground mb-1">
                  Contact email
                </label>
                <input
                  type="email"
                  value={organizationEmail}
                  onChange={(e) => setOrganizationEmail(e.target.value)}
                  placeholder="hello@acmelegal.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-card-foreground mb-1">
                  Phone number
                </label>
                <input
                  type="tel"
                  value={organizationPhone}
                  onChange={(e) => setOrganizationPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Structured address */}
            <div className="space-y-3">
              <label className="block text-xs font-medium text-card-foreground">
                Business address
              </label>
              {/* Migration hint: show old combined string if sub-fields are empty */}
              {legacyAddress && !addressLine1 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md px-3 py-2">
                  Previously saved: &quot;{legacyAddress}&quot; — please re-enter using the fields below to save in the new structured format.
                </p>
              )}
              <input
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="Street address"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Suite, unit, building (optional)"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={addressLocality}
                  onChange={(e) => setAddressLocality(e.target.value)}
                  placeholder="City"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <input
                  type="text"
                  value={addressRegion}
                  onChange={(e) => setAddressRegion(e.target.value)}
                  placeholder="State / Province"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="ZIP / Postal code"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <div>
                  <select
                    value={organizationCountryCode}
                    onChange={(e) => {
                      setOrganizationCountryCode(e.target.value)
                      const opt = e.target.options[e.target.selectedIndex]
                      setAddressCountryName(opt.text === 'Select country…' ? '' : opt.text)
                    }}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Select country…</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Google Business Profile */}
            <div>
              <label className="block text-xs font-medium text-card-foreground mb-1">
                Google Business Profile URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={googleBusinessProfileUrl}
                  onChange={(e) => setGoogleBusinessProfileUrl(e.target.value)}
                  placeholder="https://g.page/your-business"
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <Button type="button" variant="outline" size="sm" onClick={findBusiness} disabled={discovering}>
                  {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Find my business
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Used as publisher location in schema markup, and to source real client stories from
                your Google reviews for articles.
              </p>
              {candidate && (
                <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-card-foreground mb-1">Is this your business?</p>
                  {candidateMatched && (
                    <p className="text-xs text-emerald-600 mb-1.5 flex items-center gap-1">
                      <Check className="h-3 w-3" /> Website matches what you entered above
                    </p>
                  )}
                  {candidate.address && <p className="text-xs text-muted-foreground">{candidate.address}</p>}
                  {candidate.website && <p className="text-xs text-muted-foreground">{candidate.website}</p>}
                  <div className="flex gap-2 mt-2">
                    <Button
                      type="button" size="sm"
                      onClick={() => { setGoogleBusinessProfileUrl(candidate.mapsSearchUrl); setCandidate(null) }}
                    >
                      <Check className="h-3.5 w-3.5" /> Yes, that&apos;s us
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setCandidate(null)}>
                      Not us — I&apos;ll enter it manually
                    </Button>
                  </div>
                </div>
              )}
              {discoverAttempted && !candidate && !discovering && (
                <p className="text-xs text-muted-foreground mt-1">
                  Enter the URL manually above if search didn&apos;t find the right listing.
                </p>
              )}
            </div>

            {/* Social media links */}
            <div>
              <label className="block text-xs font-medium text-card-foreground mb-2">
                Social media profiles
              </label>
              <div className="space-y-2">
                {socialMediaLinks.map((link, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={link.platform}
                      onChange={(e) => {
                        const next = [...socialMediaLinks]
                        next[idx] = { ...next[idx], platform: e.target.value }
                        setSocialMediaLinks(next)
                      }}
                      placeholder="Platform (e.g. LinkedIn)"
                      className="w-36 shrink-0 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <input
                      type="url"
                      value={link.url}
                      onChange={(e) => {
                        const next = [...socialMediaLinks]
                        next[idx] = { ...next[idx], url: e.target.value }
                        setSocialMediaLinks(next)
                      }}
                      placeholder="https://linkedin.com/company/acmelegal"
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={() => setSocialMediaLinks(socialMediaLinks.filter((_, i) => i !== idx))}
                      className="shrink-0 rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="Remove link"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSocialMediaLinks([...socialMediaLinks, { platform: '', url: '' }])}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add social profile
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={handleSaveBrandProfile}
            disabled={isSavingBrand}
          >
            {isSavingBrand
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
              : <><Save className="w-4 h-4 mr-2" />Save Brand Profile</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

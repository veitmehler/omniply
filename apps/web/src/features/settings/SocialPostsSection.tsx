'use client'

import { Save, Loader2, X, Upload, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SettingsData } from './useSettingsData'

// Social-post branding (quote-card avatar, account name, CTA, video
// instructions). Saves through the same brand-settings payload as the
// Article Brand Profile, hence the shared handleSaveBrandProfile.
export function SocialPostsSection({ settings }: { settings: SettingsData }) {
  const {
    organizationName,
    organizationLogoUrl,
    socialLogoUrl, setSocialLogoUrl,
    socialAccountName, setSocialAccountName,
    instagramVerified, setInstagramVerified,
    videoSpecialInstructions, setVideoSpecialInstructions,
    socialCallToAction, setSocialCallToAction,
    socialPrimaryGoal, setSocialPrimaryGoal,
    socialBioUrl, setSocialBioUrl,
    isUploadingSocialLogo,
    socialLogoFileInputRef,
    handleSocialLogoUpload,
    handleRemoveSocialLogo,
    handleSaveBrandProfile,
    isSavingBrand,
  } = settings

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-card-foreground mb-2">Social Media Posts</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Settings used when generating branded social images (quote cards, reels, carousels).
      </p>

      <div className="space-y-6">
        {/* Profile photo */}
        <div>
          <label className="block text-xs font-medium text-card-foreground mb-1">
            Profile photo
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Shown as a circular avatar on quote cards. Use a square image — it will be cropped to a circle.
            When empty, the organization logo from your Brand Profile is used.
          </p>
          <div className="flex items-start gap-5">
            {/* Circular preview — mirrors the compositor output exactly */}
            <div className="w-20 h-20 rounded-full border-2 border-border bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
              {socialLogoUrl || organizationLogoUrl ? (
                <img
                  src={socialLogoUrl || organizationLogoUrl}
                  alt="Social profile photo preview"
                  className="w-full h-full object-cover"
                  onError={() => setSocialLogoUrl('')}
                />
              ) : (
                <Building2 className="w-8 h-8 text-muted-foreground/40" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex gap-2 flex-wrap">
                <input
                  ref={socialLogoFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleSocialLogoUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => socialLogoFileInputRef.current?.click()}
                  disabled={isUploadingSocialLogo}
                >
                  {isUploadingSocialLogo ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Uploading…</>
                  ) : (
                    <><Upload className="w-3.5 h-3.5 mr-1.5" />Upload photo</>
                  )}
                </Button>
                {socialLogoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveSocialLogo}
                    disabled={isUploadingSocialLogo}
                  >
                    <X className="w-3.5 h-3.5 mr-1.5" />Remove
                  </Button>
                )}
              </div>
              <input
                type="url"
                value={socialLogoUrl}
                onChange={(e) => setSocialLogoUrl(e.target.value)}
                placeholder="or paste image URL…"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground">PNG, JPG or WebP · Max 2 MB · Square images work best</p>
            </div>
          </div>
        </div>

        {/* Account name */}
        <div>
          <label className="block text-xs font-medium text-card-foreground mb-1">
            Social account name
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            The display name shown next to your profile photo on quote cards (e.g. <span className="font-medium">hormozi</span> or <span className="font-medium">yourbrand</span>).
            Defaults to your Organization Name when left blank.
          </p>
          <input
            type="text"
            value={socialAccountName}
            onChange={(e) => setSocialAccountName(e.target.value)}
            placeholder={organizationName || 'yourusername'}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Verified badge */}
        <div>
          <label className="block text-xs font-medium text-card-foreground mb-1">
            Verified account
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Shows the Instagram blue verified badge next to your account name on quote cards.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={instagramVerified}
              onClick={() => setInstagramVerified((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                instagramVerified ? 'bg-blue-500' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  instagramVerified ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm text-card-foreground">
              {instagramVerified ? 'Verified — blue badge will appear on quote cards' : 'Not verified'}
            </span>
          </div>
          {instagramVerified && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md px-3 py-2">
              Only enable this if your Instagram account is officially verified by Meta. Adding a blue checkmark to an unverified account violates Instagram&apos;s Terms of Service.
            </p>
          )}
        </div>

        {/* Call to Action — link-in-bio strategy */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Call to Action
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Posts and stories can&apos;t carry a clickable link, so every CTA drives people to the
            link in your profile bio. Choose the goal your posts should push toward.
          </p>

          {/* Primary goal selector */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {([
              { value: 'newsletter', label: 'Newsletter signup', hint: 'Grow your email list' },
              { value: 'booking',    label: 'Book appointment',  hint: 'Drive bookings' },
              { value: 'dm_keyword', label: 'Comment keyword',   hint: 'DM a free guide on comment' },
              { value: 'custom',     label: 'Custom',            hint: 'Write your own' },
            ] as const).map((opt) => {
              const active = socialPrimaryGoal === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSocialPrimaryGoal(opt.value)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                      : 'border-input bg-background hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-medium text-card-foreground">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                </button>
              )
            })}
          </div>

          {socialPrimaryGoal === 'dm_keyword' ? (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                Followers comment the keyword, our automation DMs them your free guide
                (works on Facebook and Instagram; LinkedIn posts keep a normal link).
                Format: <span className="italic">KEYWORD|what we send</span>.
              </p>
              <input
                value={socialCallToAction}
                onChange={(e) => setSocialCallToAction(e.target.value)}
                placeholder='e.g. SPINE|our 2-Minute Spine Check'
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </>
          ) : socialPrimaryGoal === 'custom' || socialPrimaryGoal === '' ? (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                Describe what you want your posts to promote. It will be phrased as a
                &ldquo;link in bio&rdquo; call to action.
                <br />Example: <span className="italic">&ldquo;Download our free posture guide&rdquo;</span>.
              </p>
              <textarea
                value={socialCallToAction}
                onChange={(e) => setSocialCallToAction(e.target.value)}
                rows={3}
                placeholder="e.g. Grab our free 5-minute morning mobility routine"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              Your posts will invite followers to{' '}
              <span className="font-medium text-card-foreground">
                {socialPrimaryGoal === 'newsletter' ? 'subscribe to your newsletter' : 'book an appointment'}
              </span>{' '}
              via the link in your bio.
            </p>
          )}
        </div>

        {/* Link-in-bio URL */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Link-in-bio URL
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            Your link-in-bio page (e.g. your GoHighLevel page). Paste this URL into your Instagram &amp;
            Facebook profile bio so the &ldquo;link in bio&rdquo; CTA works. Stored for reference.
          </p>
          <input
            type="url"
            value={socialBioUrl}
            onChange={(e) => setSocialBioUrl(e.target.value)}
            placeholder="https://links.yourbrand.com"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Video & Image Special Instructions */}
        <div>
          <label className="block text-sm font-medium text-card-foreground mb-1">
            Video &amp; Image Special Instructions
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            These instructions are injected into every Fal.ai video reel prompt. Use them to enforce your visual style, restrict unwanted content, or specify requirements for your brand (e.g. &ldquo;Always show outdoor urban scenes&rdquo; or &ldquo;Never use dark backgrounds&rdquo;).
          </p>
          <textarea
            value={videoSpecialInstructions}
            onChange={(e) => setVideoSpecialInstructions(e.target.value)}
            rows={4}
            placeholder="e.g. Always use bright, modern settings. No dark or moody visuals. Avoid close-up faces."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
        </div>

        {/* Save */}
        <div className="flex justify-end pt-2">
          <Button
            type="button"
            onClick={handleSaveBrandProfile}
            disabled={isSavingBrand}
          >
            {isSavingBrand
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
              : <><Save className="w-4 h-4 mr-2" />Save Social Settings</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

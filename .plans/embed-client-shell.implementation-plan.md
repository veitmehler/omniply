# Embed Client Shell (§4d) — the FULL client app inside GHL, incl. Settings

## STATUS 2026-09-15: EXECUTED — live on prod (1b74700). Dual-auth smoke-tested on staging (direct 200 / proxy 200 / no-auth 401); clerkMiddleware bypass for emb_ bearers on /api. EMBED_JWT_SECRET set in Vercel prod+preview. First-burst gate skip + reset-onboarding.ts shipped same batch; demo account RESET to clean pre-onboarding state.

Veit decisions 2026-09-15: (1) the embed is the client app — GHL clients never
log into the main platform; (2) Settings access at launch is NON-NEGOTIABLE
("what if they made a mistake and want to fix it"). LAUNCH-CRITICAL (Sept 22).

## The architecture insight that makes "everything" affordable

The Settings/Dashboard sections call ~25 relative `/api/...` Next routes with
plain fetch. The embed page is served from the SAME origin
(chiro.omniply.io/embed) — those calls already reach the right server from
inside the iframe. The ONLY missing piece is auth: the Next routes accept only
Clerk cookies (unreliable in cross-site iframes — why the embed exists).

The embed token is a minimal HS256 JWT (node:crypto, shared secret). So:

1. **Dual-auth helper in apps/web** — `resolveRequestClerkId(req)`: Clerk
   `auth()` first, else verify `Authorization: Bearer emb_<jwt>` with the
   shared secret (EMBED_TOKEN_SECRET env → Vercel, same value as the API).
   Returns the same clerkId space either way — every route already maps
   clerkId→account via resolveAccountForClerkId, so downstream code is
   UNTOUCHED.
2. **Mechanical sweep of ~24 Next API route files**: swap `auth()` for the
   helper. No logic changes.
3. **Fetch header injection in the embed shell** (ONE place): wrap fetch for
   same-origin `/api/*` calls to attach the embed bearer (+ 401 → re-handshake
   retry, reusing embedFetch semantics). Feature components stay 100%
   unchanged — no apiFetch prop threading, no per-section ports.
4. **Embed shell = tabs mounting the EXISTING page components**:
   - **Content** — the ContentPlan dashboard component as-is (its
     /api/content-plan calls ride the interceptor). §4d collapses into this.
   - **Lead Magnets** — existing view (already embed-native).
   - **Settings** — the existing Settings sections, curated (below).
   Landing tab after onboarding completes: Content (with the
   generation-banner state moving there).

This is Veit's "whole client view in the iframe" done without the Clerk-
cookie-in-iframe trap, and it makes every FUTURE feature embed-capable by
default (build once, both shells mount it).

## Settings curation for GHL-first clients (flag: `embedMode`)

SHOW (mistake-fixing surface — the launch requirement):
- BrandProfileSection (business details, phone/email/address, GBP)
- WritingStyleSection, SocialPostsSection (CTA read-only per P3),
  AppearanceSection, DiagramStyleSection, ArticleTypographySection,
  AutoGenerateSection (monthly auto toggle)
- WordPressSection (reconnect/fix credentials)
- ChatAssistantSection + ChatKnowledgeSection (KB textarea)
- VoiceAssistantSection (EL key + provisioning wizard)
- Linktree/SpineCheck download buttons

HIDE in embed (wrong model for GHL clients):
- TeamSection (Clerk roster/invites — GHL manages users)
- ConnectedAccountsSection direct-OAuth connects → replaced by a note:
  "Social accounts connect in your Omniply CRM's Social Planner" (whitelabel
  wording; GhlSettingsPanel review needed — parts may stay)
- API-keys management (system keys serve GHL clients)

## Iframe-specific care

- Google OAuth (GBP discover/connect): must open TOP-LEVEL via window.open,
  callback closes popup (verify current flow's redirect handling in-iframe).
- File uploads/mic already proven in the iframe (photo, voice recorder).
- Height: the embed shell owns full-height scrolling already.

## Sequencing vs the reset + fresh run (agreed order updated)

1. First-burst story-gate skip + reusable reset-onboarding script → deploy.
2. RESET demo account → Veit's fresh top-to-bottom run.
3. Build this shell in parallel (web-heavy; API deploys during his run are
   forbidden — the shell is Vercel-only until the tiny API pieces, if any).
4. Shell live BEFORE his run's burst finishes → content review happens
   INSIDE the embed = the E2E becomes fully client-side for the first time.

## Effort estimate

- Dual-auth helper + env + route sweep: ~half a session (mechanical).
- Shell tabs + fetch interceptor: small.
- Settings curation pass + iframe OAuth check: the real testing surface;
  budget a full session with live verification in the GHL iframe.
- Target: live well before Sept 22; §4d closes when the Content tab lands.

## Explicitly out (post-launch)

- Settings kill-switches for installed WP surfaces (backlog §5).
- Voice minutes/billing UI, roster features for GHL clients.

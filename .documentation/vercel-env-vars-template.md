# Vercel Deployment - Environment Variables Template

Copy this template and fill in your actual values in Vercel Dashboard → Settings → Environment Variables.

---

## 🔐 Clerk Authentication

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_YOUR_KEY_HERE
CLERK_SECRET_KEY=sk_live_YOUR_KEY_HERE
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL=/
```

---


```bash
```

---


```bash
```

---

## 🔗 LinkedIn OAuth

```bash
LINKEDIN_CLIENT_ID=YOUR_LINKEDIN_CLIENT_ID
LINKEDIN_CLIENT_SECRET=YOUR_LINKEDIN_CLIENT_SECRET
LINKEDIN_REDIRECT_URI=https://YOUR_DOMAIN.vercel.app/api/social/linkedin/callback
```

---

## 🐦 Twitter/X OAuth

```bash
TWITTER_CLIENT_ID=YOUR_TWITTER_CLIENT_ID
TWITTER_CLIENT_SECRET=YOUR_TWITTER_CLIENT_SECRET
TWITTER_REDIRECT_URI=https://YOUR_DOMAIN.vercel.app/api/social/twitter/callback
```

---

## 🌐 App Configuration

```bash
NEXT_PUBLIC_APP_URL=https://YOUR_DOMAIN.vercel.app
CRON_SECRET=GENERATE_WITH_openssl_rand_-base64_32
ENCRYPTION_KEY=GENERATE_WITH_openssl_rand_-base64_32
```

---

## 📝 Notes

1. Replace `YOUR_DOMAIN.vercel.app` with your actual Vercel domain after first deployment
2. Generate `CRON_SECRET` and `ENCRYPTION_KEY` using: `openssl rand -base64 32`
3. Use **production keys** from Clerk (pk_live_ and sk_live_), not test keys
4. Update OAuth redirect URIs in LinkedIn/Twitter apps after deployment
5. Update Clerk redirect URLs after deployment

---

**Save this file locally** (don't commit to git) and use it as a reference when setting up Vercel.


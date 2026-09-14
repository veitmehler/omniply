# Vercel Deployment Guide - Levercast

## Overview

This guide walks you through deploying Levercast to Vercel, including all required environment variables and configuration steps.

---

## Prerequisites

- ✅ Vercel account (sign up at https://vercel.com)
- ✅ GitHub repository connected to Vercel
- ✅ Clerk account with application created
- ✅ LinkedIn Developer App (for LinkedIn publishing)
- ✅ Twitter/X Developer App (for Twitter publishing)

---

## Step 1: Connect Repository to Vercel

1. **Go to Vercel Dashboard**: https://vercel.com/dashboard
2. **Click "Add New..." → "Project"**
3. **Import your GitHub repository**: `lever_cast`
4. **Configure Project**:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `./` (default)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)

5. **Click "Deploy"** (we'll add environment variables next)

---

## Step 2: Configure Environment Variables

Go to **Project Settings → Environment Variables** and add the following:

### 🔐 Clerk Authentication (Required)

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...  # From Clerk Dashboard → API Keys
CLERK_SECRET_KEY=sk_live_...                    # From Clerk Dashboard → API Keys
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL=/
```

**Where to find**: Clerk Dashboard → Your Application → API Keys

**Important**: Use **production keys** (`pk_live_` and `sk_live_`) for production deployment, not test keys.

---


```bash
```


**Note**: Replace `[PROJECT-REF]` and `[PASSWORD]` with your actual values.

---


```bash
```


**Important**: 

---

### 🔗 LinkedIn OAuth (Required for LinkedIn Publishing)

```bash
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
LINKEDIN_REDIRECT_URI=https://yourdomain.vercel.app/api/social/linkedin/callback
```

**Where to find**: LinkedIn Developers → Your App → Auth tab

**Important**: 
- Update `LINKEDIN_REDIRECT_URI` with your actual Vercel domain
- Add the callback URL to LinkedIn App settings

---

### 🐦 Twitter/X OAuth (Required for Twitter Publishing)

```bash
TWITTER_CLIENT_ID=your_twitter_client_id
TWITTER_CLIENT_SECRET=your_twitter_client_secret
TWITTER_REDIRECT_URI=https://yourdomain.vercel.app/api/social/twitter/callback
```

**Where to find**: Twitter Developer Portal → Your App → Keys and tokens

**Important**: 
- Update `TWITTER_REDIRECT_URI` with your actual Vercel domain
- Add the callback URL to Twitter App settings

---

### 🌐 App URL (Required)

```bash
NEXT_PUBLIC_APP_URL=https://yourdomain.vercel.app
```

**Note**: Replace `yourdomain.vercel.app` with your actual Vercel domain (e.g., `levercast-abc123.vercel.app`)

**After first deployment**: Vercel will assign you a domain. Update this variable and redeploy.

---

### ⏰ Cron Job Secret (Required for Scheduled Publishing)

```bash
CRON_SECRET=your-random-secret-key-here
```

**Generate a secure secret**:
```bash
# Option 1: Use openssl
openssl rand -base64 32

# Option 2: Use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Important**: 
- Use a strong, random secret (at least 32 characters)
- Never commit this to git
- Vercel will automatically include this in the Authorization header for cron jobs

---

### 🔒 Encryption Key (Optional but Recommended)

```bash
ENCRYPTION_KEY=your-encryption-key-here
```

**Generate a secure key**:
```bash
openssl rand -base64 32
```

**Note**: If not set, a default key is used (not secure for production).

---

## Step 3: Update OAuth Redirect URIs

### LinkedIn

1. Go to LinkedIn Developers → Your App → Auth tab
2. Add callback URL:
   ```
   https://yourdomain.vercel.app/api/social/linkedin/callback
   ```
3. Save changes

### Twitter/X

1. Go to Twitter Developer Portal → Your App → Settings → User authentication settings
2. Add callback URL:
   ```
   https://yourdomain.vercel.app/api/social/twitter/callback
   ```
3. Save changes

**Note**: You'll need to update these after Vercel assigns your domain.

---

## Step 4: Update Clerk Redirect URLs

1. Go to Clerk Dashboard → Your Application → Configure → URLs
2. Add to **Allowed redirect URLs**:
   ```
   https://yourdomain.vercel.app/**
   ```
3. Update **After sign-in redirect**:
   ```
   https://yourdomain.vercel.app/dashboard
   ```
4. Update **After sign-out redirect**:
   ```
   https://yourdomain.vercel.app/
   ```

---

## Step 5: Run Database Migrations

Vercel will automatically run `npm run build`, but you need to ensure your database schema is up to date.

### Option A: Run Migrations Locally (Recommended)

```bash
# Make sure you're using production DATABASE_URL
npx prisma migrate deploy
```

### Option B: Use Vercel Build Command

Add to `package.json`:

```json
{
  "scripts": {
    "vercel-build": "prisma generate && prisma migrate deploy && next build"
  }
}
```

Then update Vercel project settings:
- **Build Command**: `npm run vercel-build`

---

## Step 6: Deploy

1. **Push your code to GitHub** (if not already pushed)
2. **Go to Vercel Dashboard** → Your Project
3. **Click "Deployments"** → **"Redeploy"** (or it will auto-deploy on push)
4. **Monitor the build logs** for any errors

---

## Step 7: Verify Deployment

### ✅ Check Build Success
- Build should complete without errors
- Check Vercel deployment logs

### ✅ Test Authentication
- Visit `https://yourdomain.vercel.app`
- Try signing in with Google OAuth
- Verify redirect works correctly

### ✅ Test Database Connection
- Sign in and create a draft
- Verify it saves to database

### ✅ Test Image Upload
- Upload an image on Dashboard

### ✅ Test Social Media Publishing
- Connect LinkedIn account (Settings page)
- Connect Twitter/X account (Settings page)
- Create and publish a post
- Verify it appears on the platform

### ✅ Test Scheduled Publishing
- Schedule a post for 1-2 minutes in the future
- Wait for scheduled time
- Verify post is published automatically
- Check Vercel Function logs for cron job execution

---

## Step 8: Configure Custom Domain (Optional)

1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add your custom domain
3. Follow DNS configuration instructions
4. Update environment variables:
   - `NEXT_PUBLIC_APP_URL` → Your custom domain
   - OAuth redirect URIs → Your custom domain
   - Clerk redirect URLs → Your custom domain

---

## Troubleshooting

### Build Fails

**Error**: "Module not found" or "Cannot find module"
- **Fix**: Ensure all dependencies are in `package.json`
- Run `npm install` locally to verify

**Error**: "Prisma Client not generated"
- **Fix**: Add `prisma generate` to build command
- Or use `vercel-build` script (see Step 5)

---

### Database Connection Fails

**Error**: "Can't reach database server"
- **Fix**: Check `DATABASE_URL` is correct
- Check SSL mode is set (`?sslmode=require`)

---

### OAuth Redirect Errors

**Error**: "Redirect URI mismatch"
- **Fix**: Ensure redirect URIs match exactly in:
  - Vercel environment variables
  - LinkedIn/Twitter app settings
  - Clerk redirect URLs

---

### Cron Job Not Running

**Error**: Scheduled posts not publishing
- **Fix**: 
  - Verify `CRON_SECRET` is set in Vercel
  - Check Vercel Cron is enabled (should be automatic)
  - Check Function logs in Vercel Dashboard
  - Verify cron endpoint is accessible: `https://yourdomain.vercel.app/api/posts/publish-scheduled`

---

### Images Not Uploading

**Error**: "Failed to upload image"
- **Fix**:
  - Verify bucket is set to public

---

## Environment Variables Checklist

Use this checklist to ensure all variables are set:

### Required Variables

- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- [ ] `CLERK_SECRET_KEY`
- [ ] `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
- [ ] `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- [ ] `NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL`
- [ ] `DATABASE_URL`
- [ ] `DIRECT_URL`
- [ ] `LINKEDIN_CLIENT_ID`
- [ ] `LINKEDIN_CLIENT_SECRET`
- [ ] `LINKEDIN_REDIRECT_URI`
- [ ] `TWITTER_CLIENT_ID`
- [ ] `TWITTER_CLIENT_SECRET`
- [ ] `TWITTER_REDIRECT_URI`
- [ ] `NEXT_PUBLIC_APP_URL`
- [ ] `CRON_SECRET`

### Optional Variables

- [ ] `ENCRYPTION_KEY` (recommended for production)

---

## Post-Deployment Checklist

- [ ] All environment variables configured
- [ ] Database migrations run successfully
- [ ] OAuth redirect URIs updated in LinkedIn/Twitter apps
- [ ] Clerk redirect URLs updated
- [ ] Custom domain configured (if applicable)
- [ ] Authentication flow tested
- [ ] Database operations tested
- [ ] Image upload tested
- [ ] Social media publishing tested
- [ ] Scheduled publishing tested
- [ ] Cron job verified working

---

## Quick Reference

### Vercel Dashboard URLs
- **Projects**: https://vercel.com/dashboard
- **Environment Variables**: Project → Settings → Environment Variables
- **Deployments**: Project → Deployments
- **Functions/Logs**: Project → Functions

### External Services
- **Clerk**: https://dashboard.clerk.com
- **LinkedIn Developers**: https://www.linkedin.com/developers/
- **Twitter Developer Portal**: https://developer.twitter.com/

---

## Next Steps After Deployment

1. **Monitor Logs**: Check Vercel Function logs regularly
2. **Set Up Monitoring**: Consider Sentry or similar for error tracking
3. **Performance**: Monitor Vercel Analytics
5. **Security**: Review environment variables regularly
6. **Updates**: Keep dependencies updated

---

**Last Updated**: December 2024  
**Status**: Ready for Production Deployment


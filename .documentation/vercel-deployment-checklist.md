# 🚀 Vercel Deployment Checklist

## Quick Start Summary

To deploy Levercast to Vercel, you need to:

1. ✅ **Connect GitHub repository** to Vercel
2. ✅ **Add 18+ environment variables** in Vercel Dashboard
3. ✅ **Update OAuth redirect URIs** in LinkedIn/Twitter apps
4. ✅ **Update Clerk redirect URLs**
5. ✅ **Run database migrations** (or use vercel-build script)
6. ✅ **Deploy and test**

---

## 📋 Pre-Deployment Checklist

### 1. Code Ready
- [x] All code committed to GitHub
- [x] `vercel.json` configured (cron jobs)
- [x] `package.json` has `vercel-build` script
- [x] No local-only dependencies

### 2. Accounts & Services Ready
- [ ] Vercel account created
- [ ] Clerk application created (production mode)
- [ ] LinkedIn Developer App created
- [ ] Twitter/X Developer App created

### 3. Environment Variables Prepared
- [ ] All values copied from respective dashboards
- [ ] Secrets generated (CRON_SECRET, ENCRYPTION_KEY)
- [ ] Production keys ready (not test keys)

---

## 🔑 Required Environment Variables (18 Total)

### Clerk (5 variables)
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL=/
```

```
```

```
```

### LinkedIn OAuth (3 variables)
```
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URI=https://YOUR_DOMAIN.vercel.app/api/social/linkedin/callback
```

### Twitter/X OAuth (3 variables)
```
TWITTER_CLIENT_ID=...
TWITTER_CLIENT_SECRET=...
TWITTER_REDIRECT_URI=https://YOUR_DOMAIN.vercel.app/api/social/twitter/callback
```

### App Configuration (2 variables)
```
NEXT_PUBLIC_APP_URL=https://YOUR_DOMAIN.vercel.app
CRON_SECRET=GENERATE_WITH_openssl_rand_-base64_32
```

### Optional but Recommended (1 variable)
```
ENCRYPTION_KEY=GENERATE_WITH_openssl_rand_-base64_32
```

---

## 📝 Step-by-Step Deployment

### Step 1: Connect Repository
1. Go to https://vercel.com/dashboard
2. Click "Add New..." → "Project"
3. Import `lever_cast` repository
4. Click "Deploy" (will fail initially - that's OK)

### Step 2: Add Environment Variables
1. Go to Project → Settings → Environment Variables
2. Add all 18+ variables from checklist above
3. **Important**: Set `NEXT_PUBLIC_APP_URL` to placeholder first (update after deployment)

### Step 3: Configure Build Settings
1. Go to Project → Settings → General
2. **Build Command**: `npm run vercel-build` (or leave default)
3. **Output Directory**: `.next` (default)
4. **Install Command**: `npm install` (default)

### Step 4: Update OAuth Redirect URIs
**After first deployment**, Vercel will assign you a domain (e.g., `levercast-abc123.vercel.app`):

1. **Update Vercel Environment Variables**:
   - `NEXT_PUBLIC_APP_URL` → `https://levercast-abc123.vercel.app`
   - `LINKEDIN_REDIRECT_URI` → `https://levercast-abc123.vercel.app/api/social/linkedin/callback`
   - `TWITTER_REDIRECT_URI` → `https://levercast-abc123.vercel.app/api/social/twitter/callback`

2. **Update LinkedIn App**:
   - LinkedIn Developers → Your App → Auth
   - Add callback: `https://levercast-abc123.vercel.app/api/social/linkedin/callback`

3. **Update Twitter App**:
   - Twitter Developer Portal → Your App → Settings → User authentication
   - Add callback: `https://levercast-abc123.vercel.app/api/social/twitter/callback`

4. **Update Clerk**:
   - Clerk Dashboard → Your App → Configure → URLs
   - Add to allowed redirects: `https://levercast-abc123.vercel.app/**`

5. **Redeploy** after updating variables

### Step 5: Verify Deployment
- [ ] Build succeeds
- [ ] Authentication works
- [ ] Database connection works
- [ ] Image upload works
- [ ] Social media publishing works
- [ ] Scheduled publishing works

---

## 🔍 Where to Find Each Value

### Clerk Keys
**Location**: https://dashboard.clerk.com → Your App → API Keys
- Copy `Publishable Key` → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- Copy `Secret Key` → `CLERK_SECRET_KEY`
- **Use production keys** (`pk_live_` and `sk_live_`)

- Copy "Connection pooling" URI → `DATABASE_URL`
- Copy "Direct connection" URI → `DIRECT_URL`


### LinkedIn OAuth
**Location**: https://www.linkedin.com/developers/ → Your App → Auth tab
- Copy "Client ID" → `LINKEDIN_CLIENT_ID`
- Copy "Client Secret" → `LINKEDIN_CLIENT_SECRET`

### Twitter/X OAuth
**Location**: https://developer.twitter.com/ → Your App → Keys and tokens
- Copy "Client ID" → `TWITTER_CLIENT_ID`
- Copy "Client Secret" → `TWITTER_CLIENT_SECRET`

### Generate Secrets
```bash
# Generate CRON_SECRET
openssl rand -base64 32

# Generate ENCRYPTION_KEY
openssl rand -base64 32
```

---

## ⚠️ Common Issues & Solutions

### Build Fails: "Prisma Client not generated"
**Solution**: The `vercel-build` script handles this automatically. Ensure it's set as build command.

### OAuth Redirect Errors
**Solution**: Ensure redirect URIs match exactly in:
- Vercel environment variables
- LinkedIn/Twitter app settings
- Clerk redirect URLs

### Database Connection Fails
**Solution**: 
- Verify `DATABASE_URL` includes `?sslmode=require`
- Verify password is correct

### Cron Job Not Running
**Solution**:
- Verify `CRON_SECRET` is set
- Check Vercel Cron is enabled (automatic with `vercel.json`)
- Check Function logs in Vercel Dashboard

---

## 📚 Documentation References

- **Full Deployment Guide**: `.documentation/vercel-deployment-guide.md`
- **Environment Variables Template**: `.documentation/vercel-env-vars-template.md`

---

## ✅ Post-Deployment Verification

Run through these tests:

1. **Authentication**: Sign in with Google OAuth
2. **Database**: Create a draft, verify it saves
4. **Publishing**: Connect LinkedIn/Twitter and publish a post
5. **Scheduling**: Schedule a post, verify it publishes automatically
6. **Cron**: Check Vercel Function logs for cron execution

---

**Ready to deploy?** Follow the step-by-step guide in `.documentation/vercel-deployment-guide.md`


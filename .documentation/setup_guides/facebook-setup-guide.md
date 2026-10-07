# Meta (Facebook & Instagram) Connection Guide

This walkthrough covers connecting Facebook Pages (and Instagram Business accounts via Meta) to Omniply.

## Prerequisites
- You must be an admin of the Facebook Page (and linked Instagram Business account, if applicable).
- Our Meta app must be in **Live** mode with:
  - "Manage everything on your Page" use case approved (for Facebook Pages)
  - **Instagram > API setup with Facebook login** product added (for Instagram posting)
- Your Instagram account must be a **Business or Creator account** (not a personal account)
- Your Instagram Business account must be **linked to a Facebook Page**
- Pop-ups enabled in your browser.

## Adding Instagram Product to Your Facebook App

If you need to add Instagram posting capability:

### Method 1: Look for Product Cards on Dashboard
1. **Go to Meta App Dashboard** (https://developers.facebook.com/apps/)
2. **Select your app**
3. **On the main dashboard page**, **scroll down** past the "App customization and requirements" section
   - Products are shown as cards/tiles on the main dashboard page
   - You should see cards for different products like "Instagram", "Messenger", "WhatsApp", etc.
4. **Find the "Instagram" product card** and click **"Set up"** or **"Get Started"**

### Method 2: Check Left Sidebar Menu
If you don't see product cards, check the **left sidebar menu**:
1. Look for a **"Products"** menu item (may be collapsed or under a dropdown)
2. Or look for **"Instagram"** directly in the sidebar
3. Click on it to access Instagram product settings

### Method 3: Add Product Button
1. Look for a **"+ Add Product"** or **"Add Product"** button on the dashboard
2. Click it and select "Instagram" from the list

### After Finding Instagram Product:
1. **Click "Set up"** on the Instagram product
2. **Select "API setup with Facebook login"** (not "API setup with Instagram login")
   - This is the correct option for apps that use Facebook Login for Business
   - This allows publishing to Instagram accounts linked to Facebook Pages
   - If you see "API setup with Instagram login" selected by default, change it to "API setup with Facebook login"
3. **Complete any required configuration** (redirect URIs, etc.)

**Note:** 
- **Products** are API capabilities (like Instagram, Facebook Login, Messenger)
- **Use Cases** describe what your app does (like "Manage everything on your Page")
- If you still can't find Instagram, your app might need to be in "Business" type (check App Settings > Basic)

## Step-by-Step
1. **Open Settings in Omniply**
   - Visit `/settings`.

2. **Connect Facebook**
   - In “Connected Accounts,” find Facebook and click `Connect`.
   - A Meta popup opens; log in if needed.
   - Grant the requested permissions: `public_profile`, `business_management`, `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.

3. **Select Pages**
   - After granting permissions, Meta returns the list of pages you manage.
   - In Omniply, choose which page to use for publishing.

4. **Instagram (optional)**
   - If your Instagram Business account is linked to that Facebook Page, the same connection works for Instagram publishing.
   - When connecting Instagram, you'll be asked to grant: `pages_show_list`, `pages_read_engagement`, `instagram_content_publish`, and `business_management` permissions.
   - Note: We use Instagram Graph API (for publishing), not Instagram Basic Display API (read-only). Do not mix scopes from both APIs.
   - Set the post target accordingly in Omniply settings.

## Troubleshooting

### General Issues
- **Popup blocked:** allow pop-ups for Omniply and retry.
- **No pages shown:** ensure you're a Page admin and granted all permissions when Meta prompted "What this app can do."
- **Permissions missing:** if Meta revoked permissions, disconnect in Omniply and reconnect to refresh scopes.
- **Publishing failures:** verify the page remains connected in Facebook Business settings and regenerate the token by reconnecting.

### Instagram-Specific Issues
- **"Invalid Scopes: instagram_content_publish" error:** This means the Instagram product is not properly configured. Ensure:
  1. The **Instagram Graph API** product is added to your Facebook app (NOT "Instagram Basic Display API")
     - Go to Meta App Dashboard → Your App → Products
     - Add "Instagram Graph API" product
     - Do NOT add "Instagram Basic Display API" (that's a different, read-only API)
  2. Your Instagram account is a Business or Creator account
  3. Your Instagram account is linked to a Facebook Page
  4. The app has completed App Review for `instagram_content_publish` permission (if required)
  5. You disconnect and reconnect Instagram in Omniply to get the correct scopes

- **Note:** `instagram_basic` is part of Instagram Graph API and is designed to read profile metadata of Business accounts. It is compatible with `instagram_content_publish` and both can be requested together. The deprecated Basic Display API uses `user_profile` and `user_media` scopes, which are different.

- **Instagram posting fails:** Verify:
  1. **Instagram > API setup with Facebook login** product is added to the app (not just the use case)
  2. Instagram Business account is linked to the Facebook Page you're using
  3. You have admin access to both the Facebook Page and Instagram account
  4. The Instagram account has completed Page Publishing Authorization (PPA) if required
  5. The app is in **Live** mode (not Development mode) for production use

## Next Steps
- Drafts or scheduled posts that include Facebook/Instagram will now publish to the selected page.
- You can change the target page anytime in Settings without redoing OAuth, as long as the authorization is still valid.


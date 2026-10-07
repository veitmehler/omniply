# LinkedIn Connection Guide

Use this checklist to connect your LinkedIn presence to Omniply. You can link both your personal profile and company pages.

## Prerequisites
- LinkedIn account with the correct privileges:
  - Personal profile: any LinkedIn user.
  - Company pages: you must be a **Super Admin** on the page.
- Pop-ups enabled in your browser.
- Company pages are supported out of the box.

## Step-by-Step
1. **Open Omniply Settings**
   - Navigate to `/settings`.

2. **Connect Personal Profile (optional but recommended)**
   - In “Connected Accounts,” locate the LinkedIn row.
   - Click **Personal Profile**.
   - Sign in to LinkedIn if prompted and approve the requested scopes (`w_member_social`).
   - You’ll return to Omniply; status should show “Connected as …”.

3. **Connect Company Page (requires LinkedIn approval)**
   - Click **Company Page**.
   - Authorize the second LinkedIn app. Requested scopes: `w_organization_social`, `r_organization_social`, `r_organization_admin`.
   - After approval you’ll see a list of pages you super-admin. Select one for publishing.
   - If LinkedIn shows `invalid_scope_error` or the page list is empty, LinkedIn hasn’t granted community access yet—see Troubleshooting.

4. **Set publishing target**
   - Under LinkedIn settings, choose whether posts go to your personal feed, company page, or switch as needed.

## Troubleshooting
- **`invalid_scope_error`:** LinkedIn hasn’t approved Community Management access yet. We’re awaiting their review—try again after approval.
- **No company pages listed:** confirm your LinkedIn user is a Super Admin and that you connected via the “Company Page” button.
- **Connection lost:** disconnect in Omniply, then reconnect. Tokens expire periodically; reauthorization refreshes them.
- **Analytics unavailable:** LinkedIn currently restricts the `r_member_social` scope. Analytics must be checked directly on LinkedIn.

## Next Steps
- Once connected, drafting or scheduling LinkedIn posts in Omniply will target the selected profile/page automatically.
- You can always switch between personal and company targets in Settings without re-authorizing.


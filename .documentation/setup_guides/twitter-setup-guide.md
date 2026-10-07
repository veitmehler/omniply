# Twitter/X Connection Guide

Follow these steps so your Twitter/X account can authorize Omniply and let us publish on your behalf. You only need to do this once per Twitter/X account.

## Prerequisites
- You must be an admin of the Twitter/X account you want to connect.
- Have your Omniply account ready and signed in.
- Ensure pop-ups are allowed in your browser (Twitter’s OAuth popup opens in a new window).

## Step-by-Step
1. **Open Settings in Omniply**
   - Go to `/settings` inside the app.

2. **Start the Twitter/X connection**
   - In the “Connected Accounts” list, find the Twitter/X row.
   - Click `Connect`.
   - Allow Omniply to redirect you to Twitter/X’s consent screen.

3. **Authorize on Twitter/X**
   - Log in if prompted.
   - Review the requested permissions (`tweet.read`, `tweet.write`, `users.read`, `offline.access`, `media.write`).
   - Click `Authorize app`.

4. **Return to Omniply**
   - Twitter/X redirects back to Omniply automatically.
   - You should now see “Connected” next to Twitter/X in settings.

## Troubleshooting
- **Popup blocked:** enable pop-ups for Omniply and retry.
- **Wrong account:** disconnect inside Omniply, log out of Twitter/X in your browser, then reconnect.
- **401/403 errors:** regenerate the connection from settings to refresh your access token.
- **Rate-limit errors:** Twitter/X enforces global limits; wait until the reset time shown in the error message before posting again.

## Next Steps
- After connecting, drafts and scheduled posts that include Twitter/X will publish through Omniply automatically.
- If you ever need to revoke access, disconnect in Omniply (Settings → Twitter/X → Disconnect) and optionally revoke within Twitter/X’s “Connected Apps” page.


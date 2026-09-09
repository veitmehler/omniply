# Omniply Connect — wordpress.org submission runbook

Why: the .org directory listing is what makes WP core's plugins REST endpoint
able to INSTALL + ACTIVATE the plugin on every connected clinic site with the
admin app password we already hold (zero-touch head-schema for all clinics,
page-builder-proof). Agent plan Phase 3.1b.

Steps (user):
1. Create/log into a wordpress.org account (suggest: the omniply brand account).
2. Zip the plugin folder: `cd integrations/omniply-wp-plugin && zip -r omniply-connect.zip omniply-connect`
3. Submit at https://wordpress.org/plugins/developers/add/ (upload the zip).
4. Review queue: typically days to a few weeks. Reviewers may email requesting
   changes — forward them; the plugin is deliberately minimal (print-only, one
   option, no external calls) precisely to sail through.
5. On approval you get SVN access — commit the same files to `trunk/` + tag
   `1.0.0` (I can prepare the SVN commands when the approval email arrives).

After it's live in the directory, platform-side adoption (separate build item):
- Provisioning calls `POST /wp-json/wp/v2/plugins {slug:"omniply-connect", status:"active"}`
- Then writes the entity block: `POST /wp-json/omniply/v1/head {jsonld:[...]}`
- Clinics with the plugin get head-level schema on EVERY page (ladder collapses);
  the body-fenced blocks remain as the no-plugin fallback.

---

# v1.1.0 release (chat-widget embed) — SVN steps

Built 2026-09-09. What changed: optional chat-widget footer embed (fixed-domain
loader `https://svc.omniply.io/api/agent/widget.js?v=4`, printed only when a
validated token is stored), new REST route `/omniply/v1/widget` (POST/GET,
manage_options), uninstall clears the token option, readme discloses the one
external script. Directory updates ship via SVN with NO re-review.

Steps (user, with the SVN credentials from the approval email):

```
# fresh checkout (or update an existing one)
svn co https://plugins.svn.wordpress.org/omniply-connect omniply-connect-svn
cd omniply-connect-svn

# copy the three plugin files over trunk
cp /PATH/TO/repo/integrations/omniply-wp-plugin/omniply-connect/omniply-connect.php trunk/
cp /PATH/TO/repo/integrations/omniply-wp-plugin/omniply-connect/uninstall.php     trunk/
cp /PATH/TO/repo/integrations/omniply-wp-plugin/omniply-connect/readme.txt        trunk/

# tag the release and commit (readme Stable tag is already 1.1.0)
svn cp trunk tags/1.1.0
svn ci -m "v1.1.0: optional fixed-domain chat-widget embed + /omniply/v1/widget route"
```

The directory serves the new zip within ~15 minutes of the commit. Platform
side (already in the codebase, apps/api/src/lib/omniply-connect.ts): the
auto-installer installs/activates the plugin, writes the widget token to
/omniply/v1/widget, and pushes the entity+FAQ JSON-LD to /omniply/v1/head on
every onboarding finale and WP-connection create. Sites that auto-install
BEFORE the SVN push get v1.0 (widget write logs a 404 warning); re-running
onboarding finale or reconnecting WP after the push heals them.

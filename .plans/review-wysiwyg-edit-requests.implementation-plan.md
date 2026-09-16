# Review WYSIWYG + edit requests everywhere (planned 2026-09-16)

The sign-off selling point, completed: the client reads the REAL email,
clicks into it to fix words, highlights passages to delegate to a teammate
picked from their GHL user list, and approves. Everything happens inside
the CRM embed; notification emails lead back into the CRM.

Decisions locked with Veit (2026-09-16):
- GHL users: list ALL location users as assignees; account seats stay
  capped at 3; **NO silent auto-join** — seats are created explicitly.
- Side-panel editors were a stopgap ("not usable"); editing moves INTO
  the email preview.
- Notification emails must link into GHL (crm.omniply.io), not our app.

## 1. In-preview WYSIWYG (newsletter)

Mirrors the article reviewer (plain contentEditable, dirty-tracking, one
save — no toolbar in v1; native shortcuts still work, the renderer
restyles everything anyway).

- **Edit-mode render**: `renderNewsletterHtml(input, brand, { editMode })`
  stamps prose blocks with `data-nl-section` anchors:
  `featureArticle.title|.body|.tldr`, `secondaryArticle.*`,
  `teasers.<i>.headline|.body`, `quickHits.tips|.facts` (per-line),
  `fun.joke|.triviaQuestion|.triviaAnswer`,
  `modules.recipe|recipe2 .intro|.ingredients|.instructions`.
  Bands, buttons, footer, offers, video card, source links: NOT stamped —
  structurally locked.
- **Iframe bridge**: a tiny inline script (only in editMode) sets
  contentEditable on stamped nodes, outlines them on hover/focus, tracks
  dirty sections, and posts `{section, html}` maps to the parent on input
  (debounced). Parent (NewsletterEditionContent) keeps a dirty map and
  shows one **Save changes** button; save folds the map back into the
  section JSON shapes and PATCHes (existing sanitizer + Option B
  re-render refresh the preview).
- Reverse-map details: tips/facts lines rejoin to arrays; recipe
  ingredient/instruction edits store back as the same HTML fields;
  band-displayed titles (teaser headlines, secondary title) are stamped
  inside the band text node itself.
- **Side panels slim down** to the structural set: metadata, regenerate,
  section toggles, video controls. The "Edit content" card is removed.
- Approve stays gated on no unsaved edits (same as the article modal's
  dirty guard).

## 2. Request edits — newsletters + shared machinery

- Model: `ArticleEditRequest` gains nullable `newsletterId` (+ index);
  `sitePageId` becomes nullable; a check in code requires exactly one of
  the two. ONE migration.
- Routes: generalize to `POST/GET /newsletters/:id/edit-requests`
  alongside the article pair (shared handler core in
  `edit-requests.ts`).
- Selection capture inside the preview iframe: same editMode bridge posts
  `{quotedText, prefixContext, suffixContext}` on selection while
  "Request edits" mode is armed (editing disabled meanwhile, exactly like
  the article modal's mode switch). Note + batch + assignee UI is lifted
  from ReviewApproveModal into a shared component both modals use.
- Assistant flow: the assignee opens the edition, sees the request pins
  (quote-matched highlights in the preview), edits in place, marks each
  done → reviewer notification (existing round-trip pattern, extended to
  the newsletter case; `reviewState`-equivalent lives on Newsletter:
  reuse `status`? NO — add nothing; track via open-request count like the
  article assistant panel does).

## 3. Assignees from GHL — sync without auto-join

- **NEW `GET /account/ghl-users`**: wraps GHL `GET /users/?locationId=`
  (empirically verified working with our existing location tokens,
  2026-09-16 — no new scopes). Returns name/email/role for ALL users.
  Merged (dedupe by email) with roster members in the assignee dropdown;
  GHL-only entries badged "from your CRM".
- **Seat policy (Veit decision)**: seats capped at 3; NO auto-join.
  - Sending to a GHL-only user: if roster < 3 → create the member row AT
    SEND TIME (visible, deliberate provisioning); if roster is full →
    block the send with "Seat limit reached — remove a member in
    Settings → Team first".
  - **Remove the silent SSO auto-join** (account.ts auto-join-by-email —
    also audit finding #15): SSO maps EXISTING members only; a GHL user
    without a seat sees "Ask the account owner to send you an invite or
    an edit request" instead of silently gaining a seat.
  - Regression care: second-user access currently DEPENDS on auto-join —
    the send-time provisioning + a manual "Add member" in Settings → Team
    (exists? verify; add if missing) must land in the same deploy.

## 4. Notifications lead into the CRM

- Accounts with a GHL connection: email links become
  `https://crm.omniply.io/v2/location/{locationId}/` with copy "open
  Omniply from your CRM sidebar" (white-label safe). Fallback for
  non-GHL accounts: current app links.
- **In-app pickup** (the real deep link): EmbedShell on load calls
  `GET /edit-requests/mine` (new, both kinds) → banner "N edit requests
  on {title} → Open" → opens the right review modal directly. Same for
  the reviewer's "edits are done" state. URL precision in GHL becomes
  irrelevant.
- Both existing email templates (assignee + reviewer-done) updated.

## Sequencing

1. WYSIWYG render mode + bridge + save path (newsletter) — biggest, first.
2. Edit-request generalization (migration + routes + shared UI) for
   newsletters; article modal switches to the shared component.
3. GHL assignee endpoint + dropdown merge + send-time seat creation +
   auto-join removal + Settings Team add-member check.
4. Notification links + EmbedShell pickup banner.
5. Suites (render reverse-map unit tests; sanitizer round-trip; seat-cap
   edge tests) → staging → prod → live walkthrough on the sample edition
   with a real edit request to Dr Andrew Simon's email.

## Out of scope

- Formatting toolbar in the preview (v2 — native shortcuts suffice).
- Article WYSIWYG changes (already works; only its request-edits UI is
  refactored into the shared component).
- Approval-after-edit re-flows, versioning/undo beyond browser undo.

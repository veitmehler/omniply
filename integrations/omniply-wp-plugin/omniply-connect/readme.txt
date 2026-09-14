=== Omniply Connect ===
Contributors: veitmehler
Tags: schema, structured data, json-ld, seo, chat widget
Requires at least: 5.5
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Prints the structured-data (JSON-LD) block managed by your Omniply marketing platform in the site head, and optionally embeds your Omniply chat widget.

== Description ==

Omniply Connect is a deliberately minimal companion plugin for clinics using the
Omniply marketing platform. It does two things, each off by default:

1. It prints a validated JSON-LD structured-data block (your clinic's name,
   address, opening hours, booking link and FAQ) in your site's head, where
   search engines and AI answer surfaces read it.
2. It embeds your clinic's Omniply chat widget in the site footer — but only
   after a widget token has been configured (see below).

* The JSON-LD path is print-only: it never executes remote code and phones
  home to nothing. The entire state is a single validated JSON string.
* The chat widget, when enabled, loads exactly one script from the fixed
  Omniply platform domain (`svc.omniply.io`). The script URL is a constant in
  the plugin source — the stored token selects WHICH clinic's widget loads,
  never WHERE the script comes from. With no token stored, nothing is loaded
  at all. Conversations typed into the widget are processed by the Omniply
  platform on behalf of your clinic (see your Omniply agreement for details).
* Updated by your platform: both options are written through the WordPress
  REST API using the same Application Password connection you created for
  publishing — administrator capability (`manage_options`) is required.
* No settings screen, no dashboard widgets, no notices. Deactivate or uninstall
  at any time; uninstalling removes the stored options.

This plugin is intended for Omniply customers, but the stored state is plain:
you can inspect the schema block under the `omniply_head_jsonld` option (or
`GET /wp-json/omniply/v1/head` as an administrator) and the widget token under
`omniply_widget_token` (or `GET /wp-json/omniply/v1/widget`).

== Installation ==

1. Install the plugin through Plugins → Add New (or upload the ZIP via
   Plugins → Add New → Upload Plugin) and activate it.
2. No further setup is needed on the site itself: the plugin has no settings
   screen and stores no data on activation.
3. IMPORTANT — the plugin prints nothing until a structured-data block has
   been written to it. On a fresh activation the stored option is empty, and
   an empty option produces NO output in the page source. This is by design
   (print-only, empty state = silent).

The block is written in one of two ways:

* Automatically, by the Omniply platform: when you connect your site in
  Omniply using a WordPress Application Password for an administrator
  account, the platform posts your clinic's JSON-LD to
  `POST /wp-json/omniply/v1/head`. From then on the block appears in your
  site head and is kept up to date whenever your details change.
* Manually, by any administrator — useful for testing that the plugin works
  without an Omniply account. For example, with WP-CLI:

  `wp option update omniply_head_jsonld '[{"@context":"https://schema.org","@type":"MedicalClinic","name":"Test Clinic"}]'`

  or over REST with an Application Password:

  `curl -X POST 'https://YOURSITE/?rest_route=/omniply/v1/head' -u 'admin:APP_PASSWORD' -H 'Content-Type: application/json' -d '{"jsonld":[{"@context":"https://schema.org","@type":"MedicalClinic","name":"Test Clinic"}]}'`

After either of these, reload any front-end page and view the source: the
block appears in the head between `<!-- Omniply Connect -->` markers. Sending
an empty `jsonld` value (or deleting the option) removes the output again.

The chat widget works the same way: it renders nothing until a widget token
has been written, normally by the Omniply platform when your site is
connected. To set one manually as an administrator:

  `curl -X POST 'https://YOURSITE/?rest_route=/omniply/v1/widget' -u 'admin:APP_PASSWORD' -H 'Content-Type: application/json' -d '{"token":"YOUR_WIDGET_TOKEN"}'`

The token (shown in your Omniply dashboard under Chat Assistant) must match
`[A-Za-z0-9_-]{16,64}`; anything else is rejected. Sending an empty `token`
removes the widget again.

== Frequently Asked Questions ==

= I activated the plugin but there is no JSON-LD in my page source =

That is the expected state of a fresh install. The plugin only prints the
block after one has been written to it — either by the connected Omniply
platform or manually by an administrator (see Installation). While the
stored option is empty, the plugin outputs nothing at all.

= Does this plugin collect any data? =

The plugin itself collects nothing: it stores two options locally and prints
them. If (and only if) a chat-widget token has been configured, the embedded
Omniply widget behaves like any live-chat product: messages a visitor types
into it are sent to the Omniply platform to generate replies for your clinic.
With no token stored, no external request of any kind is made.

= Does it load external scripts? =

Only one, and only when the chat widget has been enabled by storing a widget
token: the widget loader from the fixed Omniply platform domain
(`svc.omniply.io`). That URL is a constant in the plugin source and cannot be
changed by any stored option. A fresh install loads nothing.

= Can it run arbitrary code? =

No. The JSON-LD input is parsed as JSON and re-encoded on output; anything
that is not valid JSON is rejected and never printed. The widget token is
validated against a strict character whitelist before it is stored or printed,
and it only ever appears as a data attribute on the fixed-URL script tag.

== Changelog ==

= 1.1.0 =
* New: optional Omniply chat-widget embed (fixed-domain loader script,
  enabled only by storing a validated widget token; REST route
  `/omniply/v1/widget` for the connected platform to configure it).
* Uninstall now removes the widget token option as well.

= 1.0.0 =
* Initial release: head JSON-LD printing + authenticated REST write route.

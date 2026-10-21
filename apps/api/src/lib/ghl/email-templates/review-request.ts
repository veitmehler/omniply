/**
 * Review-request email template (snapshot email-branding design — the
 * booking-confirmation's sibling; same brand custom values, same shell).
 * Used by the appointment-completed review workflow.
 *
 * The review CTA uses {{custom_values.omniply_review_url}} (the clinic's
 * Google review deep link, written at the GBP-probe commit alongside the
 * omniply-review trigger-link repoint) rather than a trigger-link merge id,
 * because trigger-link ids do not survive snapshot replication; the custom
 * value name does. Trade-off: this button is not GHL-click-tracked (the QR
 * card + DM surfaces keep the tracked trigger link).
 *
 * Compliance: a neutral ask — no incentives, no rating steering, no
 * review gating. Dash-free copy (de-AI rule).
 */

export const REVIEW_REQUEST_TEMPLATE_NAME = 'Omniply review request'

const FONT = `{{custom_values.omniply_brand_font_family}}, Helvetica, Arial, sans-serif`

export const REVIEW_REQUEST_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>How was your visit?</title>
</head>
<body style="margin:0; padding:0; background-color:#f2f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f4f6;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">

          <!-- Header band: newsletter header color + logo at the client's chosen width -->
          <tr>
            <td align="center" style="background-color:{{custom_values.omniply_brand_header_color}}; padding:26px 24px;">
              <img src="{{custom_values.omniply_brand_logo_header}}" alt="{{location.name}}" width="{{custom_values.omniply_brand_logo_width}}" style="display:block; width:{{custom_values.omniply_brand_logo_width}}px; max-width:100%; height:auto; border:0;" />
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:34px 36px 8px 36px; font-family:${FONT};">
              <p style="margin:0; font-size:13px; letter-spacing:2px; text-transform:uppercase; color:{{custom_values.omniply_brand_accent_color}}; font-weight:bold;">Thank you for visiting</p>
              <h1 style="margin:10px 0 0 0; font-size:26px; line-height:1.25; color:{{custom_values.omniply_brand_font_color}};">How was your visit, {{contact.first_name}}?</h1>
            </td>
          </tr>

          <!-- Body copy -->
          <tr>
            <td style="padding:18px 36px 6px 36px; font-family:${FONT};">
              <p style="margin:0; font-size:15.5px; line-height:1.6; color:{{custom_values.omniply_brand_font_color}};">It was a pleasure having you in. If you have a spare minute, we would love to hear how it went. Your words help neighbors find us, and they help us keep getting better at what we do.</p>
              <p style="margin:14px 0 0 0; font-size:15.5px; line-height:1.6; color:{{custom_values.omniply_brand_font_color}};">It takes about a minute, and every single one gets read by our team.</p>
            </td>
          </tr>

          <!-- Review button: the newsletter's button pair -->
          <tr>
            <td align="center" style="padding:24px 36px 14px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color:{{custom_values.omniply_brand_button_color}}; border-radius:8px;">
                    <a href="{{custom_values.omniply_review_url}}" style="display:inline-block; padding:13px 30px; font-family:${FONT}; font-size:16px; font-weight:bold; color:{{custom_values.omniply_brand_button_text_color}}; text-decoration:none;">Share your experience</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Soft alternative -->
          <tr>
            <td align="center" style="padding:0 36px 30px 36px; font-family:${FONT};">
              <p style="margin:0; font-size:13.5px; line-height:1.6; color:#5c6672;">Something we could have done better? Just reply to this email... it comes straight to us.</p>
            </td>
          </tr>

          <!-- Footer band: the newsletter's FOOTER color + its computed ink -->
          <tr>
            <td align="center" style="background-color:{{custom_values.omniply_brand_footer_color}}; padding:20px 24px;">
              <p style="margin:0; font-family:${FONT}; font-size:13px; line-height:1.6; color:{{custom_values.omniply_brand_footer_ink}};">{{location.name}} &middot; {{location.phone}}<br/>{{location.full_address}}</p>
            </td>
          </tr>

        </table>
        <p style="margin:14px 0 0 0; font-family:${FONT}; font-size:12px; color:#8a97a6;">You are receiving this after your recent visit to {{location.name}}.</p>
      </td>
    </tr>
  </table>
</body>
</html>`

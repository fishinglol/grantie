// Sends the "you're on the waitlist" email via Resend.
// Called from the signup form in src/components/Signup.tsx right after the Supabase insert succeeds.
// Requires RESEND_API_KEY as a Vercel environment variable (Project settings → Environment Variables).
// Vercel Node.js function convention: default export (req, res), req.body is auto-parsed for JSON.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).send('Missing email');
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set');
    return res.status(500).send('Email service not configured');
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // resend.dev works out of the box for testing. Once you verify your own domain
      // in Resend, switch this to something like "Granite <hello@yourdomain.com>".
      from: 'Granite <onboarding@resend.dev>',
      to: email,
      subject: "You're on the Granite waitlist",
      html: welcomeEmailHtml(),
    }),
  });

  if (!resendRes.ok) {
    console.error('Resend error', resendRes.status, await resendRes.text());
    return res.status(502).send('Failed to send email');
  }

  return res.status(200).send('OK');
}

// Table-based layout + inline styles, since email clients (Outlook especially)
// don't reliably support modern CSS or web fonts — Georgia/monospace stacks
// stand in for the site's Fraunces/JetBrains Mono.
function welcomeEmailHtml() {
  const dark = '#1C1B1A';
  const sand = '#8B7355';
  const lichen = '#5C6E52';
  const bg = '#F5F3EE';
  const white = '#FDFCFA';
  const ink60 = 'rgba(28,27,26,0.62)';
  const ink40 = 'rgba(28,27,26,0.42)';

  const feature = (label) => `
    <tr>
      <td style="padding:0 0 10px; font-family: Georgia, 'Times New Roman', serif; font-size:14px; color:${dark};">
        <span style="color:${lichen}; font-weight:bold;">&#10003;</span>&nbsp;&nbsp;${label}
      </td>
    </tr>`;

  return `
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:${bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};">
      <tr>
        <td align="center" style="padding:48px 20px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:${white}; border:1px solid rgba(28,27,26,0.10); border-radius:14px; overflow:hidden;">

            <tr>
              <td style="padding:32px 36px 0;">
                <img src="data:image/png;base64,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" width="16" height="16" alt="" style="vertical-align:middle; margin-right:8px; border-radius:50%;" />
                <span style="font-family: Georgia, 'Times New Roman', serif; font-size:18px; font-weight:bold; color:${dark}; vertical-align:middle;">
                  Granite
                </span>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 36px 0;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:${sand};">
                  &mdash;&nbsp; Early access
                </span>
              </td>
            </tr>

            <tr>
              <td style="padding:10px 36px 0;">
                <span style="font-family: Georgia, 'Times New Roman', serif; font-size:28px; line-height:1.2; color:${dark};">
                  You're on the list.
                </span>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 36px 0; font-family: Helvetica, Arial, sans-serif; font-size:15px; line-height:1.6; color:${ink60};">
                Thanks for joining the Granite waitlist — a local-first Markdown note app
                with native multi-cloud sync and friction-free import from your current app.
              </td>
            </tr>

            <tr>
              <td style="padding:24px 36px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${feature('Drive, Dropbox, OneDrive, or iCloud &mdash; pick one, no plugins')}
                  ${feature('Import from Obsidian, Joplin, or Notion, nothing rebuilt by hand')}
                  ${feature('Plain Markdown files on disk &mdash; no lock-in')}
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 36px 0; font-family: Helvetica, Arial, sans-serif; font-size:14px; line-height:1.6; color:${ink60};">
                We'll email you here the moment there's a beta invite or an early-access
                link &mdash; nothing else in between.
              </td>
            </tr>

            <tr>
              <td style="padding:28px 36px 32px;">
                <div style="border-top:1px solid rgba(28,27,26,0.10); padding-top:18px; font-family: 'Courier New', Courier, monospace; font-size:11px; color:${ink40};">
                  Granite &mdash; built for people whose vault outgrew their cloud plan.
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

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
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 20L9 6L14 14L17 4L20 20H4Z' fill='%231C1B1A'/%3E%3C/svg%3E" width="16" height="16" alt="" style="vertical-align:middle; margin-right:8px;" />
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

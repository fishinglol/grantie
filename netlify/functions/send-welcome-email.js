// Sends the "you're on the waitlist" email via Resend.
// Called from the signup form in index.html right after the Supabase insert succeeds.
// Requires RESEND_API_KEY as a Netlify environment variable (Site settings → Environment variables).

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: 'Bad Request' };
  }

  if (!email || typeof email !== 'string') {
    return { statusCode: 400, body: 'Missing email' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set');
    return { statusCode: 500, body: 'Email service not configured' };
  }

  const res = await fetch('https://api.resend.com/emails', {
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
      html: `
        <div style="font-family: sans-serif; color: #1C1B1A; max-width: 480px; line-height: 1.6;">
          <p>Hey,</p>
          <p>Thanks for joining the Granite waitlist — you're in.</p>
          <p>We're building a local-first Markdown note app with native multi-cloud sync
          (Drive, Dropbox, OneDrive, iCloud) and friction-free import from Obsidian, Joplin,
          and Notion.</p>
          <p>If anything changes — a beta invite, a launch date, an early-access link —
          we'll email you here. No spam, nothing else in between.</p>
          <p>— The Granite team</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    return { statusCode: 502, body: 'Failed to send email' };
  }

  return { statusCode: 200, body: 'OK' };
};

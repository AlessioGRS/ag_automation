// POST /api/contact - receives the contact form, blocks bots, emails the message.
//
// Bot protection: a hidden honeypot field plus a Cloudflare Turnstile token verified here.
// Delivery: Resend HTTP API, sent from MAIL_FROM to MAIL_TO with Reply-To set to the visitor.
//
// Environment:
//   TURNSTILE_SECRET_KEY  secret, set in the Cloudflare dashboard (Worker > Settings > Variables and Secrets)
//   RESEND_API_KEY        secret, set in the Cloudflare dashboard
//   MAIL_TO, MAIL_FROM    plain vars, defined in wrangler.jsonc

const LIMITS = { name: 120, email: 254, company: 160, message: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleContact(request, env, fetchImpl = fetch) {
  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, 'invalid');
  }
  if (!body || typeof body !== 'object') return reply(400, 'invalid');

  // Honeypot: real people never see this field. Pretend success so bots learn nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') return reply(200);

  const fields = {};
  for (const key of Object.keys(LIMITS)) {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (value.length > LIMITS[key]) return reply(400, 'invalid');
    fields[key] = value;
  }
  if (!fields.name || !fields.message || !EMAIL_RE.test(fields.email)) return reply(400, 'invalid');
  // Header injection guard for the values that end up in the subject and Reply-To.
  if (/[\r\n]/.test(fields.name + fields.email + fields.company)) return reply(400, 'invalid');

  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) return reply(403, 'captcha');

  const verify = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: request.headers.get('CF-Connecting-IP') || undefined,
    }),
  }).then((r) => r.json()).catch(() => null);
  if (!verify || verify.success !== true) return reply(403, 'captcha');

  const sent = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [env.MAIL_TO],
      reply_to: fields.email,
      subject: `Sito AG Automation: ${fields.name}${fields.company ? ` (${fields.company})` : ''}`,
      text: [
        `Nome: ${fields.name}`,
        `Email: ${fields.email}`,
        `Azienda / progetto: ${fields.company || '-'}`,
        '',
        fields.message,
      ].join('\n'),
    }),
  }).catch(() => null);
  if (!sent || !sent.ok) {
    console.error('Resend failed', sent && sent.status, sent && (await sent.text().catch(() => '')));
    return reply(502, 'send');
  }

  return reply(200);
}

function reply(status, error) {
  return new Response(JSON.stringify(error ? { ok: false, error } : { ok: true }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

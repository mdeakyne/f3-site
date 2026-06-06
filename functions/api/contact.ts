// Cloudflare Pages Function: POST /api/contact
//
// "Join F3 Lawrence" form. Validates the Turnstile token, then posts the
// request into Slack (#admin) via an incoming webhook. No email, no database —
// the destination webhook URL lives in a Cloudflare secret (SLACK_WEBHOOK_URL)
// and is never exposed to the client.
//
// Set the secret with:
//   wrangler pages secret put SLACK_WEBHOOK_URL --project-name f3-site
// See docs/slack-webhook-setup.md for how to create the webhook.

interface Env {
  TURNSTILE_SECRET: string;
  SLACK_WEBHOOK_URL: string;
  // LOCAL DEV ONLY: set to "true" in .dev.vars to skip Turnstile verification
  // when testing. Never set this in the production Pages project — without it,
  // Turnstile is always enforced.
  TURNSTILE_DISABLED?: string;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const form = await request.formData();

  const token = String(form.get('cf-turnstile-response') ?? '');
  if (env.TURNSTILE_DISABLED !== 'true' && !(await verifyTurnstile(token, ip, env.TURNSTILE_SECRET))) {
    return json({ error: 'Turnstile check failed.' }, 400);
  }

  const name = String(form.get('name') ?? '').trim();
  const reach = String(form.get('reach') ?? '').trim();
  const ao = String(form.get('ao') ?? '').trim();
  const message = String(form.get('message') ?? '').trim();

  if (!name) return json({ error: 'Name is required.' }, 400);
  if (name.length > 80 || reach.length > 200 || message.length > 1000) {
    return json({ error: 'Field too long.' }, 400);
  }

  await postToSlack(env.SLACK_WEBHOOK_URL, { name, reach, ao, message });
  return json({ ok: true });
};

async function verifyTurnstile(token: string, ip: string, secret: string): Promise<boolean> {
  if (!secret || !token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const data = (await res.json()) as { success: boolean };
  return Boolean(data.success);
}

async function postToSlack(
  webhookUrl: string,
  s: { name: string; reach: string; ao: string; message: string },
): Promise<void> {
  if (!webhookUrl) throw new Error('Slack webhook not configured.');
  const lines = [
    `*New "Join F3 Lawrence" request* :muscle:`,
    `*Name:* ${s.name}`,
    `*Reach them via:* ${s.reach || '—'}`,
    `*Interested AO:* ${s.ao || 'no preference'}`,
    `*Note:* ${s.message || '—'}`,
  ].join('\n');

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: lines }),
  });
  if (!res.ok) throw new Error('Could not deliver your message. Please try again.');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type PagesFunction<E = unknown> = (ctx: {
  request: Request;
  env: E;
  waitUntil: (p: Promise<unknown>) => void;
}) => Promise<Response> | Response;

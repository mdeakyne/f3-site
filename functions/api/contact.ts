// Cloudflare Pages Function: POST /api/contact
//
// "Join F3 Lawrence" form. Posts the request into Slack (#admin) via an
// incoming webhook. Spam is filtered with an invisible honeypot + a submit-too-
// fast timing check, then verified by Cloudflare Turnstile. Secret values live
// in Cloudflare Pages and are never exposed to the client.
//
// Set the secret with:
//   wrangler pages secret put SLACK_WEBHOOK_URL --project-name f3-site
// See docs/slack-webhook-setup.md for how to create the webhook.

interface Env {
  SLACK_WEBHOOK_URL: string;
  TURNSTILE_SECRET_KEY: string;
}

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'join_f3';
const TURNSTILE_TIMEOUT_MS = 10_000;
const TURNSTILE_MAX_TOKEN_LENGTH = 2_048;
const TURNSTILE_HOSTNAMES = new Set(['f3lawrence.com']);

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const form = await request.formData();

  // Silently accept-and-drop obvious bots so they don't retry.
  if (looksLikeBot(form)) return json({ ok: true });

  const name = String(form.get('name') ?? '').trim();
  const reach = String(form.get('reach') ?? '').trim();
  const ao = String(form.get('ao') ?? '').trim();
  const message = String(form.get('message') ?? '').trim();

  if (!name) return json({ error: 'Name is required.' }, 400);
  if (name.length > 80 || reach.length > 200 || message.length > 1000) {
    return json({ error: 'Field too long.' }, 400);
  }

  const token = String(form.get('cf-turnstile-response') ?? '').trim();
  if (!token || token.length > TURNSTILE_MAX_TOKEN_LENGTH) {
    return json({ error: 'Please complete the verification and try again.' }, 400);
  }

  const verification = await verifyTurnstile(token, request, env.TURNSTILE_SECRET_KEY);
  if (verification === 'unavailable') {
    return json({ error: 'Verification is temporarily unavailable. Please try again.' }, 503);
  }
  if (verification === 'invalid') {
    return json({ error: 'Verification failed. Please complete it again and retry.' }, 400);
  }

  await postToSlack(env.SLACK_WEBHOOK_URL, { name, reach, ao, message });
  return json({ ok: true });
};

async function verifyTurnstile(
  token: string,
  request: Request,
  secret: string,
): Promise<'valid' | 'invalid' | 'unavailable'> {
  if (!secret) return 'unavailable';

  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  const remoteIp = request.headers.get('CF-Connecting-IP');
  if (remoteIp) body.set('remoteip', remoteIp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    if (!response.ok) return 'unavailable';

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      return 'unavailable';
    }

    if (!isSiteverifyResponse(result)) return 'unavailable';
    if (!result.success) return 'invalid';
    if (result.action !== TURNSTILE_ACTION) return 'invalid';
    if (!TURNSTILE_HOSTNAMES.has(result.hostname ?? '')) return 'invalid';
    return 'valid';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timeout);
  }
}

function isSiteverifyResponse(value: unknown): value is {
  success: boolean;
  hostname?: string;
  action?: string;
} {
  return typeof value === 'object' && value !== null && typeof (value as { success?: unknown }).success === 'boolean';
}

// Honeypot: a hidden field humans never fill. Timing: a form submitted within
// 2s of load is almost certainly scripted.
function looksLikeBot(form: FormData): boolean {
  if (String(form.get('company') ?? '').trim() !== '') return true;
  const loadedAt = Number(form.get('loaded_at'));
  if (Number.isFinite(loadedAt) && Date.now() - loadedAt < 2000) return true;
  return false;
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

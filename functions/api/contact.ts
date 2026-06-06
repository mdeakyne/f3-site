// Cloudflare Pages Function: POST /api/contact
//
// "Join F3 Lawrence" form. Posts the request into Slack (#admin) via an
// incoming webhook. Spam is filtered with an invisible honeypot + a submit-too-
// fast timing check (no third-party CAPTCHA). The destination webhook URL lives
// in a Cloudflare secret (SLACK_WEBHOOK_URL) and is never exposed to the client.
//
// Set the secret with:
//   wrangler pages secret put SLACK_WEBHOOK_URL --project-name f3-site
// See docs/slack-webhook-setup.md for how to create the webhook.

interface Env {
  SLACK_WEBHOOK_URL: string;
}

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

  await postToSlack(env.SLACK_WEBHOOK_URL, { name, reach, ao, message });
  return json({ ok: true });
};

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

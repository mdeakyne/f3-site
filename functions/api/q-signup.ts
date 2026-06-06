// Cloudflare Pages Function: POST /api/q-signup
//
// Accepts multipart/form-data or URL-encoded form submission from the signup
// page, filters spam with an invisible honeypot + timing check, rate-limits by
// IP hash, inserts into D1, and posts a notification into Slack (#admin) for
// approval via an incoming webhook. Matt promotes approved rows into the vault
// weekly via `nob pull-signups`. The webhook URL lives in a Cloudflare secret
// (SLACK_WEBHOOK_URL); see docs/slack-webhook-setup.md.

interface Env {
  DB: D1Database;
  SLACK_WEBHOOK_URL: string;
}

interface D1Database {
  prepare: (q: string) => D1PreparedStatement;
}
interface D1PreparedStatement {
  bind: (...vals: unknown[]) => D1PreparedStatement;
  run: () => Promise<{ success: boolean; meta: { last_row_id: number } }>;
  first: <T = unknown>() => Promise<T | null>;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const form = await request.formData();

  // Silently accept-and-drop obvious bots so they don't retry.
  if (looksLikeBot(form)) return json({ ok: true });

  const event_date = String(form.get('event_date') ?? '').trim();
  const ao_slug = String(form.get('ao_slug') ?? '').trim();
  const f3_name = String(form.get('f3_name') ?? '').trim();
  const contact = String(form.get('contact') ?? '').trim();
  const notes = String(form.get('notes') ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) return json({ error: 'Invalid date.' }, 400);
  if (!ao_slug || !f3_name) return json({ error: 'Missing required fields.' }, 400);
  if (f3_name.length > 80 || contact.length > 200 || notes.length > 1000) {
    return json({ error: 'Field too long.' }, 400);
  }

  const ip_hash = await sha256(`${ip}:f3-lawrence-v1`);

  // Rate-limit: max 5 submissions per IP in last 24h.
  const count = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM q_signups
       WHERE ip_hash = ?1 AND created_at > datetime('now','-1 day')`,
    )
    .bind(ip_hash)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= 5) return json({ error: 'Too many recent submissions.' }, 429);

  await env.DB
    .prepare(
      `INSERT INTO q_signups (event_date, ao_slug, f3_name, contact, notes, ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(event_date, ao_slug, f3_name, contact || null, notes || null, ip_hash)
    .run();

  ctx.waitUntil(
    postToSlack(env.SLACK_WEBHOOK_URL, {
      event_date,
      ao_slug,
      f3_name,
      contact,
      notes,
    }).catch(() => {}),
  );

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

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function postToSlack(webhookUrl: string, s: {
  event_date: string;
  ao_slug: string;
  f3_name: string;
  contact: string;
  notes: string;
}): Promise<void> {
  if (!webhookUrl) return;
  // NOTE: to @-mention the Q in Slack we'd need their Slack member ID
  // (e.g. <@U012ABC>) — display names can't be tagged via an incoming webhook.
  // See docs/slack-webhook-setup.md for how to add an F3-name → member-ID map.
  const text = [
    `*New Q signup — needs approval* :calendar:`,
    `*Q:* ${s.f3_name}`,
    `*Date:* ${s.event_date}`,
    `*AO:* ${s.ao_slug}`,
    `*Contact:* ${s.contact || '—'}`,
    `*Notes:* ${s.notes || '—'}`,
    `_Promote via_ \`nob pull-signups\``,
  ].join('\n');

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
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

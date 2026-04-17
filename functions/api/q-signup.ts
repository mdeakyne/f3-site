// Cloudflare Pages Function: POST /api/q-signup
//
// Accepts multipart/form-data or URL-encoded form submission from the signup
// page, validates the Turnstile token, rate-limits by IP hash, inserts into
// D1, and sends a notification email via MailChannels. Matt promotes approved
// rows into the vault weekly via `nob pull-signups`.

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET: string;
  NOTIFY_EMAIL: string;
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

  const token = String(form.get('cf-turnstile-response') ?? '');
  if (!(await verifyTurnstile(token, ip, env.TURNSTILE_SECRET))) {
    return json({ error: 'Turnstile check failed.' }, 400);
  }

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
    sendEmail(env.NOTIFY_EMAIL, {
      event_date,
      ao_slug,
      f3_name,
      contact,
      notes,
    }).catch(() => {}),
  );

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

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sendEmail(to: string, s: {
  event_date: string;
  ao_slug: string;
  f3_name: string;
  contact: string;
  notes: string;
}): Promise<void> {
  const body = [
    `New Q signup request for F3 Lawrence:`,
    ``,
    `  Date:    ${s.event_date}`,
    `  AO:      ${s.ao_slug}`,
    `  F3 Name: ${s.f3_name}`,
    `  Contact: ${s.contact || '—'}`,
    `  Notes:   ${s.notes || '—'}`,
    ``,
    `Promote via: nob pull-signups`,
  ].join('\n');

  await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: 'noreply@f3lawrence.com', name: 'F3 Lawrence' },
      subject: `Q signup: ${s.f3_name} — ${s.event_date} (${s.ao_slug})`,
      content: [{ type: 'text/plain', value: body }],
    }),
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

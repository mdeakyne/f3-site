import { PAX_CATALOG } from '../../src/lib/q-catalog.ts';
import { eligiblePax, publicationTime, validSlot } from '../../src/lib/q-dates.ts';
import type { ClaimEnv, ClaimInput } from '../../src/lib/q-types.ts';
import { ClaimRateLimitError, insertClaim } from '../lib/q-store.ts';

type Publication = 'posted' | 'failed' | 'skipped';
type Context = { request: Request; env: ClaimEnv; waitUntil?: (p: Promise<unknown>) => void };
type Dependencies = {
  now?: () => Date;
  fetcher?: typeof fetch;
  publisher?: (env: ClaimEnv, id: number, now: Date) => Promise<Publication>;
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export function createSignupHandler(deps: Dependencies = {}) {
  return async ({ request, env }: Context): Promise<Response> => {
    const now = deps.now?.() ?? new Date();
    let form: FormData;
    try {
      // Bound actual bytes, including requests without Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'Missing form.' }, 400);
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 32768) { await reader.cancel(); return json({ error: 'Form too large.' }, 400); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      form = await new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type') ?? '' }, body: bytes }).formData();
    } catch { return json({ error: 'Invalid form.' }, 400); }
    const field = (name: string) => typeof form.get(name) === 'string' ? String(form.get(name)).trim() : '';
    const loaded = Number(field('loaded_at'));
    if (field('company') || (Number.isFinite(loaded) && now.getTime() - loaded < 2000)) return json({ ok: true });
    const token = field('cf-turnstile-response');
    if (!token || token.length > 2048) return json({ error: 'Please complete verification again.' }, 400);
    if (!env.TURNSTILE_SECRET_KEY) return json({ error: 'Verification is temporarily unavailable.' }, 503);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const body = new FormData(); body.set('secret', env.TURNSTILE_SECRET_KEY); body.set('response', token);
      const ip = request.headers.get('CF-Connecting-IP'); if (ip) body.set('remoteip', ip);
      const res = await (deps.fetcher ?? fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: controller.signal });
      if (!res.ok) return json({ error: 'Verification is temporarily unavailable.' }, 503);
      const result = await res.json() as { success?: boolean; action?: string; hostname?: string };
      if (!result || typeof result.success !== 'boolean') return json({ error: 'Verification is temporarily unavailable.' }, 503);
      if (!result.success || result.action !== 'q_signup' || result.hostname !== 'f3lawrence.com') return json({ error: 'Please complete verification again.' }, 400);
    } catch { return json({ error: 'Verification is temporarily unavailable.' }, 503); }
    finally { clearTimeout(timer); }
    const validatedAt = deps.now?.() ?? new Date();
    const slug = field('q_slug');
    const pax = eligiblePax(PAX_CATALOG, validatedAt).find(pax => pax.slug === slug);
    const input: ClaimInput = { ao_slug: field('ao_slug'), event_date: field('event_date'), q_slug: slug === '__other__' ? null : slug,
      q_name: slug === '__other__' ? field('f3_name_other') : pax?.name ?? '', title: field('title'), description: field('description'), coupon: field('coupon') === 'yes' };
    if (!validSlot(input.ao_slug, input.event_date, validatedAt) || !input.q_name || input.q_name.length > 80 || !input.title || input.title.length > 120 || !input.description || input.description.length > 4000 || !['yes','no'].includes(field('coupon'))) return json({ error: 'Please check the required fields and available workout date.' }, 400);
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${request.headers.get('CF-Connecting-IP') ?? 'unknown'}:f3-lawrence-v1`));
      const ipHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM q_claims WHERE ip_hash = ?1 AND created_at > ?2').bind(ipHash, new Date(validatedAt.getTime() - 86400000).toISOString()).first<{n:number}>();
      if ((count?.n ?? 0) >= 5) return json({ error: 'Too many recent claims. Please try again later.' }, 429);
      const createdAt = deps.now?.() ?? new Date();
      if (!validSlot(input.ao_slug, input.event_date, createdAt) || (input.q_slug !== null && !eligiblePax(PAX_CATALOG, createdAt).some(pax => pax.slug === input.q_slug))) return json({ error: 'Please check the required fields and available workout date.' }, 400);
      const id = await insertClaim(env, input, ipHash, createdAt);
      if (id === null) return json({ error: 'That workout was just claimed. Please choose another date.' }, 409);
      let publication: 'scheduled'|'posted'|'failed' = 'scheduled';
      let pending = false;
      // Cron can scan while verification or the insert is still in flight.
      const publicationNow = deps.now?.() ?? new Date();
      if (publicationTime(input.event_date) <= publicationNow.toISOString()) {
        // A saved claim stays active even when delivery or its status write fails.
        let outcome: Publication | undefined;
        try {
          const publisher = deps.publisher ?? (await import('../lib/q-publisher.ts')).publishClaim;
          outcome = await publisher(env,id,publicationNow);
        } catch { /* Reconcile persisted state before reporting a delivery failure. */ }
        if (outcome === 'posted') publication = 'posted';
        else {
          let status: string | undefined;
          try {
            const row = await env.DB.prepare('SELECT publish_status FROM q_claims WHERE id = ?1').bind(id).first<{publish_status:string}>();
            status = row?.publish_status;
          } catch { /* An unreadable status does not establish failed delivery. */ }
          publication = status === 'posted' ? 'posted' : status === 'failed' ? 'failed' : 'scheduled';
          pending = publication === 'scheduled';
        }
      }
      return json({ ok: true, publication, message: publication === 'failed' ? 'Workout claimed. Slack delivery needs attention. Check Slack before any manual correction. Your claim is saved.' : publication === 'posted' ? 'Workout claimed and pre-blast posted.' : pending ? 'Workout claimed. Your claim is saved; pre-blast publication is pending confirmation. Check Slack before making any changes.' : 'Workout claimed. Your pre-blast is scheduled.' });
    } catch (error) {
      if (error instanceof ClaimRateLimitError) return json({ error: 'Too many recent claims. Please try again later.' }, 429);
      return json({ error: 'Claims are temporarily unavailable. Please try again.' }, 503);
    }
  };
}
export const onRequestPost = createSignupHandler();

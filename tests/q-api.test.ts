import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../functions/api/q-signup.ts';
import type { ClaimEnv } from '../src/lib/q-types.ts';

const now = new Date('2026-11-02T18:00:00Z');
function fixture(options: Record<string, any> = {}) {
  const db = { rows: [] as any[], calls: [] as string[], prepare(sql: string) {
    this.calls.push(sql);
    let values: any[] = [];
    return { bind(...args: any[]) { values = args; return this; },
      async first() {
        if (/SELECT publish_status/.test(sql)) {
          if (options.statusReadError) throw new Error('Status unavailable');
          return options.persistedStatus === null ? null : { publish_status: options.persistedStatus ?? (options.publication === 'failed' ? 'failed' : 'scheduled') };
        }
        options.onCount?.();
        return { n: options.count ?? 0 };
      },
      async all() { options.onScan?.(sql, db.rows); return { success: true, results: db.rows, meta: {} }; },
      async run() {
        if (options.error) throw new Error(options.error);
        await options.beforeInsert?.();
        if (options.insertResult) return options.insertResult;
        db.rows.push(values); await options.onInsert?.(); return { success: true, meta: { last_row_id: 17, changes: 1 }, results: [] };
      } };
  } };
  const env = { DB: db, TURNSTILE_SECRET_KEY: options.secret ?? 'secret', Q_SLACK_WEBHOOKS_JSON: '{}' } as ClaimEnv;
  let calls = 0;
  const fetcher = async () => { calls++; if (options.timeout) throw new Error('timeout'); await options.onVerification?.(); return Response.json(options.verification ?? { success: true, action: 'q_signup', hostname: 'f3lawrence.com' }); };
  let published = 0;
  const handler = (api as any).createSignupHandler?.({ now: () => options.clock?.() ?? options.now ?? now, fetcher, publisher: async (_env: ClaimEnv, _id: number, timestamp: Date) => { published++; options.onPublish?.(timestamp); return options.publication ?? 'posted'; } }) ?? api.onRequestPost;
  async function send(patch: Record<string,string> = {}) {
    const data = new URLSearchParams({ ao_slug: 'beehive', event_date: '2026-11-03', q_slug: '__other__', f3_name_other: '404', title: 'Test', description: 'Workout 💪 :coupon:', coupon: 'yes', 'cf-turnstile-response': 'valid', loaded_at: String((options.now ?? now).getTime() - 5000), ...patch });
    return handler({ env, request: new Request('https://f3lawrence.com/api/q-signup', { method: 'POST', body: data }), waitUntil() {} });
  }
  return { send, db, env, network: () => calls, published: () => published };
}

test('test_turnstile_action_wrong', async () => {
  const f = fixture({ verification: { success: true, action: 'join_f3', hostname: 'f3lawrence.com' } });
  const res = await f.send({ f3_name: '404' }); assert.equal(res.status, 400); assert.equal(f.db.rows.length, 0); assert.equal(f.published(), 0);
});
test('test_unavailable', async () => {
  for (const options of [{ secret: '' }, { timeout: true }]) { const f = fixture(options); assert.equal((await f.send()).status, 503); assert.equal(f.db.rows.length, 0); }
});
test('verification rejects missing token, invalid result and hostname', async () => {
  assert.equal((await fixture().send({ 'cf-turnstile-response': '' })).status, 400);
  assert.equal((await fixture().send({ 'cf-turnstile-response': 'x'.repeat(2049) })).status, 400);
  for (const verification of [{ success: false }, { success: true, action: 'q_signup', hostname: 'evil.com' }]) assert.equal((await fixture({ verification }).send()).status, 400);
});
test('test_duplicate and real database errors', async () => {
  assert.equal((await fixture({ error: 'D1_ERROR: UNIQUE constraint failed: q_claims.ao_slug, q_claims.event_date' }).send()).status, 409);
  assert.equal((await fixture({ error: 'database unavailable' }).send()).status, 503);
});
test('atomic insertion rate rejection ignores a stale row id and preserves other database failures', async () => {
  const f = fixture({ insertResult: { success: true, meta: { changes: 0, last_row_id: 17 }, results: [] } });
  const response = await f.send();
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /Too many recent claims/);
  assert.equal(f.published(), 0);
  for (const insertResult of [
    { success: false, meta: { changes: 0, last_row_id: 17 }, results: [] },
    { success: true, meta: { last_row_id: 17 }, results: [] },
  ]) assert.equal((await fixture({ insertResult }).send()).status, 503);
});
test('test_time_channel_spoof and canonical successful claim', async () => {
  const f = fixture(); const res = await f.send({ time: 'midnight', channelId: 'evil' });
  assert.equal(res.status, 200); assert.equal((await res.json()).publication, 'scheduled'); assert.equal(f.db.rows.length, 1);
  assert.ok(!JSON.stringify(f.db.rows).includes('evil')); assert.ok(!f.db.calls.some(sql => /q_signups\b/.test(sql)));
});
test('bounds, required fields, schedule and rate limit', async () => {
  for (const patch of [{ title: 'x'.repeat(121) }, { description: 'x'.repeat(4001) }, { f3_name_other: '' }, { coupon: '' }, { ao_slug: 'caffeine' }, { event_date: '2026-02-30' }, { q_slug: 'unknown' }]) assert.equal((await fixture().send(patch)).status, 400);
  assert.equal((await fixture({ count: 5 }).send()).status, 429);
});
test('bots silently dropped without network or insert', async () => {
  for (const patch of [{ company: 'spam' }, { loaded_at: String(now.getTime() - 1000) }]) { const f = fixture(); assert.equal((await f.send(patch)).status, 200); assert.equal(f.network(), 0); assert.equal(f.db.rows.length, 0); }
});
test('late claims use shared publisher and remain claimed on failure', async () => {
  for (const publication of ['posted','failed']) { const f = fixture({ now: new Date('2026-11-02T22:01:00Z'), publication }); const res = await f.send(); assert.equal(res.status, 200); assert.equal((await res.json()).publication, publication); assert.equal(f.published(), 1); assert.equal(f.db.rows.length, 1); }
});

test('claim inserted after the 16:00 cron scan publishes using the post-insert clock', async () => {
  const { runScheduled } = await import('../functions/lib/q-publisher.ts');
  let clock = new Date('2026-11-02T21:59:59Z');
  let cronScans = 0;
  const f = fixture({ clock: () => clock, now: clock, async beforeInsert() {
    // The real scheduled scan runs before this insert commits.
    clock = new Date('2026-11-02T22:00:00Z');
    await runScheduled(f.env, clock);
  }, onScan(sql: string, rows: unknown[]) {
    assert.match(sql, /SELECT id FROM q_claims/);
    assert.equal(rows.length, 0);
    cronScans++;
  }, onInsert() {
    clock = new Date('2026-11-02T22:00:01Z');
  }, onPublish(timestamp: Date) { assert.equal(timestamp.toISOString(), clock.toISOString()); } });
  const res = await f.send();
  assert.equal(cronScans, 1);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).publication, 'posted');
  assert.equal(f.published(), 1);
});

test('claim that becomes today during verification or rate checking is rejected before insert', async () => {
  for (const phase of ['onVerification', 'onCount']) {
    let clock = new Date('2026-11-03T05:59:59Z');
    const f = fixture({ clock: () => clock, now: clock, [phase]() { clock = new Date('2026-11-03T06:00:01Z'); } });
    assert.equal((await f.send()).status, 400, phase);
    assert.equal(f.db.rows.length, 0, phase);
    assert.equal(f.published(), 0, phase);
  }
});

test('cron-owned publication reconciles persisted status without urging a duplicate post', async () => {
  for (const persistedStatus of ['publishing', 'posted', 'scheduled', 'failed', 'unexpected', null]) {
    const f = fixture({ now: new Date('2026-11-02T22:01:00Z'), publication: 'skipped', persistedStatus });
    const res = await f.send();
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['message', 'ok', 'publication']);
    assert.equal(body.publication, persistedStatus === 'posted' ? 'posted' : persistedStatus === 'failed' ? 'failed' : 'scheduled', String(persistedStatus));
    assert.equal(body.ok, true);
    assert.doesNotMatch(body.message, /arrange the pre-blast|post (?:it|again|another)/i);
    if (persistedStatus !== 'failed') assert.doesNotMatch(body.message, /delivery (?:failed|needs attention)/i);
    assert.equal(f.published(), 1);
    assert.equal(f.db.rows.length, 1);
  }
});

test('uncertain persisted publication status preserves saved claim without reporting failure', async () => {
  const f = fixture({ now: new Date('2026-11-02T22:01:00Z'), publication: 'skipped', statusReadError: true });
  const res = await f.send(); const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.publication, 'scheduled');
  assert.match(body.message, /saved/i);
  assert.doesNotMatch(body.message, /delivery (?:failed|needs attention)|arrange the pre-blast|post again/i);
});

test('confirmed publisher failure asks for review before any manual correction', async () => {
  const f = fixture({ now: new Date('2026-11-02T22:01:00Z'), publication: 'failed' });
  const res = await f.send(); const body = await res.json();
  assert.equal(body.publication, 'failed');
  assert.match(body.message, /check Slack/i);
  assert.doesNotMatch(body.message, /arrange the pre-blast|post again/i);
  assert.equal(f.db.rows.length, 1);
});

test('committed posted status wins over a publisher failure caused by lost acknowledgement', async () => {
  const f = fixture({ now: new Date('2026-11-02T22:01:00Z'), publication: 'failed', persistedStatus: 'posted' });
  const res = await f.send(); const body = await res.json();
  assert.equal(body.publication, 'posted');
  assert.match(body.message, /pre-blast posted/i);
});
test('test_public_fields', async () => {
  const { listClaims } = await import('../functions/lib/q-store.ts');
  const f = fixture(); f.db.rows.push({ ao_slug: 'beehive', event_date: '2026-11-03', q_name: '404', title: 'Test', description: 'secret', ip_hash: 'hash', publish_status: 'failed', time: 'evil' });
  assert.deepEqual(await listClaims(f.env, now), [{ ao_slug: 'beehive', ao_name: 'Beehive', event_date: '2026-11-03', time: '5:30 AM', q_name: '404', title: 'Test' }]);
  const { onRequestGet } = await import('../functions/api/q-signups.ts');
  const res = await onRequestGet({ env: f.env }); assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('verification timeout aborts the actual Siteverify request before insert', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const handler = api.createSignupHandler({ now: () => now, fetcher: (async (_url, init) => {
    assert.equal(String(_url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(init?.method, 'POST');
    const body = init?.body as FormData;
    assert.equal(body.get('secret'), 'secret');
    assert.equal(body.get('response'), 'valid');
    assert.equal(body.get('remoteip'), '203.0.113.7');
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      begin();
    });
  }) as typeof fetch });
  const pending = handler({ env: f.env, request: new Request('https://f3lawrence.com/api/q-signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.7' },
    body: new URLSearchParams({ 'cf-turnstile-response': 'valid', loaded_at: String(now.getTime() - 5000) }),
  }) });
  await started;
  t.mock.timers.tick(10000);
  assert.equal((await pending).status, 503);
  assert.equal(f.db.calls.length, 0);
});

test('streamed body without Content-Length is bounded before verification', async () => {
  const f = fixture(); let network = 0;
  const handler = api.createSignupHandler({ now: () => now, fetcher: (async () => { network++; return Response.json({ success: true }); }) as typeof fetch });
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('description=' + 'x'.repeat(32769))); controller.close();
  } });
  const request = new Request('https://f3lawrence.com/api/q-signup', {
    method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  } as RequestInit);
  assert.equal(request.headers.get('content-length'), null);
  assert.equal((await handler({ env: f.env, request })).status, 400);
  assert.equal(network, 0);
  assert.equal(f.db.calls.length, 0);
});

test('malformed verification response never inserts a claim', async () => {
  const f = fixture();
  const handler = api.createSignupHandler({ now: () => now, fetcher: (async () => new Response('{bad', { headers: { 'content-type': 'application/json' } })) as typeof fetch });
  const request = new Request('https://f3lawrence.com/api/q-signup', { method: 'POST', body: new URLSearchParams({ 'cf-turnstile-response': 'valid' }) });
  assert.equal((await handler({ env: f.env, request })).status, 503);
  assert.equal(f.db.calls.length, 0);
});

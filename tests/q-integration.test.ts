import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSignupHandler } from '../functions/api/q-signup.ts';
import { onRequestGet } from '../functions/api/q-signups.ts';
import worker from '../workers/q-publisher.ts';
import { AO_CATALOG } from '../src/lib/q-catalog.ts';
import { claimWindow, publicationTime, validSlot } from '../src/lib/q-dates.ts';
import type { ClaimEnv, D1Database } from '../src/lib/q-types.ts';

const execute = promisify(execFile);
// Real Wrangler/workerd D1; only Siteverify and Slack are faked. No remote flag,
// deployment, credentials, or production state is used. SUPERLITE_REAL=1 uses
// these same production imports, rather than a separate approximation.
async function fixture(concurrentCounts = 0) {
  const dir = await mkdtemp(join(tmpdir(), 'q-d1-integration-'));
  let serial = 0;
  const errors: string[] = [];
  async function queryRaw(sql: string) {
    const file = join(dir, `query-${serial++}.sql`);
    await writeFile(file, sql);
    let stdout: string;
    try { ({ stdout } = await execute(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'f3-signups', '--local', '--persist-to', join(dir, 'state'), '--json', '--file', file], {
      cwd: process.cwd(), env: { ...process.env, HOME: dir, WRANGLER_LOG_PATH: join(dir, 'wrangler.log'), WRANGLER_SEND_METRICS: 'false' }, timeout: 45000, maxBuffer: 1024 * 1024,
    })); } catch (error) {
      // Wrangler emits D1 errors in JSON stdout when --json is selected.
      const failed = error as Error & { stdout?: string; stderr?: string };
      const diagnostic = new Error([failed.message, failed.stdout, failed.stderr].filter(Boolean).join("\n"));
      errors.push(String(diagnostic)); throw diagnostic;
    }
    return JSON.parse(stdout);
  }
  // D1 serializes operations on one database. Separate CLI workerd processes
  // cannot open its persisted SQLite concurrently, so queue runtime entry, not
  // handlers: both POSTs/Workers still race through the real conditional SQL.
  let pending: Promise<unknown> = Promise.resolve();
  const query = (sql: string) => {
    const result = pending.then(() => queryRaw(sql));
    pending = result.catch(() => {}); return result;
  };
  const literal = (v: unknown) => v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
  let counted = 0;
  let releaseCounts!: () => void;
  const countsReady = new Promise<void>(resolve => { releaseCounts = resolve; });
  const DB: D1Database = { prepare(sql) {
    let args: unknown[] = [];
    const statement = { bind(...values: unknown[]) { args = values; return statement; },
      async all<T>() { return (await query(sql.replace(/\?(\d+)/g, (_, n) => literal(args[Number(n) - 1]))))[0]; },
      async first<T>() {
        const row = (await statement.all<T>()).results[0] ?? null;
        if (concurrentCounts && /SELECT COUNT\(\*\).*ip_hash/.test(sql)) {
          if (++counted === concurrentCounts) releaseCounts();
          // Every preliminary count reads real D1 before any POST can insert.
          await countsReady;
        }
        return row;
      },
      async run<T>() {
        const sqlBound = sql.replace(/\?(\d+)/g, (_, n) => literal(args[Number(n) - 1]));
        const results = await query(`${sqlBound}; SELECT changes() AS changes,last_insert_rowid() AS last_row_id`);
        return { ...results[0], meta: results.at(-1).results[0] };
      },
    }; return statement;
  } };
  const archive = await readFile('migrations/0001_q_signups.sql', 'utf8');
  await query(`${archive}\nINSERT INTO q_signups(event_date,ao_slug,f3_name,ip_hash) VALUES('2020-01-01','beehive','Archived','old');`);
  const before = (await query('SELECT * FROM q_signups'))[0].results;
  await query(await readFile('migrations/0002_q_claims.sql', 'utf8'));
  return { env: { DB, TURNSTILE_SECRET_KEY: 'test-turnstile-private', Q_SLACK_WEBHOOKS_JSON: JSON.stringify({
      beehive: 'https://hooks.slack.com/services/T000/B000/beehive-private', 'ad-astra': 'https://hooks.slack.com/services/T000/B000/adastra-private', caffeine: 'https://hooks.slack.com/services/T000/B000/caffeine-private',
    }), Q_SLACK_MEMBERS_JSON: '{"private":"U0123456789"}' } as ClaimEnv,
    query, before, errors, close: () => rm(dir, { recursive: true, force: true }) };
}

// The configuration requirement deliberately went red before adding test:q and
// replacing the retired webhook-only deployment comments.
test('Q command and Pages/Worker configuration form one rollout', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.match(pkg.scripts['test:q'] ?? '', /q-\*/);
  const pages = await readFile('wrangler.toml', 'utf8');
  const scheduled = await readFile('workers/wrangler.toml', 'utf8');
  assert.equal(pages.match(/database_id = "([^"]+)"/)?.[1], scheduled.match(/database_id = "([^"]+)"/)?.[1]);
  assert.match(pages, /TURNSTILE_SECRET_KEY/); assert.match(pages, /Q_SLACK_WEBHOOKS_JSON/);
  assert.doesNotMatch(pages, /no CAPTCHA|only need SLACK_WEBHOOK_URL/);
  assert.match(scheduled, /0 15,16 \* \* \*/);
});

test('deployment publishes Pages and the scheduled Worker from one revision', async () => {
  const workflow = await readFile('.github/workflows/deploy.yml', 'utf8');
  assert.match(workflow, /pages deploy \.\/dist --project-name=f3-site --branch=main/);
  assert.match(workflow, /deploy --config workers\/wrangler\.toml/);
  assert.doesNotMatch(workflow, /d1 migrations apply[^\n]*--remote/);
});

test('real D1: concurrent protected POST → live GET → overlapping scheduled Workers', { timeout: 180000 }, async (t) => {
  const f = await fixture(); t.after(f.close);
  const current = new Date();
  let event = claimWindow(current).first;
  while (!validSlot('beehive', event, current)) event = new Date(Date.parse(`${event}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const due = new Date(publicationTime(event));
  const now = new Date(due.getTime() - 3600000);
  const siteverify = async () => Response.json({ success: true, action: 'q_signup', hostname: 'f3lawrence.com' });
  const handler = createSignupHandler({ now: () => now, fetcher: siteverify });
  let notes = 0;
  let preblasts = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(String(url), 'https://hooks.slack.com/services/T000/B000/beehive-private');
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.channel, undefined);
    if (payload.text.includes('Q signed up:')) {
      notes++;
      assert.match(payload.text, /O'Brien/);
      assert.doesNotMatch(payload.text, /<!channel>/);
    } else {
      preblasts++;
      assert.match(payload.text, /Integration 💪/); assert.match(payload.text, /private description/);
    }
    return new Response('ok');
  });
  const send = () => handler({ env: f.env, request: new Request('https://f3lawrence.com/api/q-signup', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.8' }, body: new URLSearchParams({
    ao_slug: 'beehive', event_date: event, q_slug: '__other__', f3_name_other: "O'Brien", title: 'Integration 💪', description: 'private description', coupon: 'yes',
    'cf-turnstile-response': 'fake-token', loaded_at: String(now.getTime() - 5000),
  }) }) });
  const responses = await Promise.all([send(), send()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409], JSON.stringify(f.errors));
  assert.equal((await (responses.find(r => r.status === 200)!).json()).publication, 'scheduled');
  assert.equal(notes, 0);
  assert.equal(preblasts, 0);
  assert.equal((await f.query('SELECT COUNT(*) AS n FROM q_claims'))[0].results[0].n, 1);
  const live = await onRequestGet({ env: f.env });
  assert.equal(live.headers.get('cache-control'), 'no-store');
  const body = await live.json();
  assert.deepEqual(body.claims, [{ ao_slug: 'beehive', ao_name: 'Beehive', event_date: event, time: '5:30 AM', q_name: "O'Brien", title: 'Integration 💪' }]);
  assert.doesNotMatch(JSON.stringify(body), /description|ip_hash|publish_|scheduled_for|private|channelId/);
  const invoke = () => { let work!: Promise<unknown>; worker.scheduled({ scheduledTime: due.getTime() }, f.env, { waitUntil(p) { work = p; } }); return work; };
  await Promise.all([invoke(), invoke()]); await invoke();
  assert.equal(notes, 0);
  assert.equal(preblasts, 1);
  const row = (await f.query('SELECT publish_status,published_at FROM q_claims'))[0].results[0];
  assert.equal(row.publish_status, 'posted'); assert.equal(row.published_at, due.toISOString());
  assert.deepEqual((await f.query('SELECT * FROM q_signups'))[0].results, f.before);
});

test('real D1: six concurrent distinct protected claims atomically enforce five per IP', { timeout: 180000 }, async (t) => {
  const f = await fixture(6); t.after(f.close);
  const now = new Date('2026-11-02T14:00:00Z');
  const slots: { ao_slug: string; event_date: string }[] = [];
  for (let day = 1; slots.length < 6; day++) {
    const event_date = new Date(now.getTime() + day * 86400000).toISOString().slice(0, 10);
    for (const ao of AO_CATALOG) {
      if (validSlot(ao.slug, event_date, now)) slots.push({ ao_slug: ao.slug, event_date });
      if (slots.length === 6) break;
    }
  }
  const handler = createSignupHandler({ now: () => now,
    fetcher: async () => Response.json({ success: true, action: 'q_signup', hostname: 'f3lawrence.com' }),
    notePublisher: async () => 'posted',
  });
  const responses = await Promise.all(slots.map(slot => handler({ env: f.env, request: new Request('https://f3lawrence.com/api/q-signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.10' }, body: new URLSearchParams({ ...slot,
      q_slug: '__other__', f3_name_other: 'Concurrent', title: 'Rate regression', description: 'Real D1 guard', coupon: 'no',
      'cf-turnstile-response': 'fake-token', loaded_at: String(now.getTime() - 5000),
    }),
  }) })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 200, 200, 200, 429], JSON.stringify(f.errors));
  assert.equal((await f.query('SELECT COUNT(*) AS n FROM q_claims'))[0].results[0].n, 5);
  for (const response of responses) {
    const body = await response.json();
    if (response.status === 200) assert.equal(body.publication, 'scheduled');
    else assert.match(body.error, /Too many recent claims/);
  }
  // Exactly 24 hours old expires; the insertion SQL must share the existing > cutoff.
  await f.query(`UPDATE q_claims SET created_at = '${new Date(now.getTime() - 86400000).toISOString()}'`);
  const { insertClaim } = await import('../functions/lib/q-store.ts');
  const ipHash = (await f.query('SELECT ip_hash FROM q_claims LIMIT 1'))[0].results[0].ip_hash;
  const remaining = slots.find(slot => !responses[slots.indexOf(slot)].ok)!;
  assert.equal(typeof await insertClaim(f.env, { ...remaining, q_slug: null, q_name: 'Expired', title: 'New claim', description: 'Window expired', coupon: false }, ipHash, now), 'number');
});

async function files(dir: string): Promise<string[]> {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))).flat();
}

function privacySource(path: string, raw: string): string {
  if (!/\/backblasts\/[^/]+\/index\.html$/.test(path)) return raw;
  // Historical posts intentionally link to Slack. Exempt only those href
  // values, preserving all script bodies, other attributes and page content.
  return raw.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<[^>]+>/gi, tag =>
    /^<script\b/i.test(tag) ? tag : tag.replace(/(\s)href\s*=\s*(["'])https:\/\/f3lawrence\.slack\.com\/archives\/C[A-Z0-9]+(?:\/p\d+)?(?:\?[^"']*)?\2/gi, '$1href=""'));
}

test('archive permalink exception preserves executable text and all non-link channel data', () => {
  const channel = AO_CATALOG[0].channelId;
  const link = `<a href="https://f3lawrence.slack.com/archives/${channel}/p123">Slack</a>`;
  const archive = 'dist/backblasts/2025-01-01-history/index.html';
  assert.ok(!privacySource(archive, link).includes(channel));
  for (const path of ['dist/signup/index.html', 'dist/calendar/index.html', 'dist/q-checklist/index.html', 'dist/first-q/index.html', 'dist/_astro/app.js']) {
    assert.equal(privacySource(path, link), link);
  }
  for (const raw of [`<script>const link = '${link}'</script>`, `<div data-channel="${channel}">content</div>`, `<p>${channel}</p>`, `<a href="https://other.example/${channel}">Other</a>`]) {
    assert.ok(privacySource(archive, raw).includes(channel));
  }
});

test('actual emitted public HTML and JS omit all server channel/member maps and secrets', async () => {
  const emitted = (await files('dist')).filter(path => /\.(html|js)$/.test(path));
  assert.ok(emitted.some(path => path.endsWith('/signup/index.html')), 'run npm run build before integration tests');
  assert.ok(emitted.some(path => path.includes('/_astro/') && path.endsWith('.js')));
  for (const path of emitted) {
    const raw = await readFile(path, 'utf8');
    const source = privacySource(path, raw);
    for (const ao of AO_CATALOG) assert.ok(!source.includes(ao.channelId), `channel leaked in ${path}`);
    assert.doesNotMatch(raw, /Q_SLACK_MEMBERS_JSON|Q_SLACK_WEBHOOKS_JSON|TURNSTILE_SECRET_KEY|beehive-private|test-turnstile-private/);
  }
});

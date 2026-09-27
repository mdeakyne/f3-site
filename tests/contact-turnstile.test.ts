import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { onRequestPost } from '../functions/api/contact.ts';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SLACK_URL = 'https://hooks.example.test/contact';

type FetchCall = { url: string; init?: RequestInit };

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function validFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: 'Test PAX',
    reach: 'test@example.com',
    ao: 'Beehive',
    message: 'Synthetic test message',
    company: '',
    loaded_at: String(Date.now() - 5_000),
    'cf-turnstile-response': 'valid-token',
    ...overrides,
  };
}

async function invoke(
  fields: Record<string, string>,
  options: {
    secret?: string;
    siteverify?: unknown;
    siteverifyFailure?: Error;
  } = {},
) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });

    if (url === SITEVERIFY_URL) {
      if (options.siteverifyFailure) throw options.siteverifyFailure;
      if (options.siteverify instanceof Response) return options.siteverify;
      return Response.json(
        options.siteverify ?? {
          success: true,
          hostname: 'f3lawrence.com',
          action: 'join_f3',
          challenge_ts: new Date().toISOString(),
          'error-codes': [],
        },
      );
    }

    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const request = new Request('https://f3lawrence.com/api/contact', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.10' },
    body: form,
  });

  const response = await onRequestPost({
    request,
    env: {
      SLACK_WEBHOOK_URL: SLACK_URL,
      TURNSTILE_SECRET_KEY: options.secret ?? 'test-secret',
    },
    waitUntil: () => {},
  });

  return {
    response,
    body: (await response.json()) as { ok?: boolean; error?: string },
    siteverifyCalls: calls.filter((call) => call.url === SITEVERIFY_URL),
    slackCalls: calls.filter((call) => call.url === SLACK_URL),
  };
}

for (const [name, token] of [
  ['missing token', undefined],
  ['empty token', ''],
  ['oversized token', 'x'.repeat(2_049)],
] as const) {
  test(`${name} is rejected before Slack delivery`, async () => {
    const fields = validFields();
    if (token === undefined) delete fields['cf-turnstile-response'];
    else fields['cf-turnstile-response'] = token;

    const result = await invoke(fields);

    assert.equal(result.response.status, 400);
    assert.equal(typeof result.body.error, 'string');
    assert.equal(result.slackCalls.length, 0);
  });
}

for (const [name, siteverify] of [
  ['unsuccessful verification', { success: false, 'error-codes': ['invalid-input-response'] }],
  ['expired or replayed token', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
  ['wrong hostname', { success: true, hostname: 'f3-site.pages.dev', action: 'join_f3' }],
  ['wrong action', { success: true, hostname: 'f3lawrence.com', action: 'other_form' }],
] as const) {
  test(`${name} is rejected before Slack delivery`, async () => {
    const result = await invoke(validFields(), { siteverify });

    assert.equal(result.response.status, 400);
    assert.equal(typeof result.body.error, 'string');
    assert.equal(result.siteverifyCalls.length, 1);
    assert.equal(result.slackCalls.length, 0);
  });
}

test('missing Turnstile configuration fails closed before any network request', async () => {
  const result = await invoke(validFields(), { secret: '' });

  assert.equal(result.response.status, 503);
  assert.equal(typeof result.body.error, 'string');
  assert.equal(result.siteverifyCalls.length, 0);
  assert.equal(result.slackCalls.length, 0);
});

test('Siteverify network failure is retryable and never reaches Slack', async () => {
  const result = await invoke(validFields(), { siteverifyFailure: new Error('network down') });

  assert.equal(result.response.status, 503);
  assert.equal(typeof result.body.error, 'string');
  assert.equal(result.siteverifyCalls.length, 1);
  assert.equal(result.slackCalls.length, 0);
});

test('malformed Siteverify response is retryable and never reaches Slack', async () => {
  const result = await invoke(validFields(), {
    siteverify: new Response('not json', { status: 200 }),
  });

  assert.equal(result.response.status, 503);
  assert.equal(typeof result.body.error, 'string');
  assert.equal(result.siteverifyCalls.length, 1);
  assert.equal(result.slackCalls.length, 0);
});

test('valid verification posts to Siteverify with the trusted IP, then Slack exactly once', async () => {
  const result = await invoke(validFields());

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.siteverifyCalls.length, 1);
  assert.equal(result.slackCalls.length, 1);

  const verificationBody = result.siteverifyCalls[0].init?.body;
  assert.ok(verificationBody instanceof FormData);
  assert.equal(verificationBody.get('secret'), 'test-secret');
  assert.equal(verificationBody.get('response'), 'valid-token');
  assert.equal(verificationBody.get('remoteip'), '203.0.113.10');
});

test('filled honeypot is accepted and dropped before Turnstile or Slack', async () => {
  const result = await invoke(validFields({ company: 'spam incorporated' }));

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.siteverifyCalls.length, 0);
  assert.equal(result.slackCalls.length, 0);
});

test('invalid contact fields are rejected before Turnstile or Slack', async () => {
  const result = await invoke(validFields({ name: '' }));

  assert.equal(result.response.status, 400);
  assert.equal(result.siteverifyCalls.length, 0);
  assert.equal(result.slackCalls.length, 0);
});

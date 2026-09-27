import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createContactFormController,
  selectTurnstileSiteKey,
} from '../src/lib/contact-form-controller.ts';

type Status = { kind: string; message: string };

function harness(send: (data: FormData) => Promise<{ ok: boolean; error?: string }>) {
  const disabled: boolean[] = [];
  const formStatuses: Status[] = [];
  const challengeStatuses: Status[] = [];
  const submitted: FormData[] = [];
  let formResets = 0;
  let loadedAtRefreshes = 0;
  let widgetResets = 0;
  const fields = { name: 'Test PAX', reach: 'test@example.com' };

  const controller = createContactFormController({
    makeFormData: () => {
      const data = new FormData();
      for (const [key, value] of Object.entries(fields)) data.set(key, value);
      return data;
    },
    send: async (data) => {
      submitted.push(data);
      return send(data);
    },
    resetForm: () => {
      formResets += 1;
      fields.name = '';
      fields.reach = '';
    },
    refreshLoadedAt: () => {
      loadedAtRefreshes += 1;
    },
    resetWidget: () => {
      widgetResets += 1;
    },
    setSubmitDisabled: (value) => disabled.push(value),
    setFormStatus: (status) => formStatuses.push(status),
    setChallengeStatus: (status) => challengeStatuses.push(status),
  });

  return {
    controller,
    disabled,
    formStatuses,
    challengeStatuses,
    submitted,
    fields,
    counts: () => ({ formResets, loadedAtRefreshes, widgetResets }),
  };
}

test('successful submission includes the token, clears fields, and requires a fresh challenge', async () => {
  const h = harness(async () => ({ ok: true }));

  h.controller.challengeReady('token-one');
  await h.controller.submit();

  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].get('cf-turnstile-response'), 'token-one');
  assert.deepEqual(h.counts(), { formResets: 1, loadedAtRefreshes: 1, widgetResets: 1 });
  assert.equal(h.formStatuses.at(-1)?.kind, 'success');
  assert.equal(h.disabled.at(-1), true);
});

test('backend rejection preserves fields and resets only the consumed challenge', async () => {
  const h = harness(async () => ({ ok: false, error: 'Verification failed.' }));
  h.controller.challengeReady('rejected-token');

  await h.controller.submit();

  assert.equal(h.fields.name, 'Test PAX');
  assert.deepEqual(h.counts(), { formResets: 0, loadedAtRefreshes: 0, widgetResets: 1 });
  assert.equal(h.formStatuses.at(-1)?.kind, 'error');
  assert.equal(h.disabled.at(-1), true);
});

test('expiration and challenge error clear readiness and announce the problem', () => {
  const h = harness(async () => ({ ok: true }));

  h.controller.challengeReady('short-lived-token');
  h.controller.challengeExpired();
  assert.equal(h.disabled.at(-1), true);
  assert.equal(h.challengeStatuses.at(-1)?.kind, 'error');

  h.controller.challengeReady('replacement-token');
  h.controller.challengeError();
  assert.equal(h.disabled.at(-1), true);
  assert.equal(h.challengeStatuses.at(-1)?.kind, 'error');
});

test('double submit starts only one request', async () => {
  let release!: (value: { ok: boolean }) => void;
  const pending = new Promise<{ ok: boolean }>((resolve) => {
    release = resolve;
  });
  let sends = 0;
  const h = harness(async () => {
    sends += 1;
    return pending;
  });
  h.controller.challengeReady('single-use-token');

  const first = h.controller.submit();
  const second = h.controller.submit();
  assert.equal(sends, 1);
  release({ ok: true });
  await Promise.all([first, second]);

  assert.equal(sends, 1);
});

test('service failure preserves fields and allows retry after a fresh challenge', async () => {
  let attempt = 0;
  const h = harness(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('Service unavailable.');
    return { ok: true };
  });

  h.controller.challengeReady('first-token');
  await h.controller.submit();
  assert.equal(h.fields.name, 'Test PAX');
  assert.equal(h.formStatuses.at(-1)?.kind, 'error');

  h.controller.challengeReady('fresh-token');
  await h.controller.submit();
  assert.equal(attempt, 2);
  assert.equal(h.submitted[1].get('name'), 'Test PAX');
  assert.equal(h.submitted[1].get('cf-turnstile-response'), 'fresh-token');
  assert.equal(h.formStatuses.at(-1)?.kind, 'success');
});

test('script load failure leaves submission disabled with an accessible error state', () => {
  const h = harness(async () => ({ ok: true }));

  h.controller.scriptFailed();

  assert.equal(h.disabled.at(-1), true);
  assert.equal(h.challengeStatuses.at(-1)?.kind, 'error');
  assert.notEqual(h.challengeStatuses.at(-1)?.message, '');
});

test('the Turnstile test key is limited to local development hosts', () => {
  const productionKey = 'production-key';
  const testKey = 'test-key';

  assert.equal(selectTurnstileSiteKey('localhost', productionKey, testKey), testKey);
  assert.equal(selectTurnstileSiteKey('127.0.0.1', productionKey, testKey), testKey);
  assert.equal(selectTurnstileSiteKey('f3lawrence.com', productionKey, testKey), productionKey);
  assert.equal(
    selectTurnstileSiteKey('preview.f3-site.pages.dev', productionKey, testKey),
    productionKey,
  );
});

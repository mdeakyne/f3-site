import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initQForm } from '../src/lib/q-form-controller.ts';
import { initQCalendar } from '../src/lib/q-calendar-controller.ts';

execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });

function page(path: string) {
  return readFileSync(new URL(`../dist/${path}/index.html`, import.meta.url), 'utf8');
}

const now = new Date('2026-11-02T18:00:00Z');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const emptyClaims = (async (url: string, options?: RequestInit) => {
  assert.equal(url, '/api/q-signups');
  assert.equal(options?.cache, 'no-store');
  return new Response(JSON.stringify({ claims: [] }));
}) as typeof fetch;

test('publishes Caffeine location details and an AO-specific RSVP link', () => {
  const html = page('locations');

  assert.match(html, /Caffeine/);
  assert.match(html, /Saturday\s+at 6:00 AM/);
  assert.match(html, /South parking lot of West Middle School/);
  assert.match(html, /Ruck Workout/);
  assert.match(html, /38\.964925(?:%2C|,)-95\.269030/);
  assert.match(html, /\/contact\/\?ao=Caffeine/);
});

test('offers Caffeine in RSVP and loads its Saturday signup choices from live availability', async () => {
  const contact = page('contact');
  const signup = page('signup');

  assert.match(contact, /<option value="Caffeine">Caffeine<\/option>/);
  assert.match(signup, /<option value="caffeine">Caffeine<\/option>/);
  const dom = new JSDOM(signup, { url: 'http://localhost/signup/?ao=caffeine&date=2026-11-07' });
  try {
    const { document } = dom.window;
    const date = document.querySelector<HTMLSelectElement>('[name="event_date"]')!;
    assert.equal(date.disabled, true);
    assert.equal(date.querySelector('option[value="2026-11-07"]'), null);
    let action = '';
    (dom.window as unknown as { turnstile: unknown }).turnstile = {
      render: (_element: HTMLElement, options: { action: string; callback: (token: string) => void }) => {
        action = options.action;
        options.callback('test-verification-token');
        return 'caffeine-test';
      },
      reset: () => {},
    };
    initQForm(document, emptyClaims, now);
    await settle();
    assert.equal(action, 'q_signup');
    assert.equal(document.querySelector<HTMLSelectElement>('[name="ao_slug"]')!.value, 'caffeine');
    assert.equal(date.disabled, false);
    assert.equal(date.value, '2026-11-07');
    assert.deepEqual(Array.from(date.options, option => option.value).filter(Boolean), [
      '2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28',
      '2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26', '2027-01-02',
    ]);
    const time = document.querySelector<HTMLInputElement>('[name="time"]')!;
    assert.equal(time.readOnly, true);
    assert.equal(time.value, '6:00 AM');
  } finally {
    dom.window.close();
  }
});

test('lists Caffeine Saturdays and claim links only after confirming live calendar availability', async () => {
  const html = page('calendar');
  const dom = new JSDOM(html, { url: 'http://localhost/calendar/' });
  try {
    const { document } = dom.window;
    const calendar = document.getElementById('q-calendar')!;
    assert.doesNotMatch(calendar.textContent!, /OPEN/);
    assert.equal(calendar.querySelector('a'), null);
    initQCalendar(document, emptyClaims, now);
    await settle();
    const rows = Array.from(calendar.querySelectorAll('li')).filter(row => row.textContent!.includes('Caffeine'));
    assert.equal(rows.length, 9);
    assert.match(rows[0].textContent!, /2026-11-07 · 6:00 AM · Caffeine · OPEN/);
    assert.match(rows.at(-1)!.textContent!, /2027-01-02/);
    for (const row of rows) {
      assert.match(row.textContent!, /6:00 AM/);
      const link = new URL(row.querySelector('a')!.href);
      assert.equal(link.pathname, '/signup/');
      assert.equal(link.searchParams.get('ao'), 'caffeine');
      const date = link.searchParams.get('date')!;
      assert.equal(new Date(`${date}T12:00:00Z`).getUTCDay(), 6);
      assert.match(row.textContent!, new RegExp(date));
    }
  } finally {
    dom.window.close();
  }
});

test('includes Caffeine in first-Q guidance and generated site history data', () => {
  const firstQ = page('first-q');
  const data = JSON.parse(readFileSync(new URL('../content/data.json', import.meta.url), 'utf8'));

  assert.match(firstQ, /Caffeine \(Sat\).*6:00 AM/);
  assert.equal(data.counts.aos, 3);
  assert.deepEqual(
    data.aos.find((ao: { slug: string }) => ao.slug === 'caffeine'),
    { slug: 'caffeine', name: 'Caffeine' },
  );
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });

function page(path: string) {
  return readFileSync(new URL(`../dist/${path}/index.html`, import.meta.url), 'utf8');
}

test('publishes Caffeine location details and an AO-specific RSVP link', () => {
  const html = page('locations');

  assert.match(html, /Caffeine/);
  assert.match(html, /Saturday\s+at 6:00–6:45 AM/);
  assert.match(html, /South parking lot of West Middle School/);
  assert.match(html, /Ruck Workout/);
  assert.match(html, /38\.964925(?:%2C|,)-95\.269030/);
  assert.match(html, /\/contact\/\?ao=Caffeine/);
});

test('offers Caffeine in the RSVP and Q signup flows', () => {
  const contact = page('contact');
  const signup = page('signup');

  assert.match(contact, /<option value="Caffeine">Caffeine<\/option>/);
  assert.match(signup, /<option value="caffeine">Caffeine \(Saturdays\)<\/option>/);
  assert.match(signup, /"caffeine":\[/);
});

test('lists upcoming Caffeine Saturdays on the Q calendar', () => {
  const html = page('calendar');

  assert.match(html, /Caffeine/);
  assert.match(html, /\/signup\/\?date=\d{4}-\d{2}-\d{2}(?:&amp;|&#38;)ao=caffeine/);
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

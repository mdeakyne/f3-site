import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import * as dates from '../src/lib/q-dates.ts';
import * as catalog from '../src/lib/q-catalog.ts';
const now = new Date('2026-11-02T18:00:00Z');

test('shared site data uses one JSON import form in Node and Astro builds', () => {
  const shared = readFileSync(new URL('../src/lib/data.ts', import.meta.url), 'utf8');
  const qCatalog = readFileSync(new URL('../src/lib/q-catalog.ts', import.meta.url), 'utf8');
  assert.match(shared, /data\.json' with \{ type: 'json' \}/);
  assert.match(qCatalog, /data\.json' with \{ type: 'json' \}/);
});

test('test_chicago_midnight', () => {
  assert.equal(typeof dates.chicagoDate, 'function');
  assert.equal(dates.chicagoDate(new Date('2026-11-03T05:30:00Z')), '2026-11-02');
  assert.equal(dates.chicagoDate(new Date('2026-11-03T06:30:00Z')), '2026-11-03');
  assert.equal(dates.chicagoDate(new Date('2026-07-07T04:59:59Z')), '2026-07-06');
  assert.equal(dates.chicagoDate(new Date('2026-07-07T05:00:00Z')), '2026-07-07');
});
test('test_month_clamp', () => {
  assert.deepEqual(dates.claimWindow(now), { first: '2026-11-03', last: '2027-01-02', paxCutoff: '2026-08-02' });
  assert.deepEqual(dates.claimWindow(new Date('2026-12-31T18:00:00Z')), { first: '2027-01-01', last: '2027-02-28', paxCutoff: '2026-09-30' });
  assert.deepEqual(dates.claimWindow(new Date('2024-12-31T18:00:00Z')), { first: '2025-01-01', last: '2025-02-28', paxCutoff: '2024-09-30' });
  assert.deepEqual(dates.claimWindow(new Date('2023-12-31T18:00:00Z')), { first: '2024-01-01', last: '2024-02-29', paxCutoff: '2023-09-30' });
  assert.deepEqual(dates.claimWindow(new Date('2024-05-31T18:00:00Z')), { first: '2024-06-01', last: '2024-07-31', paxCutoff: '2024-02-29' });
});
test('test_dst_deadline', () => {
  for (const [date, expected] of [
    ['2026-11-03', '2026-11-02T22:00:00.000Z'], ['2026-07-07', '2026-07-06T21:00:00.000Z'],
    ['2026-03-08', '2026-03-07T22:00:00.000Z'], ['2026-03-09', '2026-03-08T21:00:00.000Z'],
    ['2026-11-01', '2026-10-31T21:00:00.000Z'], ['2026-11-02', '2026-11-01T22:00:00.000Z'],
  ]) assert.equal(dates.publicationTime(date), expected);
});
test('test_q_counts_latest', () => {
  assert.deepEqual(catalog.buildPaxCatalog([
    { slug: 'q-only', f3_name: 'Q Only', latest: null, latest_q: '2026-10-22' },
    { slug: 'new-q', f3_name: 'New Q', latest: '2026-08-01', latest_q: '2026-10-20' },
    { slug: 'recent', f3_name: 'Recent', latest: '2026-10-27', latest_q: '2026-08-06' },
  ]).sort((a: any, b: any) => a.slug.localeCompare(b.slug)), [
    { slug: 'new-q', name: 'New Q', latest: '2026-10-20' },
    { slug: 'q-only', name: 'Q Only', latest: '2026-10-22' },
    { slug: 'recent', name: 'Recent', latest: '2026-10-27' },
  ]);
  const data = JSON.parse(readFileSync(new URL('../content/data.json', import.meta.url), 'utf8'));
  assert.deepEqual(catalog.PAX_CATALOG, catalog.buildPaxCatalog(data.leaderboard));
  for (const pax of catalog.PAX_CATALOG) assert.deepEqual(Object.keys(pax).sort(), ['latest', 'name', 'slug']);
});
test('test_invalid_iso', () => {
  for (const value of ['2026-02-30', '2026-2-03', '2026-11-03T00:00:00Z', 'not-date', '2026-13-01', '2026-00-03', '2026-11-00', '2026-04-31', '2026-11-03 ', ' 2026-11-03']) {
    assert.equal(dates.isIsoDate(value), false);
    assert.equal(dates.validSlot('beehive', value, now), false);
    assert.throws(() => dates.publicationTime(value), RangeError);
  }
  assert.equal(dates.isIsoDate('2024-02-29'), true);
  assert.equal(dates.isIsoDate('2026-02-29'), false);
});
test('test_eligible_cutoff', () => {
  assert.deepEqual(dates.eligiblePax([
    { slug: 'keep', name: 'Keep', latest: '2026-08-02' },
    { slug: 'old', name: 'Old', latest: '2026-08-01' },
    { slug: 'none', name: 'None', latest: null },
  ], now), [{ slug: 'keep', name: 'Keep', latest: '2026-08-02' }]);
});
test('eligibility advances with Chicago today without regenerating catalog data', () => {
  const pax = catalog.buildPaxCatalog([
    { slug: 'edge', f3_name: 'Edge', latest: null, latest_q: '2026-08-02' },
    { slug: 'recent', f3_name: 'Recent', latest: '2026-10-27', latest_q: null },
  ]);
  assert.deepEqual(dates.eligiblePax(pax, new Date('2026-11-03T05:59:59Z')), pax);
  assert.deepEqual(dates.eligiblePax(pax, new Date('2026-11-03T06:00:00Z')), [pax[1]]);
});
test('test_all_ao_channels', () => {
  const importer = readFileSync(new URL('../scripts/import_slack_backblast.py', import.meta.url), 'utf8');
  assert.deepEqual(catalog.AO_CATALOG, [
    { slug: 'beehive', name: 'Beehive', weekday: 2, time: '5:30 AM', channelId: 'C07A8STLZ5Z' },
    { slug: 'ad-astra', name: 'Ad Astra', weekday: 4, time: '5:30 AM', channelId: 'C05L33U97L4' },
    { slug: 'caffeine', name: 'Caffeine', weekday: 6, time: '6:00 AM', channelId: 'C0CE7TKJ7HS' },
  ]);
  assert.deepEqual(catalog.PUBLIC_AO_CATALOG, catalog.AO_CATALOG.map(({ channelId, ...ao }) => ao));
  for (const ao of catalog.AO_CATALOG) {
    assert.ok(importer.includes(`'${ao.channelId.toLowerCase()}': '${ao.slug}'`));
    const content = readFileSync(new URL(`../content/aos/${ao.slug}.md`, import.meta.url), 'utf8');
    assert.ok(content.includes(`name: ${ao.name}`));
    assert.ok(content.includes(`day: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][ao.weekday]}`));
    assert.ok(content.includes(`time: '${ao.time}'`));
  }
});
test('slot limits use tomorrow and inclusive two-month horizon', () => {
  assert.equal(dates.validSlot('beehive', '2026-11-03', now), true);
  assert.equal(dates.validSlot('caffeine', '2026-11-03', now), false);
  assert.equal(dates.validSlot('unknown', '2026-11-03', now), false);
  assert.equal(dates.validSlot('beehive', '2026-11-03', new Date('2026-11-03T18:00:00Z')), false);
  assert.equal(dates.validSlot('caffeine', '2027-01-02', now), true);
  assert.equal(dates.validSlot('beehive', '2027-01-05', now), false);
});

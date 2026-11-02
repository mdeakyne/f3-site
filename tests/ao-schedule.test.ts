import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calendarEntries, upcomingDates } from '../src/lib/ao-schedule.ts';

test('Q signup starts with the next occurrence instead of the current local day', () => {
  const saturdayMorningInChicago = new Date('2026-11-07T12:00:00Z');

  assert.deepEqual(upcomingDates('Saturday', 2, saturdayMorningInChicago), [
    { value: '2026-11-14', label: 'Sat · Nov 14, 2026' },
    { value: '2026-11-21', label: 'Sat · Nov 21, 2026' },
  ]);
});

test('calendar dates use America/Chicago when UTC is already on the next day', () => {
  const sundayNightInChicago = new Date('2026-11-02T05:30:00Z');

  const entries = calendarEntries(
    [{ slug: 'ao-caffeine', name: 'AO-Caffeine', day: 'Saturday' }],
    7,
    sundayNightInChicago,
  );

  assert.deepEqual(entries.map((entry) => entry.value), ['2026-11-07']);
});

test('calendar keeps the Chicago date across the spring DST boundary', () => {
  const saturdayNightBeforeSpringForward = new Date('2027-03-14T04:30:00Z');

  const entries = calendarEntries(
    [{ slug: 'ao-caffeine', name: 'AO-Caffeine', day: 'Saturday' }],
    2,
    saturdayNightBeforeSpringForward,
  );

  assert.deepEqual(entries.map((entry) => entry.value), ['2027-03-13']);
});

import { PUBLIC_AO_CATALOG } from './q-catalog.ts';
import type { Pax } from './q-types.ts';

const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function chicagoDate(now: Date): string {
  const parts = chicago.formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  const day = parsed.getUTCDate();
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  const end = new Date(parsed);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  parsed.setUTCDate(Math.min(day, end.getUTCDate()));
  return parsed.toISOString().slice(0, 10);
}

export function claimWindow(now: Date): { first: string; last: string; paxCutoff: string } {
  const today = chicagoDate(now);
  return { first: addDays(today, 1), last: addMonths(today, 2), paxCutoff: addMonths(today, -3) };
}

export function publicationTime(eventDate: string): string {
  if (!isIsoDate(eventDate)) throw new RangeError('Invalid event date');
  const previous = addDays(eventDate, -1);
  // At 16:00 Chicago, the offset is unambiguous even on DST transition days.
  const candidate = new Date(`${previous}T22:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23',
  }).format(candidate));
  candidate.setUTCHours(candidate.getUTCHours() + 16 - hour);
  return candidate.toISOString();
}

export function validSlot(aoSlug: string, eventDate: string, now: Date): boolean {
  if (!isIsoDate(eventDate)) return false;
  // Only public scheduling data belongs in browser-imported date helpers.
  const ao = PUBLIC_AO_CATALOG.find(({ slug }) => slug === aoSlug);
  if (!ao) return false;
  const { first, last } = claimWindow(now);
  return eventDate >= first && eventDate <= last && new Date(`${eventDate}T12:00:00Z`).getUTCDay() === ao.weekday;
}

export function eligiblePax(pax: Pax[], now: Date): Pax[] {
  const { paxCutoff } = claimWindow(now);
  return pax.filter(({ latest }) => latest !== null && isIsoDate(latest) && latest >= paxCutoff);
}

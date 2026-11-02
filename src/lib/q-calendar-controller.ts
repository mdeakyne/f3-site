import { PUBLIC_AO_CATALOG } from './q-catalog.ts';
import { claimWindow, validSlot } from './q-dates.ts';
import type { PublicClaim } from './q-types.ts';

export function calendarSlots(now: Date) {
  const { first, last } = claimWindow(now);
  const slots: { ao_slug: string; ao_name: string; event_date: string; time: string }[] = [];
  for (const date = new Date(`${first}T12:00:00Z`); date.toISOString().slice(0, 10) <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    const event_date = date.toISOString().slice(0, 10);
    for (const ao of PUBLIC_AO_CATALOG) {
      if (validSlot(ao.slug, event_date, now)) slots.push({ ao_slug: ao.slug, ao_name: ao.name, event_date, time: ao.time });
    }
  }
  return slots;
}

export async function fetchClaims(fetcher: typeof fetch): Promise<PublicClaim[]> {
  const response = await fetcher('/api/q-signups', { cache: 'no-store' });
  if (!response.ok) throw new Error('Availability unavailable');
  const data = await response.json();
  const fields = ['ao_slug', 'ao_name', 'event_date', 'time', 'q_name', 'title'];
  if (!Array.isArray(data.claims) || !data.claims.every((claim: unknown) => claim && typeof claim === 'object' && fields.every(field => typeof (claim as Record<string, unknown>)[field] === 'string'))) {
    throw new Error('Availability unavailable');
  }
  return data.claims;
}

export function renderCalendar(root: Document, claims: PublicClaim[], now: Date): void {
  const list = root.getElementById('q-calendar');
  if (!list) return;
  list.replaceChildren();
  for (const slot of calendarSlots(now)) {
    const claim = claims.find(c => c.ao_slug === slot.ao_slug && c.event_date === slot.event_date);
    const row = root.createElement('li');
    row.className = 'flex flex-wrap items-center justify-between gap-3 px-4 py-4';
    const details = root.createElement('span');
    details.className = 'font-mono text-sm';
    details.textContent = `${slot.event_date} · ${slot.time} · ${slot.ao_name} · ${claim ? `${claim.q_name} — ${claim.title}` : 'OPEN'}`;
    row.appendChild(details);
    if (!claim) {
      const link = root.createElement('a');
      link.href = `/signup/?ao=${encodeURIComponent(slot.ao_slug)}&date=${slot.event_date}#q-form`;
      link.className = 'font-mono text-sm text-accent-link underline';
      link.textContent = 'Claim →';
      row.appendChild(link);
    }
    list.appendChild(row);
  }
}

export async function refreshCalendar(root: Document, fetcher: typeof fetch, now: Date): Promise<PublicClaim[]> {
  const status = root.getElementById('availability-status');
  root.getElementById('q-calendar')?.replaceChildren();
  if (status) status.textContent = 'Checking availability …';
  try {
    const claims = await fetchClaims(fetcher);
    renderCalendar(root, claims, now);
    if (status) status.textContent = 'Availability confirmed. Claims are first come, first served.';
    return claims;
  } catch (error) {
    if (status) status.textContent = 'Availability could not be confirmed. Please reload to try again.';
    throw error;
  }
}

export function initQCalendar(root: Document, fetcher: typeof fetch, now: Date): void {
  void refreshCalendar(root, fetcher, now).catch(() => {});
}

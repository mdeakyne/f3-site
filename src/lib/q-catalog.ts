import data from '../../content/data.json' with { type: 'json' };
import type { Ao, Pax } from './q-types.ts';

// Canonical AO content and scripts/import_slack_backblast.py are verified together.
// Never serialize this server catalog to the browser; select public fields explicitly.
export const PUBLIC_AO_CATALOG: Omit<Ao, 'channelId'>[] = [
  { slug: 'beehive', name: 'Beehive', weekday: 2, time: '5:30 AM' },
  { slug: 'ad-astra', name: 'Ad Astra', weekday: 4, time: '5:30 AM' },
  { slug: 'caffeine', name: 'Caffeine', weekday: 6, time: '6:00 AM' },
];

export const AO_CATALOG: Ao[] = /* @__PURE__ */ (() => {
  const channels: Record<string, string> = {
    beehive: 'C07A8STLZ5Z', 'ad-astra': 'C05L33U97L4', caffeine: 'C0CE7TKJ7HS',
  };
  return PUBLIC_AO_CATALOG.map((ao) => ({ ...ao, channelId: channels[ao.slug] }));
})();

export function buildPaxCatalog(rows: {
  slug: string; f3_name: string; latest: string | null; latest_q: string | null;
}[]): Pax[] {
  return rows.map(({ slug, f3_name, latest, latest_q }) => ({
    slug,
    name: f3_name,
    latest: [latest, latest_q].filter((date): date is string => !!date).sort().at(-1) ?? null,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export const PAX_CATALOG: Pax[] = buildPaxCatalog(data.leaderboard);

import data from '../../content/data.json';

export interface SiteData {
  generated_at: string;
  counts: {
    backblasts: number;
    pax: number;
    aos: number;
    since_year: string;
    latest_post: string;
  };
  aos: { slug: string; name: string }[];
  leaderboard: LeaderboardRow[];
  latest_backblasts: LatestBackblast[];
}

export interface LeaderboardRow {
  slug: string;
  f3_name: string;
  posts: number;
  qs: number;
  aos: string[];
  earliest: string | null;
  latest: string | null;
}

export interface LatestBackblast {
  slug: string;
  title: string;
  date: string;
  ao: string;
  q: string;
  total_pax: number | null;
  fngs: number | null;
}

export const site = data as SiteData;

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)} ${y}`;
}

export function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

export function aoName(slug: string): string {
  const match = site.aos.find((a) => a.slug === slug);
  return match?.name ?? slug;
}

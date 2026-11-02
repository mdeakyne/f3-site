import { AO_CATALOG } from '../../src/lib/q-catalog.ts';
import { claimWindow, publicationTime } from '../../src/lib/q-dates.ts';
import type { ClaimEnv, ClaimInput, PublicClaim } from '../../src/lib/q-types.ts';

export class ClaimRateLimitError extends Error {
  constructor() { super('Too many recent claims'); this.name = 'ClaimRateLimitError'; }
}

export async function insertClaim(env: ClaimEnv, input: ClaimInput, ipHash: string, now: Date): Promise<number | null> {
  try {
    const result = await env.DB.prepare(`INSERT INTO q_claims
      (ao_slug,event_date,q_slug,q_name,title,description,coupon,ip_hash,created_at,scheduled_for,publish_status)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'scheduled'
      WHERE (SELECT COUNT(*) FROM q_claims WHERE ip_hash = ?8 AND created_at > ?11) < 5`)
      .bind(input.ao_slug,input.event_date,input.q_slug,input.q_name,input.title,input.description,input.coupon ? 1 : 0,ipHash,now.toISOString(),publicationTime(input.event_date),new Date(now.getTime() - 86400000).toISOString()).run();
    if (!result.success) throw new Error('Claim insert failed');
    // A conditional no-op may retain a previous insert's row ID on D1.
    if (result.meta.changes === 0) throw new ClaimRateLimitError();
    if (result.meta.changes !== 1 || !result.meta.last_row_id) throw new Error('Claim insert failed');
    return result.meta.last_row_id;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: q_claims\.ao_slug, q_claims\.event_date(?:\b|$)/.test(error.message)) return null;
    throw error;
  }
}

export async function listClaims(env: ClaimEnv, now: Date): Promise<PublicClaim[]> {
  const { first, last } = claimWindow(now);
  const result = await env.DB.prepare(`SELECT ao_slug,event_date,q_name,title FROM q_claims
    WHERE event_date >= ?1 AND event_date <= ?2 ORDER BY event_date,ao_slug`).bind(first,last).all<PublicClaim>();
  if (!result.success) throw new Error('Availability unavailable');
  return result.results.flatMap(row => {
    const ao = AO_CATALOG.find(ao => ao.slug === row.ao_slug);
    if (!ao || row.event_date < first || row.event_date > last) return [];
    return [{ ao_slug: ao.slug, ao_name: ao.name, event_date: row.event_date, time: ao.time, q_name: row.q_name, title: row.title }];
  });
}

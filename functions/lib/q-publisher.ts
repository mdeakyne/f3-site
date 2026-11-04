import { AO_CATALOG } from '../../src/lib/q-catalog.ts';
import { claimWindow, publicationTime } from '../../src/lib/q-dates.ts';
import type { ClaimEnv, StoredClaim } from '../../src/lib/q-types.ts';

type Outcome = 'posted' | 'failed' | 'skipped';
type NoteClaim = Pick<StoredClaim, 'ao_slug' | 'event_date' | 'q_slug' | 'q_name'>;
const escapeSlack = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', weekday:'long', month:'long', day:'numeric', year:'numeric' }).format(new Date(`${date}T12:00:00Z`));

// Each incoming webhook is bound to one channel; the secret maps AO slugs to those URLs.
function webhookUrl(env: ClaimEnv, slug: string): string | null {
  let hooks: unknown;
  try { hooks = JSON.parse(env.Q_SLACK_WEBHOOKS_JSON ?? ''); } catch { return null; }
  const url = hooks && typeof hooks === 'object' ? (hooks as Record<string, unknown>)[slug] : undefined;
  return typeof url === 'string' && /^https:\/\/hooks\.slack\.com\/services\/[\w/-]+$/.test(url) ? url : null;
}

function qLabel(env: ClaimEnv, claim: { q_slug: string | null; q_name: string }): string {
  let member: unknown;
  try { const members = JSON.parse(env.Q_SLACK_MEMBERS_JSON ?? '{}'); member = claim.q_slug && members && typeof members === 'object' ? members[claim.q_slug] : undefined; } catch { /* Optional mappings fail closed to plain text. */ }
  return typeof member === 'string' && /^[UW][A-Z0-9]{8,}$/.test(member) ? `<@${member}>` : escapeSlack(claim.q_name);
}

function message(env: ClaimEnv, row: StoredClaim): { text: string; unfurl_links: false; unfurl_media: false } {
  const ao = AO_CATALOG.find(ao => ao.slug === row.ao_slug);
  if (!ao) throw new Error('Invalid AO');
  return { text:[`*PRE-BLAST: ${escapeSlack(row.title)}*`, `*AO:* ${ao.name}`, `*Where:* <#${ao.channelId}>`, `*When:* ${dateLabel(row.event_date)} · ${ao.time}`, `*Q:* ${qLabel(env,row)}`, `*:coupon: Coupon:* ${row.coupon ? 'Yes' : 'No'}`, '', escapeSlack(row.description)].join('\n'), unfurl_links:false, unfurl_media:false };
}

function noteMessage(env: ClaimEnv, claim: NoteClaim): { text: string; unfurl_links: false; unfurl_media: false } {
  const publishDate = new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', weekday:'long', month:'long', day:'numeric', year:'numeric' }).format(new Date(publicationTime(claim.event_date)));
  return { text:`*Q signed up:* ${qLabel(env,claim)} for *${dateLabel(claim.event_date)}*. Preblast will be posted on *${publishDate}* around 10:00 AM.`, unfurl_links:false, unfurl_media:false };
}

export function createPublisher(deps: { fetcher?: typeof fetch } = {}) {
  async function postSignupNote(env: ClaimEnv, claim: NoteClaim): Promise<'posted' | 'failed'> {
    const url = webhookUrl(env, claim.ao_slug);
    if (!url) return 'failed';
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),10000);
    try {
      const response = await (deps.fetcher ?? fetch)(url, {
        method:'POST', headers:{ 'content-type':'application/json; charset=utf-8' },
        body:JSON.stringify(noteMessage(env,claim)), signal:controller.signal,
      });
      if (!response.ok) return 'failed';
      return (await response.text()).trim() === 'ok' ? 'posted' : 'failed';
    } catch { return 'failed'; } finally { clearTimeout(timer); }
  }

  async function publishClaim(env: ClaimEnv, id: number, now: Date): Promise<Outcome> {
    // The conditional write is the sole right to send. A crash after this write
    // leaves publishing locked for manual diagnosis instead of risking a retry.
    const reserved = await env.DB.prepare(`UPDATE q_claims SET publish_status = 'publishing'
      WHERE id = ?1 AND publish_status = 'scheduled' AND scheduled_for <= ?2`).bind(id,now.toISOString()).run();
    if (!reserved.success) throw new Error('Publication reservation failed');
    if (reserved.meta.changes !== 1) return 'skipped';
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),10000);
    let error = 'Slack delivery failed or could not be confirmed. Correct manually; do not automatically retry.';
    try {
      const row = await env.DB.prepare('SELECT * FROM q_claims WHERE id = ?1').bind(id).first<StoredClaim>();
      if (!row) throw new Error('Claim missing');
      const url = webhookUrl(env, row.ao_slug);
      if (!url) { error = 'Slack webhook is not configured. Correct manually.'; throw new Error('Configuration'); }
      const response = await (deps.fetcher ?? fetch)(url, {
        method:'POST', headers:{ 'content-type':'application/json; charset=utf-8' },
        body:JSON.stringify(message(env,row)), signal:controller.signal,
      });
      if (!response.ok) throw new Error('Slack HTTP failure');
      if ((await response.text()).trim() !== 'ok') throw new Error('Slack API failure');
      const updated = await env.DB.prepare(`UPDATE q_claims SET publish_status = 'posted',published_at = ?1,publish_error = NULL
        WHERE id = ?2 AND publish_status = 'publishing'`).bind(now.toISOString(),id).run();
      if (!updated.success || updated.meta.changes !== 1) throw new Error('Publication status unavailable');
      return 'posted';
    } catch {
      // Do not store arbitrary remote text, credentials, response bodies or Slack ts.
      try { await env.DB.prepare(`UPDATE q_claims SET publish_status = 'failed',publish_error = ?1
        WHERE id = ?2 AND publish_status = 'publishing'`).bind(error.slice(0,300),id).run(); } catch { /* Reservation remains locked on database failure. */ }
      console.error('Q pre-blast publication needs manual attention', { claimId:id });
      return 'failed';
    } finally { clearTimeout(timer); }
  }

  async function runScheduled(env: ClaimEnv, now: Date): Promise<void> {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', hour:'numeric', hourCycle:'h23' }).format(now));
    if (hour !== 10) return;
    const { first } = claimWindow(now);
    const result = await env.DB.prepare(`SELECT id FROM q_claims
      WHERE event_date = ?1 AND publish_status = 'scheduled' AND scheduled_for <= ?2 ORDER BY id`).bind(first,now.toISOString()).all<{id:number}>();
    if (!result.success) throw new Error('Scheduled claims unavailable');
    for (const { id } of result.results) {
      try { await publishClaim(env,id,now); } catch { console.error('Q publication reservation unavailable', { claimId:id }); }
    }
  }
  return { publishClaim, postSignupNote, runScheduled };
}
const publisher = createPublisher();
export const publishClaim: (env: ClaimEnv,id: number,now: Date) => Promise<Outcome> = publisher.publishClaim;
export const postSignupNote: (env: ClaimEnv,claim: NoteClaim) => Promise<'posted' | 'failed'> = publisher.postSignupNote;
export const runScheduled: (env: ClaimEnv,now: Date) => Promise<void> = publisher.runScheduled;

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ClaimEnv, StoredClaim } from '../src/lib/q-types.ts';
const module = await import('../functions/lib/q-publisher.ts').catch(() => ({} as any));
const now = new Date('2026-11-02T16:00:00Z');
function fixture(options: Record<string, any> = {}) {
  const row: StoredClaim = { id:17, ao_slug:'beehive', event_date:'2026-11-03', q_slug:'404', q_name:'404', title:'💪 :coupon: <!channel>', description:'&<> <@U123> <https://evil>', coupon:true, ip_hash:'hash', created_at:'2026-11-02T18:00:00Z', scheduled_for:'2026-11-02T16:00:00.000Z', publish_status:'scheduled', published_at:null, publish_error:null, ...options.row };
  const db = { prepare(sql: string) { let values: any[] = []; return {
    bind(...args: any[]) { values=args; return this; },
    async first() { return { ...row }; },
    async all() { return { success:true, results:row.publish_status === 'scheduled' && row.event_date === values[0] ? [{ id:17 }] : [], meta:{} }; },
    async run() {
      if(options.finalWriteCrash && !sql.includes("SET publish_status = 'publishing'")) throw new Error('database offline');
      let changes = 1;
      if (sql.includes("SET publish_status = 'publishing'")) {
        changes = row.publish_status === 'scheduled' && row.scheduled_for <= values[1] ? 1 : 0;
        if(changes) row.publish_status='publishing';
      } else if(sql.includes("SET publish_status = 'posted'")) {
        row.publish_status='posted'; row.published_at=values[0];
        if(options.finalWriteCommitCrash) throw new Error('committed but acknowledgement lost');
      }
      else if(sql.includes("SET publish_status = 'failed'")) {
        const guarded = sql.includes("AND publish_status = 'publishing'");
        changes = !guarded || row.publish_status === 'publishing' ? 1 : 0;
        if(changes) { row.publish_status='failed'; row.publish_error=values[0]; }
      }
      return {success:true,results:[],meta:{changes}};
    },
  }; } };
  const sends: any[] = [];
  const webhooks = options.webhooks ?? JSON.stringify({
    beehive:'https://hooks.slack.com/services/T000/B000/beehive',
    'ad-astra':'https://hooks.slack.com/services/T000/B000/adastra',
    caffeine:'https://hooks.slack.com/services/T000/B000/caffeine',
  });
  const env = { DB:db, TURNSTILE_SECRET_KEY:'secret', Q_SLACK_WEBHOOKS_JSON:webhooks, Q_SLACK_MEMBERS_JSON: options.members ?? '{"404":"U0123456789"}' } as ClaimEnv;
  const fetcher = async (url: string, init: RequestInit) => { sends.push({url:String(url), ...JSON.parse(String(init.body))}); if(options.error) throw new Error('ambiguous timeout with secret'); if(options.malformed) return new Response('ambiguous body'); return new Response(options.response ?? 'ok', {status:options.httpStatus ?? 200}); };
  const publisher = module.createPublisher?.({fetcher}) ?? { publishClaim: async () => 'skipped', runScheduled: async () => {}, postSignupNote: async () => 'failed' };
  return {row,env,sends,publish: () => publisher.publishClaim(env,17,now), note: (claim: any = row) => publisher.postSignupNote(env,claim), run: (date: Date) => publisher.runScheduled(env,date)};
}
test('test_two_publishers reserves once', async () => { const f=fixture(); const results=await Promise.all([f.publish(),f.publish()]); assert.equal(f.sends.length,1); assert.deepEqual(results.sort(),['posted','skipped']); assert.equal(f.row.publish_status,'posted'); assert.equal(f.row.published_at, now.toISOString()); });
test('test_network_ambiguous never retries', async () => { const f=fixture({error:true}); assert.equal(await f.publish(),'failed'); assert.equal(await f.publish(),'skipped'); assert.equal(f.sends.length,1); assert.equal(f.row.publish_status,'failed'); assert.ok(!f.row.publish_error?.includes('secret')); });
test('Slack error response and missing webhook fail permanently', async () => { for(const options of [{response:'invalid_payload'},{webhooks:''}]) { const f=fixture(options); assert.equal(await f.publish(),'failed'); assert.equal(await f.publish(),'skipped'); assert.equal(f.sends.length,options.webhooks === '' ? 0 : 1); } });
test('only valid Slack webhook URLs for the claim AO are used', async () => {
  for(const webhooks of ['{}','not json',JSON.stringify({beehive:'https://evil.example/services/T/B/x'})]) {
    const f=fixture({webhooks}); assert.equal(await f.publish(),'failed'); assert.equal(f.sends.length,0);
    assert.ok(!f.row.publish_error?.includes('evil'));
  }
  const f=fixture({webhooks:JSON.stringify({'ad-astra':'https://hooks.slack.com/services/T000/B000/adastra'})});
  assert.equal(await f.publish(),'failed'); assert.equal(f.sends.length,0);
});
test('test_wrong_utc_trigger and tomorrow-only scheduling', async () => {
  const f=fixture(); await f.run(new Date('2026-11-02T15:00:00Z')); assert.equal(f.sends.length,0); await f.run(now); assert.equal(f.sends.length,1); await f.run(now); assert.equal(f.sends.length,1);
  const summer=fixture({row:{event_date:'2026-07-07',scheduled_for:'2026-07-06T15:00:00.000Z'}}); await summer.run(new Date('2026-07-06T16:00:00Z')); assert.equal(summer.sends.length,0); await summer.run(new Date('2026-07-06T15:00:00Z')); assert.equal(summer.sends.length,1);
  const later=fixture({row:{event_date:'2026-11-05'}}); await later.run(now); assert.equal(later.sends.length,0);
});
test('not-due and already reserved rows skipped', async () => { for(const row of [{scheduled_for:'2026-11-03T22:00:00.000Z'},{publish_status:'publishing'},{publish_status:'failed'},{publish_status:'posted'}]) {const f=fixture({row}); assert.equal(await f.publish(),'skipped'); assert.equal(f.sends.length,0);} });
test('test_user_mentions escaped; test_controlled_mentions retained', async () => {
  const f=fixture(); await f.publish(); const {text,url,unfurl_links,unfurl_media}=f.sends[0];
  assert.equal(url,'https://hooks.slack.com/services/T000/B000/beehive'); assert.equal(unfurl_links,false); assert.equal(unfurl_media,false); assert.ok(text.startsWith('<!channel> *PRE-BLAST:'));
  assert.ok(text.includes('<@U0123456789>')); assert.ok(text.includes('💪 :coupon: &lt;!channel&gt;')); assert.ok(text.includes('&amp;&lt;&gt; &lt;@U123&gt; &lt;https://evil&gt;')); assert.ok(text.includes('*:coupon: Coupon:* Yes')); assert.ok(text.includes('5:30 AM'));
  for(const members of ['{}','{"404":"evil><!channel>"}','invalid']) {const plain=fixture({members,row:{q_name:'<@U123>'}}); await plain.publish(); assert.ok(plain.sends[0].text.includes('*Q:* &lt;@U123&gt;'));}
});
test('worker has both DST cron hours and same D1 binding', () => { const config=readFileSync(new URL('../workers/wrangler.toml',import.meta.url),'utf8'); assert.ok(config.includes('0 15,16 * * *')); assert.ok(config.includes('b7ac38a1-b139-4f60-a9c8-3dbb99230b17')); });

test('signup note announces the Q and the scheduled preblast time without a channel-wide ping', async () => {
  const f=fixture(); assert.equal(await f.note(),'posted');
  assert.equal(f.sends.length,1);
  const {text,url,unfurl_links,unfurl_media}=f.sends[0];
  assert.equal(url,'https://hooks.slack.com/services/T000/B000/beehive');
  assert.equal(unfurl_links,false); assert.equal(unfurl_media,false);
  assert.ok(text.includes('*Q signed up:* <@U0123456789> for *Tuesday, November 3, 2026*.'));
  assert.ok(text.includes('Preblast will be posted on *Monday, November 2, 2026* around 10:00 AM.'));
  assert.ok(!text.includes('<!channel>'));
});
test('signup note escapes unmapped Q names and fails closed without a usable webhook', async () => {
  const f=fixture({members:'{"404":"evil><!channel>"}',row:{q_name:'<@U123>'}});
  assert.equal(await f.note(),'posted');
  assert.ok(f.sends[0].text.includes('*Q signed up:* &lt;@U123&gt; for'));
  assert.ok(!f.sends[0].text.includes('<!channel>'));
  for(const options of [{webhooks:''},{error:true},{httpStatus:503,response:'private credential details'}]) {
    const g=fixture(options); assert.equal(await g.note(),'failed'); assert.equal(g.sends.length,options.webhooks === '' ? 0 : 1);
  }
});

test('ambiguous response and final DB write crash never cause another send', async () => {
  for(const options of [{malformed:true},{finalWriteCrash:true}]) {
    const f=fixture(options); assert.equal(await f.publish(),'failed');
    assert.equal(await f.publish(),'skipped'); assert.equal(f.sends.length,1);
    assert.equal(f.row.publish_status,options.finalWriteCrash ? 'publishing' : 'failed');
  }
});
test('D1 integer coupon values render Yes and No', async () => {
  for(const coupon of [0,1]) { const f=fixture({row:{coupon}}); await f.publish(); assert.ok(f.sends[0].text.includes(`*:coupon: Coupon:* ${coupon ? 'Yes' : 'No'}`)); }
});
test('committed final update with lost acknowledgement preserves posted state and never resends', async () => {
  const f=fixture({finalWriteCommitCrash:true});
  assert.equal(await f.publish(),'failed');
  assert.equal(f.row.publish_status,'posted');
  assert.equal(f.row.published_at,now.toISOString());
  assert.equal(f.row.publish_error,null);
  assert.equal(await f.publish(),'skipped');
  assert.equal(f.sends.length,1);
});
test('Slack HTTP errors remain failed without retaining remote error text or retrying', async () => {
  const f=fixture({httpStatus:503,response:'private credential details'});
  assert.equal(await f.publish(),'failed');
  assert.equal(f.row.publish_status,'failed');
  assert.ok((f.row.publish_error?.length ?? 0) <= 300);
  assert.ok(!f.row.publish_error?.includes('private credential details'));
  assert.equal(await f.publish(),'skipped');
  assert.equal(f.sends.length,1);
});
test('Chicago hour gate follows both DST transition days', async () => {
  for(const [event_date,scheduled_for,wrong] of [
    ['2026-03-09','2026-03-08T15:00:00.000Z','2026-03-08T16:00:00.000Z'],
    ['2026-11-02','2026-11-01T16:00:00.000Z','2026-11-01T15:00:00.000Z'],
  ]) {
    const f=fixture({row:{event_date,scheduled_for}});
    await f.run(new Date(wrong)); assert.equal(f.sends.length,0);
    await f.run(new Date(scheduled_for)); assert.equal(f.sends.length,1);
  }
});
test('Worker reports cron database failure through waitUntil without raw error details', async () => {
  const {default:worker}=await import('../workers/q-publisher.ts');
  let pending: Promise<unknown> | undefined;
  const env={DB:{prepare(){throw new Error('raw credentials should stay private');}}} as unknown as ClaimEnv;
  worker.scheduled({scheduledTime:now.getTime()},env,{waitUntil(promise){pending=promise;}});
  await assert.rejects(pending!,{message:'Scheduled Q publication failed'});
});

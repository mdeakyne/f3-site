import { runScheduled } from '../functions/lib/q-publisher.ts';
import type { ClaimEnv } from '../src/lib/q-types.ts';

export default {
  scheduled(event: { scheduledTime: number }, env: ClaimEnv, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduled(env,new Date(event.scheduledTime)).catch(() => {
      console.error('Scheduled Q publication failed; inspect D1 availability and claim states.');
      throw new Error('Scheduled Q publication failed');
    }));
  },
};

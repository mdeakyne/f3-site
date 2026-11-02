import { listClaims } from '../lib/q-store.ts';
import type { ClaimEnv } from '../../src/lib/q-types.ts';

export async function onRequestGet(ctx: { env: ClaimEnv }): Promise<Response> {
  try {
    return Response.json({ claims: await listClaims(ctx.env, new Date()) }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Availability is temporarily unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

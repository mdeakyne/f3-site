export interface Ao {
  slug: string;
  name: string;
  weekday: number;
  time: string;
  channelId: string;
}
export interface Pax { slug: string; name: string; latest: string | null }
export interface ClaimInput {
  ao_slug: string;
  event_date: string;
  q_slug: string | null;
  q_name: string;
  title: string;
  description: string;
  coupon: boolean;
}
export interface PublicClaim {
  ao_slug: string;
  ao_name: string;
  event_date: string;
  time: string;
  q_name: string;
  title: string;
}
export type PublicationStatus = 'scheduled' | 'publishing' | 'posted' | 'failed';
export type StoredClaim = ClaimInput & {
  id: number;
  publish_status: PublicationStatus;
  scheduled_for: string;
  published_at: string | null;
  publish_error: string | null;
  ip_hash: string;
  created_at: string;
};
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; [key: string]: unknown };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database { prepare(query: string): D1PreparedStatement }
export interface ClaimEnv {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  SLACK_BOT_TOKEN: string;
  Q_SLACK_MEMBERS_JSON?: string;
}

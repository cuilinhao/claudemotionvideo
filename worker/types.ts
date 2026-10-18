export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  GENERATION: Workflow<{ jobId: string }>;
  ASSETS: Fetcher;
  APIMART_API_KEY: string;
  APIMART_MODEL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICES?: string;
  STRIPE_SINGLE_VIDEO_PRICE?: string;
  STRIPE_PORTAL_CONFIGURATION?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_URL: string;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
}

export interface UserRow {
  single_video_generations?: number;
  id: string; email: string; password_hash: string; email_verified_at: number | null; credits: number; plan: string;
  monthly_credits: number; subscription_status: string; stripe_customer_id: string | null;
  subscription_id: string | null; subscription_interval: 'month' | 'year' | null;
  trial_used: number; period_start: number | null; period_end: number | null;
  next_refill_at: number | null; refill_index: number; created_at: string;
  paid_period_start: number | null; paid_period_end: number | null; billing_event_created: number;
  checkout_session_id: string | null; checkout_expires_at: number | null;
  checkout_plan: string | null; checkout_interval: string | null; checkout_lease: number;
}
export interface ProjectRow {
  id: string; user_id: string; title: string; aspect: string; duration: number;
  latest_version_id: string | null; created_at: string; updated_at: string;
}
export interface VersionRow {
  id: string; project_id: string; user_id: string; html: string; storyboard: string;
  prompt: string; asset_ids: string; mp4_key: string | null; created_at: string;
}
export interface AssetRow {
  id: string; user_id: string; name: string; media_type: string; size: number; r2_key: string; created_at: string;
}
export interface JobRow {
  id: string; user_id: string; project_id: string; prompt: string; aspect: string; duration: number;
  asset_ids: string; previous_version_id: string | null; selected_shot: string | null; cost: number;
  status: 'queued' | 'running' | 'completed' | 'failed'; progress: string; error: string | null;
  version_id: string | null; idempotency_key: string; request_hash: string; created_at: string; updated_at: string;
}
export type ApiEnv = { Bindings: Env; Variables: { user: UserRow | null } };
export const publicUser = (user: UserRow) => ({
  id: user.id, email: user.email, credits: user.credits, singleVideoGenerations: user.single_video_generations ?? 0, plan: user.plan, subscriptionStatus: user.subscription_status,
});

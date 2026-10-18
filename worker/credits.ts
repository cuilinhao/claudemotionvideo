export const PLAN_CREDITS = { starter: 1500, pro: 3600, max: 7500 } as const;
export type Plan = keyof typeof PLAN_CREDITS;

export function creditStatement(db: D1Database, userId: string, amount: number, reason: string, key: string, ignoreDuplicate = true) {
  if (!Number.isSafeInteger(amount)) throw new Error('Invalid credit amount');
  return db.prepare(`INSERT INTO credit_ledger (id,user_id,amount,reason,external_key,created_at) VALUES (?,?,?,?,?,?)${ignoreDuplicate ? ' ON CONFLICT(external_key) DO NOTHING' : ''}`)
    .bind(crypto.randomUUID(), userId, amount, reason, key, new Date().toISOString());
}

export function generationCost(input: { duration: number; assetCount: number; edit?: boolean; newAssetCount?: number }) {
  if (![10, 15, 30].includes(input.duration) || !Number.isInteger(input.assetCount) || input.assetCount < 0 || input.assetCount > 4) throw new Error('Invalid generation options');
  if (input.edit) return (input.assetCount ? 40 : 20) + 20 * (input.newAssetCount ?? 0);
  const base = input.duration === 10 ? 80 : input.duration === 15 ? 100 : 160;
  return base + (input.assetCount ? 60 + (input.assetCount - 1) * 20 : 0);
}

/** Clamp against the original anchor; February does not make later months drift. */
export function addMonths(anchorSeconds: number, months: number) {
  const date = new Date(anchorSeconds * 1000);
  const day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return Math.floor(date.getTime() / 1000);
}

export function monthlyCreditStatement(db: D1Database, userId: string, allowance: number, periodKey: string) {
  return db.prepare(`INSERT INTO credit_ledger (id,user_id,amount,reason,external_key,created_at)
    SELECT ?,id,MAX(0,MIN(?,?-credits)),'Monthly subscription credits',?,? FROM users WHERE id=?
    ON CONFLICT(external_key) DO NOTHING`)
    .bind(crypto.randomUUID(), allowance, allowance * 2, `grant:${periodKey}`, new Date().toISOString(), userId);
}

export async function grantMonthlyCredits(db: D1Database, userId: string, allowance: number, periodKey: string) {
  return monthlyCreditStatement(db, userId, allowance, periodKey).run();
}

/** UPDATE and conditional refund share a transaction, preventing a late failure
 * from refunding a version that completed while the scheduler was checking. */
export async function refundJob(db: D1Database, jobId: string, message: string) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE jobs SET status='failed',progress='Failed — credits refunded',error=?,updated_at=? WHERE id=? AND status IN ('queued','running')")
      .bind(message, now, jobId),
    db.prepare(`INSERT INTO credit_ledger (id,user_id,amount,reason,external_key,created_at)
      SELECT ?,jobs.user_id,-debit.amount,'Failed generation refund',?,? FROM jobs
      JOIN credit_ledger AS debit ON debit.user_id=jobs.user_id AND debit.external_key=? AND debit.amount<0
      WHERE jobs.id=? AND jobs.status='failed'
      ON CONFLICT(external_key) DO NOTHING`)
      .bind(crypto.randomUUID(), `refund:${jobId}`, now, `job:${jobId}`, jobId),
  ]);
}

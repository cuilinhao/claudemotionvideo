import { describe, it, expect } from 'vitest';
import { makeDb, seedUser } from './backend-db';
import { creditStatement, generationCost, addMonths, grantMonthlyCredits, refundJob } from '../worker/credits';

describe('credit ledger integrity', () => {
  it('rejects a debit exceeding the current balance and rolls back the whole batch', async () => {
    const { db } = makeDb(); await seedUser(db, 'alice', 100);
    await expect(db.batch([
      creditStatement(db, 'alice', -80, 'generation', 'job:first'),
      creditStatement(db, 'alice', -80, 'generation', 'job:second'),
    ])).rejects.toThrow(/INSUFFICIENT_CREDITS/);
    expect(await db.prepare('SELECT credits FROM users WHERE id=?').bind('alice').first('credits')).toBe(100);
  });

  it('does not debit again when an idempotent retry arrives after the balance was spent', async () => {
    const { db } = makeDb(); await seedUser(db, 'alice', 80);
    await creditStatement(db, 'alice', -80, 'generation', 'job:first').run();
    await creditStatement(db, 'alice', -80, 'generation', 'job:first').run();
    expect(await db.prepare('SELECT credits FROM users WHERE id=?').bind('alice').first('credits')).toBe(0);
  });

  it('caps monthly rollover at twice the allowance and makes period grants idempotent', async () => {
    const { db } = makeDb(); await seedUser(db, 'alice', 2900);
    await grantMonthlyCredits(db, 'alice', 1500, 'sub_1:2026-02');
    await grantMonthlyCredits(db, 'alice', 1500, 'sub_1:2026-02');
    expect(await db.prepare('SELECT credits FROM users WHERE id=?').bind('alice').first('credits')).toBe(3000);
    expect(await db.prepare("SELECT amount FROM credit_ledger WHERE external_key='grant:sub_1:2026-02'").first('amount')).toBe(100);
  });

  it('refunds a failed job once and never refunds a completed job', async () => {
    const { db } = makeDb(); await seedUser(db, 'alice', 100);
    await db.prepare('INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind('p', 'alice', 'Demo', '16:9', 15, '2026-01-01', '2026-01-01').run();
    await db.prepare("INSERT INTO jobs (id,user_id,project_id,prompt,aspect,duration,asset_ids,cost,status,idempotency_key,request_hash,created_at,updated_at) VALUES ('j','alice','p','demo','16:9',15,'[]',100,'running','key','hash','2026-01-01','2026-01-01')").run();
    await creditStatement(db, 'alice', -100, 'generation', 'job:j').run();
    await refundJob(db, 'j', 'Generation failed'); await refundJob(db, 'j', 'Generation failed');
    expect(await db.prepare('SELECT credits FROM users WHERE id=?').bind('alice').first('credits')).toBe(100);
    await db.prepare("UPDATE jobs SET status='completed' WHERE id='j'").run();
    await refundJob(db, 'j', 'Late failure');
    expect(await db.prepare("SELECT status FROM jobs WHERE id='j'").first('status')).toBe('completed');
  });
  it('refunds the exact original debit even if a job cost no longer matches it', async () => {
    const { db } = makeDb(); await seedUser(db, 'alice', 100);
    await db.prepare("INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES ('p','alice','Demo','16:9',30,'2026-01-01','2026-01-01')").run();
    await db.prepare("INSERT INTO jobs (id,user_id,project_id,prompt,aspect,duration,asset_ids,cost,status,idempotency_key,request_hash,created_at,updated_at) VALUES ('j','alice','p','demo','16:9',30,'[]',280,'running','key','hash','2026-01-01','2026-01-01')").run();
    await creditStatement(db, 'alice', -80, 'generation', 'job:j').run();
    await refundJob(db, 'j', 'Generation failed');
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(100);
    expect(await db.prepare("SELECT amount FROM credit_ledger WHERE external_key='refund:j'").first('amount')).toBe(80);
  });
});

describe('billing calculations', () => {
  it.each([
    [{ duration: 10, assetCount: 0 }, 80], [{ duration: 15, assetCount: 1 }, 160],
    [{ duration: 30, assetCount: 4 }, 280], [{ duration: 15, assetCount: 0, edit: true, newAssetCount: 0 }, 20],
    [{ duration: 15, assetCount: 2, edit: true, newAssetCount: 1 }, 60],
  ])('prices generation/edit from server-owned previous assets', (input, expected) => {
    expect(generationCost(input)).toBe(expected);
  });
  it('uses the original annual anchor for end-of-month and leap-year refills', () => {
    const jan31 = Date.parse('2024-01-31T12:00:00Z') / 1000;
    expect(new Date(addMonths(jan31, 1) * 1000).toISOString()).toBe('2024-02-29T12:00:00.000Z');
    expect(new Date(addMonths(jan31, 2) * 1000).toISOString()).toBe('2024-03-31T12:00:00.000Z');
  });
});

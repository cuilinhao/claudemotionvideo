import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applySubscriptionEvent, applyAnnualRefills, verifyStripeEvent, type SubscriptionSnapshot } from '../worker/billing';
import { makeDb, seedUser } from './backend-db';

const snapshot: SubscriptionSnapshot = {
  id: 'sub_a', userId: 'alice', customerId: 'cus_a', plan: 'starter', interval: 'month', status: 'active',
  periodStart: Date.parse('2026-01-31T12:00:00Z') / 1000, periodEnd: Date.parse('2026-02-28T12:00:00Z') / 1000,
  hasPaymentMethod: true,
};
describe('Stripe signatures and credit events', () => {
  it('accepts a current valid signature and rejects tampering or stale delivery', async () => {
    const now = Math.floor(Date.now() / 1000); const secret = 'whsec_test_fixture';
    const body = JSON.stringify({ id: 'evt_test', object: 'event', type: 'invoice.paid', data: { object: {} } });
    const header = `t=${now},v1=${createHmac('sha256', secret).update(`${now}.${body}`).digest('hex')}`;
    expect((await verifyStripeEvent(body, header, secret)).id).toBe('evt_test');
    await expect(verifyStripeEvent(body + ' ', header, secret)).rejects.toThrow();
    const stale = now - 600;
    await expect(verifyStripeEvent(body, `t=${stale},v1=${createHmac('sha256', secret).update(`${stale}.${body}`).digest('hex')}`, secret)).rejects.toThrow();
  });
  it('grants paid credits once across duplicate events and distinct events for the same invoice period', async () => {
    const { db } = makeDb(); await seedUser(db);
    const invoice = { id: 'in_a', plan: 'starter' as const, interval: 'month' as const, amountPaid: 1990, periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd, billingReason: 'subscription_cycle' };
    await applySubscriptionEvent(db, 'evt_a', 'invoice.paid', snapshot, invoice);
    await applySubscriptionEvent(db, 'evt_a', 'invoice.paid', snapshot, invoice);
    await applySubscriptionEvent(db, 'evt_b', 'invoice.paid', snapshot, invoice);
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(1500);
  });
  it('requires card collection for a trial and grants it only once per account', async () => {
    const { db } = makeDb(); await seedUser(db);
    await applySubscriptionEvent(db, 'evt_no_card', 'checkout.session.completed', { ...snapshot, status: 'trialing', hasPaymentMethod: false });
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(0);
    await applySubscriptionEvent(db, 'evt_card', 'checkout.session.completed', { ...snapshot, status: 'trialing' });
    await applySubscriptionEvent(db, 'evt_card_again', 'customer.subscription.updated', { ...snapshot, status: 'trialing' });
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(300);
  });
  it('does not grant free invoice or unpaid-subscription credits', async () => {
    const { db } = makeDb(); await seedUser(db);
    const invoice = { id: 'in_a', plan: 'starter' as const, interval: 'month' as const, amountPaid: 0, periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd, billingReason: 'subscription_create' };
    await applySubscriptionEvent(db, 'evt_zero', 'invoice.paid', snapshot, invoice);
    await applySubscriptionEvent(db, 'evt_due', 'invoice.paid', { ...snapshot, status: 'past_due' }, { ...invoice, amountPaid: 1990 });
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(0);
  });
  it('refills an annual subscription monthly without calendar drift or duplicates', async () => {
    const { db } = makeDb(); await seedUser(db);
    const annual = { ...snapshot, interval: 'year' as const, periodEnd: Date.parse('2027-01-31T12:00:00Z') / 1000 };
    await applySubscriptionEvent(db, 'evt_annual', 'invoice.paid', annual, { id: 'in_year', plan: 'starter', interval: 'year', amountPaid: 16680, periodStart: annual.periodStart, periodEnd: annual.periodEnd, billingReason: 'subscription_create' });
    const feb = Date.parse('2026-02-28T12:00:00Z') / 1000;
    await applyAnnualRefills(db, 'alice', feb); await applyAnnualRefills(db, 'alice', feb);
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(3000);
    expect(await db.prepare("SELECT next_refill_at FROM users WHERE id='alice'").first('next_refill_at')).toBe(Date.parse('2026-03-31T12:00:00Z') / 1000);
    await db.prepare("UPDATE users SET subscription_status='canceled' WHERE id='alice'").run();
    await applyAnnualRefills(db, 'alice', Date.parse('2026-04-01T00:00:00Z') / 1000);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE external_key LIKE 'grant:%'").first('n')).toBe(2);
  });
  it('rejects mapping an existing Stripe customer onto a different account', async () => {
    const { db } = makeDb(); await seedUser(db); await seedUser(db, 'bob');
    await db.prepare("UPDATE users SET stripe_customer_id='cus_b' WHERE id='alice'").run();
    await expect(applySubscriptionEvent(db, 'evt_bad', 'customer.subscription.updated', snapshot)).rejects.toThrow(/customer/i);
    expect(await db.prepare("SELECT stripe_customer_id FROM users WHERE id='alice'").first('stripe_customer_id')).toBe('cus_b');
  });
  it('does not raise annual credit grants from a plan change without a new paid period', async () => {
    const { db } = makeDb(); await seedUser(db);
    const annual = { ...snapshot, interval: 'year' as const, periodEnd: Date.parse('2027-01-31T12:00:00Z') / 1000 };
    await applySubscriptionEvent(db, 'evt_paid_starter', 'invoice.paid', annual, { id: 'in_year', plan: 'starter', interval: 'year', amountPaid: 16680, periodStart: annual.periodStart, periodEnd: annual.periodEnd, billingReason: 'subscription_create' });
    await applySubscriptionEvent(db, 'evt_unpaid_upgrade', 'customer.subscription.updated', { ...annual, plan: 'max' });
    await applyAnnualRefills(db, 'alice', Date.parse('2026-02-28T12:00:00Z') / 1000);
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(3000);
  });
  it('bases delayed paid invoice credits on its paid price rather than the latest subscription price', async () => {
    const { db } = makeDb(); await seedUser(db);
    const upgraded = { ...snapshot, plan: 'max' as const, interval: 'year' as const, periodEnd: Date.parse('2027-01-31T12:00:00Z') / 1000 };
    await applySubscriptionEvent(db, 'evt_delayed_starter_invoice', 'invoice.paid', upgraded, {
      id: 'in_starter_paid', plan: 'starter', interval: 'year', amountPaid: 16680,
      periodStart: upgraded.periodStart, periodEnd: upgraded.periodEnd, billingReason: 'subscription_create',
    });
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(1500);
    expect(await db.prepare("SELECT monthly_credits FROM users WHERE id='alice'").first('monthly_credits')).toBe(1500);
  });
  it('grants a full paid period when Stripe ends a trial with subscription_update billing reason', async () => {
    const { db } = makeDb(); await seedUser(db, 'alice', 300);
    await applySubscriptionEvent(db, 'evt_trial_converted', 'invoice.paid', snapshot, {
      id: 'in_trial_conversion', plan: 'starter', interval: 'month', amountPaid: 1990,
      periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd, billingReason: 'subscription_update',
    });
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(1800);
  });
});

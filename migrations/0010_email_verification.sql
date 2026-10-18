-- Legacy accounts remain unverified. On their first email/Google verification,
-- retire old passwords and sessions; the verified owner can reset a password.
-- Never infer email ownership from a password registration or payment.
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

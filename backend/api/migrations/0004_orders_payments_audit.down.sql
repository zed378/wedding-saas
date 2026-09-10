-- Reverses 0004_orders_payments_audit.sql.
--
-- Dropping the tables removes the REVOKE with them, so the grant does not need undoing.
-- Children before parents: payments references orders, orders references packages.
--
-- This one destroys payment history, which is the reason migrations/README.md insists
-- db:rollback is a development tool. In production the answer is roll-forward and PITR.

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS addons;
DROP TABLE IF EXISTS packages;

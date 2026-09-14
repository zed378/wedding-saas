-- Reverses 0010_one_pending_order.sql.
--
-- The one-pending-order rule is then held only by the order service's lock and check.
-- Development only; the production answer is roll-forward (migrations/README.md).

DROP INDEX IF EXISTS "idx_orders_one_pending";

-- P3-02 -- ADR-074, answers OQ-18. At most one `pending` order per invitation.
--
-- docs/DATABASE/07 made this an application-level rule, checked in the order service before
-- insert so the API can answer 409 ACTIVE_ORDER_EXISTS. The service still does that, under a
-- row lock on the invitation. This index is the guarantee for everything that is not that
-- service: two pending orders would be two payment pages for one invitation, and a payment on
-- the "wrong" one is a support case and possibly a double charge.
--
-- Expand-only. No order-creating code existed before this migration, so no existing row can
-- violate it.

CREATE UNIQUE INDEX "idx_orders_one_pending" ON "orders" USING btree ("invitation_id") WHERE status = 'pending';

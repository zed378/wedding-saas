-- Reverses 0012_payment_notifications.sql. Development only: in production this table is evidence,
-- and dropping it destroys the record of every forged callback (migrations/README.md: roll forward).

DROP TABLE IF EXISTS "payment_notifications";

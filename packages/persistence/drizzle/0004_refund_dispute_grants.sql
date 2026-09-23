-- The two tables 0003 added, granted by name (docs/guide/repo.md, "a new tenant table
-- needs its own grant migration").
--
-- No DELETE on either, for the reason `payment_provider_events` and `org_debts` hold none:
-- each row records money that moved and which way the wallet followed it. A refund or a
-- dispute can be corrected as the provider reports it — hence UPDATE — but never dropped,
-- because the wallet it adjusted cannot be reconciled without it.
GRANT SELECT, INSERT, UPDATE ON TABLE "payment_refunds", "payment_disputes" TO idenzy_app;

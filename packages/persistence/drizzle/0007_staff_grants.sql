-- What the application may do to the two tables 0006 added (ADR-0018).
--
-- `staff` decides who is an operator, so the application reads it and never writes it. The
-- default privileges hand every new table SELECT *and INSERT*, so saying nothing here would leave
-- INSERT in place — which is to say, a route with a bug could make its caller an operator. The
-- INSERT is revoked by name and a test asserts all three write verbs are absent: the grants test
-- only sees privileges that exist, so it cannot notice one that should not (docs/guide/repo.md).
-- Rows are written by `pnpm staff` over the owner connection, or by hand.
REVOKE INSERT, UPDATE, DELETE ON TABLE "staff" FROM idenzy_app;
--> statement-breakpoint
GRANT SELECT ON TABLE "staff" TO idenzy_app;
--> statement-breakpoint
-- The operator audit trail is append-only, the same promise `usage_charges` makes about money: a
-- record of what somebody did to a customer's account that could be amended afterwards is not a
-- record of anything.
REVOKE UPDATE, DELETE ON TABLE "operator_actions" FROM idenzy_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "operator_actions" TO idenzy_app;

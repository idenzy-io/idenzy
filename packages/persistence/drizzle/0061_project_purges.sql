CREATE TABLE "project_purges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"audit_rows_deleted" integer NOT NULL,
	"purged_by" text NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL
);

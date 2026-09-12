ALTER TABLE "webhook_deliveries" DROP COLUMN "status_code";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP COLUMN "attempts";--> statement-breakpoint
ALTER TABLE "webhooks" DROP COLUMN "secret_hash";
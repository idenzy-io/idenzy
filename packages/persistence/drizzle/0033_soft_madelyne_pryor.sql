ALTER TABLE "relay_offsets" ALTER COLUMN "position_seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_offsets" DROP COLUMN "position";
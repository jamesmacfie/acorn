ALTER TABLE `pr_files` DROP COLUMN `patch`;--> statement-breakpoint
ALTER TABLE `pull_requests` DROP COLUMN `stale_after`;--> statement-breakpoint
ALTER TABLE `pull_requests` DROP COLUMN `etag`;--> statement-breakpoint
ALTER TABLE `repos` DROP COLUMN `stale_after`;--> statement-breakpoint
ALTER TABLE `repos` DROP COLUMN `etag`;
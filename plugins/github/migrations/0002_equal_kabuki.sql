ALTER TABLE `review_threads` ADD `original_line` integer;--> statement-breakpoint
ALTER TABLE `review_threads` ADD `outdated` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `revision` text;
--> statement-breakpoint
-- Legacy numeric lines may be historical. Keep every comment, and revalidate location metadata.
UPDATE `sync_state` SET `fetched_at` = 0
WHERE `resource` LIKE 'pr:%' OR `resource` LIKE 'files:%';

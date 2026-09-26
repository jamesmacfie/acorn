-- The PR mirror is a cache of GitHub. Its child rows have no provider order or patch state to carry
-- over, and SQLite refuses a NOT NULL column without a default on a table that has rows, so the
-- mirrored children are emptied first. Dropping the pr: and files: sync rows makes the next read of
-- each pull cold, so it refetches everything. viewed_files is app state and is kept.
DELETE FROM `checks`;--> statement-breakpoint
DELETE FROM `comments`;--> statement-breakpoint
DELETE FROM `pr_commits`;--> statement-breakpoint
DELETE FROM `pr_files`;--> statement-breakpoint
DELETE FROM `pr_labels`;--> statement-breakpoint
DELETE FROM `review_requests`;--> statement-breakpoint
DELETE FROM `review_threads`;--> statement-breakpoint
DELETE FROM `reviews`;--> statement-breakpoint
DELETE FROM `sync_state` WHERE `resource` LIKE 'pr:%' OR `resource` LIKE 'files:%';--> statement-breakpoint
ALTER TABLE `checks` ADD `position` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `position` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `pr_commits` ADD `position` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `pr_files` ADD `position` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `pr_files` ADD `patch_state` text NOT NULL;--> statement-breakpoint
ALTER TABLE `pr_files` ADD `patch_key` text;--> statement-breakpoint
ALTER TABLE `pr_labels` ADD `position` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `review_requests` ADD `position` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `review_threads` ADD `position` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `position` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `incomplete_cause` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `received` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `reported_total` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `upstream_limit` integer;
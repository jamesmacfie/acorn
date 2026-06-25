ALTER TABLE `pull_requests` ADD `mergeable` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `merge_state_status` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `auto_merge_enabled` integer DEFAULT false NOT NULL;
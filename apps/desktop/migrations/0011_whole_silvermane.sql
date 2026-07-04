CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`repo` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`path` text NOT NULL,
	`origin_session_id` text,
	`commit_sha` text,
	`superseded_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_accessed_at` integer,
	`access_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `memories_fts` USING fts5(`id` UNINDEXED, `name`, `description`, `body`, tokenize='porter');

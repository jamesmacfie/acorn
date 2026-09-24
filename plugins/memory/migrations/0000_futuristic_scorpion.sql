CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
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
CREATE TABLE `memory_promotion_receipts` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_revision` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`scope_json` text NOT NULL,
	`target_path_identity` text NOT NULL,
	`expected_base_hash` text,
	`device_id` text NOT NULL,
	`state` text NOT NULL,
	`target_reference` text,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_promotion_receipts_candidate_revision_unique` ON `memory_promotion_receipts` (`candidate_id`,`candidate_revision`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `memories_fts` USING fts5(`id` UNINDEXED, `name`, `description`, `body`, tokenize='porter');

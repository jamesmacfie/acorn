CREATE TABLE `finding_bundle_notices` (
	`bundle_id` text PRIMARY KEY NOT NULL,
	`emitted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finding_legacy_imports` (
	`legacy_id` text PRIMARY KEY NOT NULL,
	`source_filename` text NOT NULL,
	`source_hash` text NOT NULL,
	`status` text NOT NULL,
	`observation_id` text,
	`candidate_id` text,
	`candidate_revision` integer,
	`candidate_payload_hash` text,
	`one_to_one` integer DEFAULT false NOT NULL,
	`error` text,
	`imported_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finding_lifecycle_checkpoints` (
	`boundary_key` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_version` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`availability` text NOT NULL,
	`unavailable_reason` text,
	`completed_at` integer NOT NULL,
	`observation_id` text,
	`prepared_bundle_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finding_lifecycle_task_completed_idx` ON `finding_lifecycle_checkpoints` (`task_id`,`completed_at`);
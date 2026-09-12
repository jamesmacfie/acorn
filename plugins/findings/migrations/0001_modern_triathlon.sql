CREATE TABLE `finding_bundle_candidates` (
	`bundle_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`bundle_id`, `candidate_id`)
);
--> statement-breakpoint
CREATE TABLE `finding_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`task_id` text,
	`project_id` text,
	`workspace_id` text,
	`boundary_key` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`input_count` integer NOT NULL,
	`pending_count` integer NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_bundles_boundary_unique` ON `finding_bundles` (`scope_kind`,`task_id`,`project_id`,`workspace_id`,`boundary_key`);--> statement-breakpoint
CREATE TABLE `finding_candidate_observations` (
	`candidate_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`candidate_id`, `observation_id`)
);
--> statement-breakpoint
CREATE TABLE `finding_candidate_revisions` (
	`candidate_id` text NOT NULL,
	`revision` integer NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`candidate_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `finding_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_version` integer NOT NULL,
	`scope_kind` text NOT NULL,
	`task_id` text,
	`project_id` text,
	`workspace_id` text,
	`current_revision` integer NOT NULL,
	`status` text NOT NULL,
	`fingerprint` text NOT NULL,
	`subject_key` text NOT NULL,
	`grouping_explanation` text NOT NULL,
	`warnings_json` text NOT NULL,
	`base_target_id` text,
	`base_hash` text,
	`base_payload_json` text,
	`snoozed_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finding_candidates_scope_status_idx` ON `finding_candidates` (`scope_kind`,`task_id`,`project_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `finding_candidates_fingerprint_idx` ON `finding_candidates` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `finding_grouping_outcomes` (
	`bundle_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`outcome` text NOT NULL,
	`candidate_id` text,
	`explanation` text NOT NULL,
	PRIMARY KEY(`bundle_id`, `observation_id`)
);
--> statement-breakpoint
CREATE TABLE `finding_preparation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`boundary_key` text NOT NULL,
	`scope_key` text NOT NULL,
	`input_high_water_mark` integer NOT NULL,
	`state` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`attempt` integer NOT NULL,
	`backend_id` text,
	`input_count` integer NOT NULL,
	`output_count` integer NOT NULL,
	`error` text,
	`bundle_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_preparation_job_boundary_unique` ON `finding_preparation_jobs` (`scope_key`,`boundary_key`);--> statement-breakpoint
CREATE TABLE `finding_review_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_review_action_idempotency_unique` ON `finding_review_actions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `finding_review_action_candidate_idx` ON `finding_review_actions` (`candidate_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finding_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`subject_key` text,
	`reason` text,
	`actor_id` text NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
CREATE INDEX `finding_suppressions_lookup_idx` ON `finding_suppressions` (`scope_key`,`fingerprint`,`removed_at`);
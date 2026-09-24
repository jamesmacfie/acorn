CREATE TABLE `finding_bundle_candidates` (
	`bundle_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`bundle_id`, `candidate_id`)
);
--> statement-breakpoint
CREATE TABLE `finding_bundle_notices` (
	`bundle_id` text PRIMARY KEY NOT NULL,
	`emitted_at` integer NOT NULL
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
CREATE INDEX `finding_lifecycle_task_completed_idx` ON `finding_lifecycle_checkpoints` (`task_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `finding_preparation_inputs` (
	`job_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`job_id`, `observation_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_preparation_inputs_ordinal_unique` ON `finding_preparation_inputs` (`job_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `finding_preparation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`boundary_key` text NOT NULL,
	`scope_key` text NOT NULL,
	`input_high_water_mark` integer NOT NULL,
	`state` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`attempt` integer NOT NULL,
	`source_task_id` text,
	`target_kind` text DEFAULT 'memory:change' NOT NULL,
	`backend_id` text,
	`model_id` text,
	`usage_json` text,
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
CREATE TABLE `finding_scope_revisions` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
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
CREATE INDEX `finding_suppressions_lookup_idx` ON `finding_suppressions` (`scope_key`,`fingerprint`,`removed_at`);--> statement-breakpoint
CREATE TABLE `observation_withdrawals` (
	`observation_id` text PRIMARY KEY NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text,
	`withdrawn_at` integer NOT NULL,
	CONSTRAINT "observation_withdrawal_actor" CHECK("observation_withdrawals"."actor_kind" IN ('agent', 'device', 'plugin'))
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`task_id` text,
	`project_id` text,
	`workspace_id` text,
	`scope_labels_json` text NOT NULL,
	`origin_kind` text NOT NULL,
	`origin_json` text NOT NULL,
	`producer_id` text NOT NULL,
	`kind_id` text NOT NULL,
	`kind_version` integer NOT NULL,
	`kind_label` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`claim_status` text NOT NULL,
	`source_namespace` text NOT NULL,
	`source_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`evidence_json` text NOT NULL,
	`corrects_observation_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "observations_scope_shape" CHECK(
    ("observations"."scope_kind" = 'task' AND "observations"."task_id" IS NOT NULL AND "observations"."project_id" IS NOT NULL AND "observations"."workspace_id" IS NOT NULL)
    OR ("observations"."scope_kind" = 'project' AND "observations"."task_id" IS NULL AND "observations"."project_id" IS NOT NULL AND "observations"."workspace_id" IS NOT NULL)
    OR ("observations"."scope_kind" = 'workspace' AND "observations"."task_id" IS NULL AND "observations"."project_id" IS NULL AND "observations"."workspace_id" IS NOT NULL)
    OR ("observations"."scope_kind" = 'private' AND "observations"."task_id" IS NULL AND "observations"."project_id" IS NULL AND "observations"."workspace_id" IS NULL)
  ),
	CONSTRAINT "observations_claim_status" CHECK("observations"."claim_status" IN ('observed', 'inferred', 'asked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observations_source_key_unique` ON `observations` (`source_namespace`,`source_key`);--> statement-breakpoint
CREATE INDEX `observations_task_created_idx` ON `observations` (`task_id`,`created_at`,`id`);
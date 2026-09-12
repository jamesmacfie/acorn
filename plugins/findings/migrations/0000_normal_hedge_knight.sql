CREATE TABLE `finding_scope_revisions` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
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
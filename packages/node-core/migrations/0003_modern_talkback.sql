CREATE TABLE `dataset_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`complete` integer NOT NULL,
	`reason` text,
	`row_count` integer NOT NULL,
	`boundary_json` text
);
--> statement-breakpoint
CREATE INDEX `dataset_captures_dataset_idx` ON `dataset_captures` (`dataset_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `dataset_corrections` (
	`dataset_id` text NOT NULL,
	`identity` text NOT NULL,
	`value_json` text NOT NULL,
	`corrected_at` integer NOT NULL,
	PRIMARY KEY(`dataset_id`, `identity`)
);
--> statement-breakpoint
CREATE TABLE `dataset_coverage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dataset_id` text NOT NULL,
	`from_time` integer NOT NULL,
	`to_time` integer NOT NULL,
	`kind` text NOT NULL,
	`reason` text,
	`capture_id` text
);
--> statement-breakpoint
CREATE INDEX `dataset_coverage_dataset_time_idx` ON `dataset_coverage` (`dataset_id`,`from_time`,`to_time`);--> statement-breakpoint
CREATE TABLE `dataset_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dataset_id` text NOT NULL,
	`identity` text NOT NULL,
	`observation_time` integer NOT NULL,
	`event_time` integer,
	`arrived_at` integer NOT NULL,
	`removed_at` integer,
	`schema_version` integer NOT NULL,
	`data_json` text NOT NULL,
	`evidence_json` text,
	`reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dataset_rows_identity_observation_idx` ON `dataset_rows` (`dataset_id`,`identity`,`observation_time`);--> statement-breakpoint
CREATE INDEX `dataset_rows_time_idx` ON `dataset_rows` (`dataset_id`,`event_time`);--> statement-breakpoint
CREATE INDEX `dataset_rows_arrived_idx` ON `dataset_rows` (`dataset_id`,`arrived_at`);--> statement-breakpoint
CREATE TABLE `dataset_versions` (
	`dataset_id` text NOT NULL,
	`version` integer NOT NULL,
	`schema_json` text NOT NULL,
	`fields_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`dataset_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`feeder` text NOT NULL,
	`feeder_config` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`identity_fields` text NOT NULL,
	`event_time_field` text,
	`backfill_from` integer,
	`checkpoint` text,
	`retention_days` integer NOT NULL,
	`max_rows` integer NOT NULL,
	`max_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `datasets_workspace_idx` ON `datasets` (`workspace_id`,`project_id`);
CREATE TABLE `workflow_trigger_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_id` text NOT NULL,
	`record_key` text,
	`generation` integer NOT NULL,
	`kind` text NOT NULL,
	`due_at` integer,
	`request_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`payload_json` text NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_trigger_occurrences_request_uq` ON `workflow_trigger_occurrences` (`trigger_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_trigger_occurrences_due_uq` ON `workflow_trigger_occurrences` (`trigger_id`,`generation`,`due_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_trigger_occurrences_task_uq` ON `workflow_trigger_occurrences` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_trigger_occurrences_run_uq` ON `workflow_trigger_occurrences` (`run_id`);--> statement-breakpoint
CREATE INDEX `workflow_trigger_occurrences_state_idx` ON `workflow_trigger_occurrences` (`trigger_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workflow_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduler_key` text,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`when_json` text NOT NULL,
	`inputs_json` text NOT NULL,
	`limits_json` text NOT NULL,
	`loops_json` text DEFAULT '[]' NOT NULL,
	`approved_graph_json` text,
	`approved_graph_digest` text,
	`generation` integer DEFAULT 0 NOT NULL,
	`epoch` text NOT NULL,
	`state` text NOT NULL,
	`first_check` text DEFAULT 'process-current' NOT NULL,
	`error` text,
	`error_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_triggers_scheduler_key_unique` ON `workflow_triggers` (`scheduler_key`);--> statement-breakpoint
CREATE INDEX `workflow_triggers_project_idx` ON `workflow_triggers` (`project_id`,`updated_at`);--> statement-breakpoint
INSERT INTO `workflow_trigger_occurrences` (`id`, `trigger_id`, `record_key`, `generation`, `kind`, `due_at`, `request_key`, `payload_fingerprint`, `payload_json`, `task_id`, `run_id`, `state`, `detail`, `created_at`, `updated_at`) SELECT `id`, `schedule_id`, NULL, `generation`, `kind`, `due_at`, `request_key`, `payload_fingerprint`, `payload_json`, `task_id`, `run_id`, `state`, `detail`, `created_at`, `updated_at` FROM `workflow_schedule_occurrences`;--> statement-breakpoint
INSERT INTO `workflow_triggers` (`id`, `scheduler_key`, `workspace_id`, `project_id`, `workflow_id`, `when_json`, `inputs_json`, `limits_json`, `loops_json`, `approved_graph_json`, `approved_graph_digest`, `generation`, `epoch`, `state`, `first_check`, `error`, `error_reason`, `created_at`, `updated_at`) SELECT `id`, `scheduler_key`, `workspace_id`, `project_id`, `workflow_id`, json_object('kind', 'clock', 'timezone', `timezone`), `inputs_json`, `limits_json`, `loops_json`, `approved_graph_json`, `approved_graph_digest`, `generation`, `epoch`, `state`, `first_check`, `error`, NULL, `created_at`, `updated_at` FROM `workflow_schedules`;--> statement-breakpoint
DROP TABLE `workflow_schedule_occurrences`;--> statement-breakpoint
DROP TABLE `workflow_schedules`;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `error_cause` text;--> statement-breakpoint
UPDATE `workflow_runs` SET `started_by` = 'trigger' WHERE `started_by` = 'schedule';--> statement-breakpoint
UPDATE `workflow_runs` SET `trigger_id` = (SELECT `trigger_id` FROM `workflow_trigger_occurrences` WHERE `workflow_trigger_occurrences`.`run_id` = `workflow_runs`.`id`) WHERE `id` IN (SELECT `run_id` FROM `workflow_trigger_occurrences`);

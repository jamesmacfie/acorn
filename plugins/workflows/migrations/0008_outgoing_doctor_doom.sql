CREATE TABLE `workflow_schedule_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
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
CREATE UNIQUE INDEX `workflow_schedule_occurrences_request_uq` ON `workflow_schedule_occurrences` (`schedule_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedule_occurrences_due_uq` ON `workflow_schedule_occurrences` (`schedule_id`,`generation`,`due_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedule_occurrences_task_uq` ON `workflow_schedule_occurrences` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedule_occurrences_run_uq` ON `workflow_schedule_occurrences` (`run_id`);--> statement-breakpoint
CREATE INDEX `workflow_schedule_occurrences_state_idx` ON `workflow_schedule_occurrences` (`schedule_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workflow_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`inputs_json` text NOT NULL,
	`timezone` text NOT NULL,
	`limits_json` text NOT NULL,
	`approved_graph_json` text,
	`approved_graph_digest` text,
	`generation` integer DEFAULT 0 NOT NULL,
	`epoch` text NOT NULL,
	`state` text NOT NULL,
	`first_check` text DEFAULT 'process-current' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_schedules_project_idx` ON `workflow_schedules` (`project_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `workflow_processing_scopes` ADD `baseline` integer DEFAULT false NOT NULL;
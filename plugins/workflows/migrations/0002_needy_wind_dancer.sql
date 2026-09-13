CREATE TABLE `workflow_dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`caller_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`payload_json` text NOT NULL,
	`parent_task_id` text NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`root_run_id` text NOT NULL,
	`parent_run_id` text NOT NULL,
	`parent_step_id` text NOT NULL,
	`item_key` text,
	`state` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_dispatches_caller_key_uq` ON `workflow_dispatches` (`caller_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_dispatches_task_id_uq` ON `workflow_dispatches` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_dispatches_run_id_uq` ON `workflow_dispatches` (`run_id`);--> statement-breakpoint
CREATE INDEX `workflow_dispatches_state_updated_idx` ON `workflow_dispatches` (`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workflow_dispatches_root_created_idx` ON `workflow_dispatches` (`root_run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_dispatches_parent_step_idx` ON `workflow_dispatches` (`parent_step_id`);--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `root_run_id` text;--> statement-breakpoint
UPDATE `workflow_runs` SET `root_run_id` = `id` WHERE `root_run_id` IS NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `parent_run_id` text;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `parent_step_id` text;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `depth` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `invocation_key` text;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `payload_fingerprint` text;--> statement-breakpoint
CREATE INDEX `workflow_runs_root_created_idx` ON `workflow_runs` (`root_run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_parent_created_idx` ON `workflow_runs` (`parent_run_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_runs_invocation_key_uq` ON `workflow_runs` (`invocation_key`);

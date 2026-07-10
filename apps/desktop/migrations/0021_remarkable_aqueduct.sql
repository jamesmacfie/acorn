CREATE INDEX `workflow_runs_task_created_idx` ON `workflow_runs` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_status_idx` ON `workflow_runs` (`status`);--> statement-breakpoint
CREATE INDEX `workflow_steps_run_idx_idx` ON `workflow_steps` (`run_id`,`idx`);--> statement-breakpoint
CREATE INDEX `workflow_steps_parent_created_idx` ON `workflow_steps` (`parent_step_id`,`created_at`);
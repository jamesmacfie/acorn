CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`posture` text DEFAULT 'gated' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`def_json` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_runs_task_created_idx` ON `workflow_runs` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_status_idx` ON `workflow_runs` (`status`);--> statement-breakpoint
CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`idx` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'agent' NOT NULL,
	`mode` text DEFAULT 'headless' NOT NULL,
	`profile_id` text,
	`model` text,
	`status` text NOT NULL,
	`worktree_path` text,
	`inputs_json` text,
	`result_json` text,
	`structured_json` text,
	`session_id` text,
	`agent_session_id` text,
	`cost_usd` real,
	`iteration` integer DEFAULT 0 NOT NULL,
	`parent_step_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_steps_run_idx_idx` ON `workflow_steps` (`run_id`,`idx`);--> statement-breakpoint
CREATE INDEX `workflow_steps_parent_created_idx` ON `workflow_steps` (`parent_step_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_steps_agent_session_idx` ON `workflow_steps` (`agent_session_id`);
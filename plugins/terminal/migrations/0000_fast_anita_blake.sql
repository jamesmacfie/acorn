CREATE TABLE `terminal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`profile_id` text NOT NULL,
	`backend` text NOT NULL,
	`status` text NOT NULL,
	`cwd` text NOT NULL,
	`task_id` text NOT NULL,
	`command` text NOT NULL,
	`argv_json` text DEFAULT '[]' NOT NULL,
	`tmux_session` text,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`agent_session_id` text,
	`created_at` integer NOT NULL,
	`exited_at` integer,
	`exit_code` integer
);
--> statement-breakpoint
CREATE INDEX `terminal_sessions_task_idx` ON `terminal_sessions` (`task_id`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_agent_session_idx` ON `terminal_sessions` (`agent_session_id`);
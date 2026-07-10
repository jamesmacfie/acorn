CREATE TABLE `config_acks` (
	`repo` text NOT NULL,
	`hash` text NOT NULL,
	`snapshot` text NOT NULL,
	`acked_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `hash`)
);
--> statement-breakpoint
CREATE INDEX `config_acks_repo_acked_idx` ON `config_acks` (`repo`,`acked_at`);--> statement-breakpoint
CREATE INDEX `pull_requests_user_repo_state_updated_idx` ON `pull_requests` (`user_id`,`repo_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_task_idx` ON `terminal_sessions` (`task_id`);
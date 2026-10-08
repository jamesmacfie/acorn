ALTER TABLE `agent_sessions` ADD `goal_objective` text;
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `goal_status` text;
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `goal_continuations` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `goal_no_progress` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `goal_verdict_json` text;

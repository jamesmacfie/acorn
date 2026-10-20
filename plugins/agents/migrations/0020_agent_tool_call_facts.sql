CREATE TABLE `agent_tool_call_facts` (
	`turn_id` text NOT NULL,
	`seq` integer NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text,
	`provider` text NOT NULL,
	`tool` text,
	`status` text NOT NULL,
	`exit_code` integer,
	`failed` integer NOT NULL,
	`in_subagent` integer NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer,
	PRIMARY KEY(`turn_id`, `seq`)
);
--> statement-breakpoint
CREATE INDEX `agent_tool_call_facts_task_started_idx` ON `agent_tool_call_facts` (`task_id`,`started_at`);
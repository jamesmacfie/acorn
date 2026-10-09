CREATE TABLE `workflow_agent_launches` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text NOT NULL,
	`caller_title` text NOT NULL,
	`caller_turn_id` text,
	`policy_id` text NOT NULL,
	`definition_key` text NOT NULL,
	`graph_digest` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`graph_json` text NOT NULL,
	`effective_json` text NOT NULL,
	`state` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_agent_launches_key_uq` ON `workflow_agent_launches` (`key`);--> statement-breakpoint
CREATE INDEX `workflow_agent_launches_session_idx` ON `workflow_agent_launches` (`session_id`,`policy_id`);--> statement-breakpoint
CREATE INDEX `workflow_agent_launches_state_idx` ON `workflow_agent_launches` (`state`);--> statement-breakpoint
CREATE TABLE `workflow_invocation_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`definition_key` text NOT NULL,
	`definition_digest` text NOT NULL,
	`graph_digest` text NOT NULL,
	`dependencies_json` text NOT NULL,
	`caller_inputs_json` text NOT NULL,
	`fixed_inputs_json` text NOT NULL,
	`limits_json` text NOT NULL,
	`starts_per_session` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_invocation_policies_target_uq` ON `workflow_invocation_policies` (`project_id`,`definition_key`);--> statement-breakpoint
CREATE TABLE `workflow_tool_calls` (
	`key` text PRIMARY KEY NOT NULL,
	`tool` text NOT NULL,
	`session_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`definition_id` text NOT NULL,
	`state` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `workflow_defs` ADD `agent_origin_json` text;
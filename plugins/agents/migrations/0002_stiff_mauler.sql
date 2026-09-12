CREATE TABLE `agent_spawns` (
	`id` text PRIMARY KEY NOT NULL,
	`root_task_id` text NOT NULL,
	`root_session_id` text NOT NULL,
	`owner_task_id` text NOT NULL,
	`owner_session_id` text NOT NULL,
	`parent_spawn_id` text,
	`child_task_id` text NOT NULL,
	`child_session_id` text,
	`child_turn_id` text,
	`depth` integer NOT NULL,
	`isolation` text NOT NULL,
	`provisioning_state` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_spawns_owner_session_idx` ON `agent_spawns` (`owner_session_id`);--> statement-breakpoint
CREATE INDEX `agent_spawns_child_session_idx` ON `agent_spawns` (`child_session_id`);--> statement-breakpoint
CREATE INDEX `agent_spawns_root_state_idx` ON `agent_spawns` (`root_task_id`,`root_session_id`,`provisioning_state`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_spawns_owner_idempotency_idx` ON `agent_spawns` (`owner_task_id`,`owner_session_id`,`idempotency_key`);
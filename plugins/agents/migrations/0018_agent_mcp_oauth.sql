CREATE TABLE `agent_mcp_oauth` (
	`name` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`state_json` text NOT NULL,
	`status` text NOT NULL,
	`signed_in_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

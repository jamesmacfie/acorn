CREATE TABLE `agent_mcp_servers` (
	`name` text PRIMARY KEY NOT NULL,
	`config_json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

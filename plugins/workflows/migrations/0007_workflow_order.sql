CREATE TABLE `workflow_order` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`ids_json` text NOT NULL,
	`updated_at` integer NOT NULL
);

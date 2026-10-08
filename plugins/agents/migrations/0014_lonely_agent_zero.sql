CREATE TABLE `agent_instruction_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`digest` text NOT NULL,
	`scope` text NOT NULL,
	`analyzer_version` integer NOT NULL,
	`files_json` text NOT NULL,
	`body_enc` text NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_instruction_snapshots_project_idx` ON `agent_instruction_snapshots` (`project_id`,`created_at`);

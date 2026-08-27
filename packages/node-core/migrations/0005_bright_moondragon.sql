PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `workspace_external_projects` RENAME TO `workspace_external_projects_old`;--> statement-breakpoint
CREATE TABLE `workspace_external_projects` (
	`workspace_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`external_id` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `integration_id`, `external_id`, `project_id`)
);--> statement-breakpoint
INSERT INTO `workspace_external_projects` (`workspace_id`, `integration_id`, `external_id`, `project_id`, `created_at`)
SELECT `workspace_id`, `integration_id`, `external_id`, '', `created_at` FROM `workspace_external_projects_old`;--> statement-breakpoint
DROP TABLE `workspace_external_projects_old`;--> statement-breakpoint
PRAGMA foreign_keys=ON;

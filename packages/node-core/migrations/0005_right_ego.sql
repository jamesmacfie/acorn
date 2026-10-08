CREATE TABLE `workspace_icon_images` (
	`id` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `appearance` text;
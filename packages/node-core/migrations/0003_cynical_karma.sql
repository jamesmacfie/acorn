ALTER TABLE `projects` ADD `color` text;--> statement-breakpoint
UPDATE `projects`
SET `color` = (
	SELECT `workspaces`.`color`
	FROM `workspaces`
	WHERE `workspaces`.`id` = `projects`.`workspace_id`
)
WHERE `color` IS NULL;--> statement-breakpoint
ALTER TABLE `workspaces` DROP COLUMN `icon`;--> statement-breakpoint
ALTER TABLE `workspaces` DROP COLUMN `color`;

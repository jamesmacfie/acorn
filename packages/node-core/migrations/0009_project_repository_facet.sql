ALTER TABLE `projects` ADD `repo_provider` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_host` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_path` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_external_id` text;--> statement-breakpoint
CREATE INDEX `projects_repo_idx` ON `projects` (`repo_path`);--> statement-breakpoint
UPDATE `projects` SET
  `repo_provider` = 'github',
  `repo_host` = 'github.com',
  `repo_path` = lower(`github_owner`) || '/' || lower(`github_name`),
  `repo_external_id` = CAST(`github_repo_id` AS TEXT)
WHERE `github_owner` IS NOT NULL AND `github_name` IS NOT NULL;

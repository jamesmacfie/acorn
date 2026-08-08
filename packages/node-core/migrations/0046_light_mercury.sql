CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`workspace_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`vcs` text,
	`default_branch` text,
	`remote_url` text,
	`github_owner` text,
	`github_name` text,
	`github_repo_id` integer,
	`run_targets` text,
	`editor_command` text,
	`setup_script` text,
	`setup_script_trigger` text,
	`dev_script` text,
	`dev_restart_script` text,
	`teardown_script` text,
	`db_url_script` text,
	`db_schema_mode` text,
	`db_schema_value` text,
	`db_schema_notes` text,
	`preview_mode` text,
	`preview_value` text,
	`browser_rules` text,
	`branch_prefix` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_workspace_idx` ON `projects` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `projects_github_idx` ON `projects` (`github_owner`,`github_name`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_id` text;--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `name`, `is_default`, `sort`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), 'Default', 1, 0, strftime('%s','now')*1000, strftime('%s','now')*1000
WHERE NOT EXISTS (SELECT 1 FROM `workspaces` WHERE `is_default` = 1)
  AND (EXISTS (SELECT 1 FROM `repo_paths`) OR EXISTS (SELECT 1 FROM `workspace_repos`) OR EXISTS (SELECT 1 FROM `tasks`));--> statement-breakpoint
INSERT INTO `projects` (`id`, `name`, `path`, `workspace_id`, `sort`, `hidden`, `vcs`, `github_owner`, `github_name`, `github_repo_id`,
  `run_targets`, `editor_command`, `setup_script`, `setup_script_trigger`, `dev_script`, `dev_restart_script`, `teardown_script`,
  `db_url_script`, `db_schema_mode`, `db_schema_value`, `db_schema_notes`, `preview_mode`, `preview_value`, `browser_rules`, `branch_prefix`,
  `created_at`, `updated_at`)
-- The display name is lower(repo) to match what createProject mints today: its name falls back to the
-- github facet, which is already normalized. The task-derived insert below was lowercase either way, so
-- without this the same repo got a different name depending on which legacy row it was projected from.
SELECT lower(hex(randomblob(16))), lower(rp.`repo`), rp.`path`,
  COALESCE(wr.`workspace_id`, (SELECT `id` FROM `workspaces` WHERE `is_default` = 1 LIMIT 1)),
  COALESCE(wr.`sort`, 0),
  CASE WHEN ig.`owner` IS NOT NULL THEN 1 ELSE 0 END,
  'git', lower(rp.`owner`), lower(rp.`repo`), rp.`github_repo_id`,
  rp.`run_targets`, rp.`editor_command`, rp.`setup_script`, rp.`setup_script_trigger`, rp.`dev_script`, rp.`dev_restart_script`, rp.`teardown_script`,
  rp.`db_url_script`, rp.`db_schema_mode`, rp.`db_schema_value`, rp.`db_schema_notes`, rp.`preview_mode`, rp.`preview_value`, rp.`browser_rules`, rp.`branch_prefix`,
  rp.`created_at`, rp.`updated_at`
FROM `repo_paths` rp
LEFT JOIN `workspace_repos` wr ON lower(wr.`repo_owner`) = lower(rp.`owner`) AND lower(wr.`repo_name`) = lower(rp.`repo`)
LEFT JOIN `ignored_repos` ig ON lower(ig.`owner`) = lower(rp.`owner`) AND lower(ig.`repo`) = lower(rp.`repo`);--> statement-breakpoint
INSERT INTO `projects` (`id`, `name`, `path`, `workspace_id`, `sort`, `hidden`, `github_owner`, `github_name`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), lower(wr.`repo_name`), NULL, wr.`workspace_id`, wr.`sort`,
  CASE WHEN ig.`owner` IS NOT NULL THEN 1 ELSE 0 END,
  lower(wr.`repo_owner`), lower(wr.`repo_name`), wr.`created_at`, wr.`created_at`
FROM `workspace_repos` wr
LEFT JOIN `repo_paths` rp ON lower(rp.`owner`) = lower(wr.`repo_owner`) AND lower(rp.`repo`) = lower(wr.`repo_name`)
LEFT JOIN `ignored_repos` ig ON lower(ig.`owner`) = lower(wr.`repo_owner`) AND lower(ig.`repo`) = lower(wr.`repo_name`)
WHERE rp.`owner` IS NULL;--> statement-breakpoint
INSERT INTO `projects` (`id`, `name`, `path`, `workspace_id`, `sort`, `hidden`, `github_owner`, `github_name`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), t.`repo_name`, NULL,
  (SELECT `id` FROM `workspaces` WHERE `is_default` = 1 LIMIT 1), 0, 0,
  lower(t.`repo_owner`), lower(t.`repo_name`), strftime('%s','now')*1000, strftime('%s','now')*1000
FROM (SELECT DISTINCT lower(`repo_owner`) AS `repo_owner`, lower(`repo_name`) AS `repo_name` FROM `tasks`) t
WHERE NOT EXISTS (SELECT 1 FROM `projects` p WHERE lower(p.`github_owner`) = lower(t.`repo_owner`) AND lower(p.`github_name`) = lower(t.`repo_name`));--> statement-breakpoint
UPDATE `tasks` SET `project_id` = (
  SELECT p.`id` FROM `projects` p
  WHERE lower(p.`github_owner`) = lower(`tasks`.`repo_owner`) AND lower(p.`github_name`) = lower(`tasks`.`repo_name`)
  ORDER BY p.`created_at`, p.`id` LIMIT 1
);

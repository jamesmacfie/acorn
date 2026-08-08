PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Re-key trust by the project selected by the same oldest-project rule used by the
-- project lookup seam. The hash and snapshot are copied as TEXT without normalization.
CREATE TABLE `__new_config_acks` (
	`project_id` text,
	`hash` text NOT NULL,
	`snapshot` text NOT NULL,
	`acked_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `hash`)
);--> statement-breakpoint
INSERT INTO `__new_config_acks` (`project_id`, `hash`, `snapshot`, `acked_at`)
SELECT (
	SELECT p.`id`
	FROM `projects` p
  WHERE lower(p.`github_owner` || '/' || p.`github_name`) = lower(a.`repo`)
	ORDER BY p.`created_at`, p.`id`
	LIMIT 1
), a.`hash`, a.`snapshot`, a.`acked_at`
FROM `config_acks` a;--> statement-breakpoint
DROP TABLE `config_acks`;--> statement-breakpoint
ALTER TABLE `__new_config_acks` RENAME TO `config_acks`;--> statement-breakpoint
CREATE INDEX `config_acks_project_acked_idx` ON `config_acks` (`project_id`, `acked_at`);--> statement-breakpoint
-- All task rows were project-backed by 0046/0047. Make that invariant physical now that
-- the legacy GitHub pair is no longer available as a fallback.
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`icon` text,
	`origin` text NOT NULL,
	`project_id` text NOT NULL,
	`branch` text,
	`worktree_path` text,
	`pull_number` integer,
	`status` text NOT NULL,
	`parent_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);--> statement-breakpoint
INSERT INTO `__new_tasks` (`id`, `title`, `icon`, `origin`, `project_id`, `branch`, `worktree_path`, `pull_number`, `status`, `parent_id`, `sort`, `created_at`, `updated_at`, `archived_at`)
SELECT `id`, `title`, `icon`, `origin`, `project_id`, `branch`, `worktree_path`, `pull_number`, `status`, `parent_id`, `sort`, `created_at`, `updated_at`, `archived_at`
FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
DROP TABLE `repo_paths`;--> statement-breakpoint
DROP TABLE `workspace_repos`;--> statement-breakpoint
DROP TABLE `ignored_repos`;--> statement-breakpoint
ALTER TABLE `workspace_projects` RENAME TO `workspace_external_projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;

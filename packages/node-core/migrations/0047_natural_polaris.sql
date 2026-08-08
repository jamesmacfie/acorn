PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`icon` text,
	`origin` text NOT NULL,
	`project_id` text,
	`repo_owner` text,
	`repo_name` text,
	`branch` text,
	`worktree_path` text,
	`pull_number` integer,
	`status` text NOT NULL,
	`parent_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "title", "icon", "origin", "project_id", "repo_owner", "repo_name", "branch", "worktree_path", "pull_number", "status", "parent_id", "sort", "created_at", "updated_at", "archived_at") SELECT "id", "title", "icon", "origin", "project_id", "repo_owner", "repo_name", "branch", "worktree_path", "pull_number", "status", "parent_id", "sort", "created_at", "updated_at", "archived_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- Canonicalize facets created by 0046 and any mixed-case legacy rows before the remaining pair-key
-- bridges run. GitHub owner/repository identity is case-insensitive.
UPDATE `projects`
SET `github_owner` = lower(`github_owner`), `github_name` = lower(`github_name`)
WHERE `github_owner` IS NOT NULL OR `github_name` IS NOT NULL;
--> statement-breakpoint
-- A pre-Phase-2 `use-checkout` task borrowed its mapped checkout by storing that absolute
-- checkout path in worktree_path. Branch is no longer the signal for that mode: the owning
-- project's path is. Keep the historical path for archive safety, but make the task branchless.
UPDATE `tasks`
SET `branch` = NULL
WHERE `worktree_path` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `projects` p
    WHERE p.`path` = `tasks`.`worktree_path`
      AND (
        p.`id` = `tasks`.`project_id`
        OR (`tasks`.`project_id` IS NULL AND lower(p.`github_owner`) = lower(`tasks`.`repo_owner`) AND lower(p.`github_name`) = lower(`tasks`.`repo_name`))
      )
  );
--> statement-breakpoint
-- Base-ref preferences move from the legacy GitHub pair to the project identity. When multiple
-- clones share a pair, the oldest project is the deterministic bridge used by projectByGithub.
INSERT OR IGNORE INTO `prefs` (`user_id`, `key`, `value`)
SELECT old.`user_id`, 'base_ref:' || p.`id`, old.`value`
FROM `prefs` old
JOIN `projects` p
  ON lower(old.`key`) = 'base_ref:' || lower(p.`github_owner`) || '/' || lower(p.`github_name`)
WHERE p.`id` = (
  SELECT oldest.`id`
  FROM `projects` oldest
    WHERE lower(oldest.`github_owner`) = lower(p.`github_owner`)
    AND lower(oldest.`github_name`) = lower(p.`github_name`)
  ORDER BY oldest.`created_at`, oldest.`id`
  LIMIT 1
);
--> statement-breakpoint
DELETE FROM `prefs`
WHERE `key` LIKE 'base_ref:%/%'
  AND EXISTS (
    SELECT 1
    FROM `projects` p
    WHERE lower(`key`) = 'base_ref:' || lower(p.`github_owner`) || '/' || lower(p.`github_name`)
  );

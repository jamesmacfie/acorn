CREATE TABLE `task_change_requests` (
	`task_id` text NOT NULL,
	`provider` text NOT NULL,
	`repo_host` text NOT NULL,
	`repo_path` text NOT NULL,
	`number` integer NOT NULL,
	`role` text NOT NULL,
	`provenance` text NOT NULL,
	`source_branch` text,
	`session_id` text,
	`request_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `repo_host`, `repo_path`, `number`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_change_requests_one_primary_idx` ON `task_change_requests` (`task_id`) WHERE "task_change_requests"."role" = 'primary';--> statement-breakpoint
INSERT INTO `task_change_requests`
  (`task_id`, `provider`, `repo_host`, `repo_path`, `number`, `role`, `provenance`, `session_id`, `request_id`, `created_at`)
SELECT `task_id`, 'github', 'github.com', `repo_path`, `pull_number`, `role`, 'agent', `session_id`, `request_id`, `created_at`
FROM (
  -- Older rows can spell one repository in two cases, which lowercase to one key. Keep one row per key:
  -- the one that held the primary slot, else the oldest.
  SELECT
    tp.`task_id`,
    lower(tp.`repo_owner`) || '/' || lower(tp.`repo_name`) AS `repo_path`,
    tp.`pull_number`,
    CASE
      WHEN t.`pull_number` = tp.`pull_number`
        AND p.`repo_host` = 'github.com'
        AND p.`repo_path` = lower(tp.`repo_owner`) || '/' || lower(tp.`repo_name`)
      THEN 'primary'
      ELSE 'related'
    END AS `role`,
    tp.`session_id`,
    tp.`request_id`,
    tp.`created_at`,
    row_number() OVER (
      PARTITION BY tp.`task_id`, lower(tp.`repo_owner`), lower(tp.`repo_name`), tp.`pull_number`
      ORDER BY tp.`role` = 'primary' DESC, tp.`created_at`, tp.`rowid`
    ) AS `keep`
  FROM `task_pulls` tp
  JOIN `tasks` t ON t.`id` = tp.`task_id`
  LEFT JOIN `projects` p ON p.`id` = t.`project_id`
)
WHERE `keep` = 1;
--> statement-breakpoint
INSERT INTO `task_change_requests`
  (`task_id`, `provider`, `repo_host`, `repo_path`, `number`, `role`, `provenance`, `created_at`)
SELECT
  t.`id`,
  coalesce(p.`repo_provider`, ''),
  coalesce(p.`repo_host`, ''),
  coalesce(p.`repo_path`, ''),
  t.`pull_number`,
  'primary',
  'task',
  t.`created_at`
FROM `tasks` t
LEFT JOIN `projects` p ON p.`id` = t.`project_id`
WHERE t.`pull_number` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `task_change_requests` cr WHERE cr.`task_id` = t.`id` AND cr.`role` = 'primary'
  );

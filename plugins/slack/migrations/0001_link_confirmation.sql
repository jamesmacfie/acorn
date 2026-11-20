-- A link recorded before a paired device had to confirm it is dropped. Settings → Slack offers it again
-- to confirm. The threads and picks made under it end, and their empty link ID never matches a new link.
DELETE FROM `slack_links`;--> statement-breakpoint
DELETE FROM `slack_pending`;--> statement-breakpoint
UPDATE `slack_threads` SET `ended` = 1;--> statement-breakpoint
ALTER TABLE `slack_links` ADD `link_id` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `slack_pending` ADD `link_id` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `slack_threads` ADD `link_id` text NOT NULL DEFAULT '';

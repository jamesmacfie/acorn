CREATE TABLE `data_feed_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plugin_id` text NOT NULL,
	`source_id` text NOT NULL,
	`event_id` text NOT NULL,
	`time` integer NOT NULL,
	`data_json` text NOT NULL,
	`title` text,
	`url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_feed_events_identity` ON `data_feed_events` (`plugin_id`,`source_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `data_feed_events_feed_seq` ON `data_feed_events` (`plugin_id`,`source_id`,`seq`);
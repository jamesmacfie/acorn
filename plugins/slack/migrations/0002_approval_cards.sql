CREATE TABLE `slack_cards` (
	`request_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`team_id` text NOT NULL,
	`link_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_ts` text NOT NULL,
	`answered` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_cards_message_idx` ON `slack_cards` (`team_id`,`channel_id`,`message_ts`);--> statement-breakpoint
CREATE INDEX `slack_cards_thread_idx` ON `slack_cards` (`thread_id`);
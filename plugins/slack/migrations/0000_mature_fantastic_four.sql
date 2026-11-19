CREATE TABLE `slack_channel_tasks` (
	`team_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`team_id`, `channel_id`, `project_id`)
);
--> statement-breakpoint
CREATE TABLE `slack_channels` (
	`team_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`name` text,
	`project_id` text,
	`mode` text,
	PRIMARY KEY(`team_id`, `channel_id`)
);
--> statement-breakpoint
CREATE TABLE `slack_links` (
	`team_id` text PRIMARY KEY NOT NULL,
	`team_name` text NOT NULL,
	`slack_user_id` text NOT NULL,
	`slack_user_name` text NOT NULL,
	`approvals` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack_messages` (
	`team_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`ts` text NOT NULL,
	`thread_id` text,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`text` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`turn_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`team_id`, `channel_id`, `ts`)
);
--> statement-breakpoint
CREATE INDEX `slack_messages_thread_idx` ON `slack_messages` (`thread_id`,`status`);--> statement-breakpoint
CREATE TABLE `slack_pending` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`ts` text NOT NULL,
	`event` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack_thread_sessions` (
	`thread_id` text NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `session_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_thread_sessions_session_idx` ON `slack_thread_sessions` (`session_id`);--> statement-breakpoint
CREATE TABLE `slack_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`thread_ts` text NOT NULL,
	`task_id` text NOT NULL,
	`mode` text NOT NULL,
	`ended` integer DEFAULT false NOT NULL,
	`noted_guests` text DEFAULT '[]' NOT NULL,
	`history` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `slack_threads_slack_idx` ON `slack_threads` (`team_id`,`channel_id`,`thread_ts`);--> statement-breakpoint
CREATE TABLE `slack_turns` (
	`turn_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_ts` text,
	`status_ts` text,
	`reaction` text,
	`started_at` integer NOT NULL,
	`posted` integer DEFAULT false NOT NULL,
	`answer_ts` text
);
--> statement-breakpoint
CREATE INDEX `slack_turns_posted_idx` ON `slack_turns` (`posted`);
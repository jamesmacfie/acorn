CREATE TABLE `agent_webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`response_status` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`delivered_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_webhook_deliveries_event_idx` ON `agent_webhook_deliveries` (`webhook_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `agent_webhook_deliveries_due_idx` ON `agent_webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `agent_webhook_deliveries_created_idx` ON `agent_webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`url` text NOT NULL,
	`events_json` text NOT NULL,
	`secret_enc` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_webhooks_task_enabled_idx` ON `agent_webhooks` (`task_id`,`enabled`);
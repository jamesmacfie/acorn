DROP TABLE `agent_artifacts`;--> statement-breakpoint
DROP TABLE `agent_attachment_refs`;--> statement-breakpoint
DROP TABLE `agent_attachments`;--> statement-breakpoint
DROP TABLE `agent_events`;--> statement-breakpoint
DROP TABLE `agent_operations`;--> statement-breakpoint
DROP TABLE `agent_requests`;--> statement-breakpoint
DROP TABLE `agent_sessions`;--> statement-breakpoint
DROP TABLE `agent_turns`;--> statement-breakpoint
DROP TABLE `agent_webhook_deliveries`;--> statement-breakpoint
DROP TABLE `agent_webhooks`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `agent_events_fts_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `agent_events_fts_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `agent_events_fts_delete`;--> statement-breakpoint
DROP TABLE IF EXISTS `agent_events_fts`;

ALTER TABLE `agent_sessions` ADD `last_event_at` integer;--> statement-breakpoint
-- A session that already has events gets `updated_at` as its best guess. It overshoots only where the
-- last write was a read, rename or controller change.
UPDATE `agent_sessions` SET `last_event_at` = `updated_at` WHERE `last_event_seq` > 0;

-- The ledger and its dirty marker commit together, including writes outside AgentStore.
-- FTS triggers from 0005 still project standalone inserts and explicit search_text changes.
CREATE TABLE `agent_search_dirty` (`session_id` text PRIMARY KEY NOT NULL, `from_seq` integer NOT NULL);--> statement-breakpoint
INSERT INTO `agent_search_dirty` SELECT DISTINCT `session_id`, 0 FROM `agent_events`;--> statement-breakpoint
CREATE TRIGGER `agent_search_insert` AFTER INSERT ON `agent_events`
BEGIN
  INSERT INTO `agent_search_dirty` VALUES (NEW.`session_id`, NEW.`seq`)
  ON CONFLICT (`session_id`) DO UPDATE SET `from_seq` = min(`from_seq`, NEW.`seq`);
END;--> statement-breakpoint
CREATE TRIGGER `agent_search_update` AFTER UPDATE OF `event_json`, `seq`, `turn_id`, `session_id` ON `agent_events`
BEGIN
  INSERT INTO `agent_search_dirty` VALUES (OLD.`session_id`, OLD.`seq`)
  ON CONFLICT (`session_id`) DO UPDATE SET `from_seq` = min(`from_seq`, OLD.`seq`);
  INSERT INTO `agent_search_dirty` VALUES (NEW.`session_id`, NEW.`seq`)
  ON CONFLICT (`session_id`) DO UPDATE SET `from_seq` = min(`from_seq`, NEW.`seq`);
END;--> statement-breakpoint
CREATE TRIGGER `agent_search_delete` AFTER DELETE ON `agent_events`
BEGIN
  INSERT INTO `agent_search_dirty` VALUES (OLD.`session_id`, OLD.`seq`)
  ON CONFLICT (`session_id`) DO UPDATE SET `from_seq` = min(`from_seq`, OLD.`seq`);
END;--> statement-breakpoint
CREATE TRIGGER `agent_search_session_delete` AFTER DELETE ON `agent_sessions`
BEGIN
  DELETE FROM `agent_search_dirty` WHERE `session_id` = OLD.`id`;
END;

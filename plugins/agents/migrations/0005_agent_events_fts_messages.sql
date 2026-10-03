-- Index each assistant or reasoning message once instead of each streamed fragment, and put tool text in
-- its own column so it can rank below the conversation (docs/managed-agents/transcript-search.md § Tool rows).
--
-- A streamed message is a run of `append` events in one session, consecutive by seq, with the same type,
-- turn and message id: the same test DurableAgentEventBuffer uses to coalesce them. The first event of
-- the run keeps the whole message as its search text and the rest keep none, which is also what
-- recordEvent writes from now on.
--
-- Each search row takes its event's rowid, so the triggers find it by rowid. The old triggers matched on
-- `event_id`, which FTS5 cannot look up, so every update or delete scanned the whole index. `event_id`
-- still guards each delete, and inserts replace on rowid, so an event table whose rowids were renumbered
-- (a VACUUM can do that to a table without an integer key) mends itself instead of failing writes.
DROP TRIGGER IF EXISTS `agent_events_fts_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `agent_events_fts_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `agent_events_fts_delete`;--> statement-breakpoint
DROP TABLE IF EXISTS `agent_events_fts`;--> statement-breakpoint
CREATE TEMP TABLE `agent_event_streams` AS
WITH `events` AS (
	SELECT
		`id`, `session_id`, `seq`,
		json_extract(`event_json`, '$.type') AS `type`,
		json_extract(`event_json`, '$.append') AS `append`,
		ifnull(`turn_id`, '') || char(31) || ifnull(json_extract(`event_json`, '$.messageId'), '') AS `stream`
	FROM `agent_events`
), `marked` AS (
	SELECT *,
		CASE WHEN `append` = 1 AND `type` IN ('assistant_message', 'reasoning')
			AND lag(`append`) OVER `w` = 1 AND lag(`type`) OVER `w` = `type`
			AND lag(`stream`) OVER `w` = `stream` AND lag(`seq`) OVER `w` = `seq` - 1
		THEN 1 ELSE 0 END AS `continues`
	FROM `events`
	WINDOW `w` AS (PARTITION BY `session_id` ORDER BY `seq`)
), `grouped` AS (
	SELECT *, sum(1 - `continues`) OVER (PARTITION BY `session_id` ORDER BY `seq` ROWS UNBOUNDED PRECEDING) AS `grp`
	FROM `marked`
)
SELECT `id`, `session_id`, `seq`, `continues`, `grp`
FROM `grouped`
WHERE `type` IN ('assistant_message', 'reasoning') AND `append` = 1;--> statement-breakpoint
UPDATE `agent_events`
SET `search_text` = `messages`.`text`
FROM (
	SELECT
		min(CASE WHEN `s`.`continues` = 0 THEN `s`.`id` END) AS `head_id`,
		group_concat(json_extract(`e`.`event_json`, '$.text'), '' ORDER BY `s`.`seq`) AS `text`
	FROM `agent_event_streams` AS `s`
	INNER JOIN `agent_events` AS `e` ON `e`.`id` = `s`.`id`
	GROUP BY `s`.`session_id`, `s`.`grp`
	HAVING count(*) > 1
) AS `messages`
WHERE `agent_events`.`id` = `messages`.`head_id`;--> statement-breakpoint
UPDATE `agent_events`
SET `search_text` = NULL
WHERE `id` IN (SELECT `id` FROM `agent_event_streams` WHERE `continues` = 1);--> statement-breakpoint
DROP TABLE `agent_event_streams`;--> statement-breakpoint
CREATE VIRTUAL TABLE `agent_events_fts` USING fts5(
	`event_id` UNINDEXED,
	`session_id` UNINDEXED,
	`content`,
	`tool`,
	tokenize = 'porter unicode61'
);--> statement-breakpoint
-- The table's default `rank`, stored with it: a word in tool text counts for less than the same word in
-- the conversation, so command output and file dumps do not bury it. Weights follow column order.
INSERT INTO `agent_events_fts` (`agent_events_fts`, `rank`) VALUES ('rank', 'bm25(0, 0, 1.0, 0.3)');--> statement-breakpoint
INSERT INTO `agent_events_fts` (`rowid`, `event_id`, `session_id`, `content`, `tool`)
SELECT
	`rowid`, `id`, `session_id`,
	CASE WHEN json_extract(`event_json`, '$.type') = 'tool' THEN NULL ELSE `search_text` END,
	CASE WHEN json_extract(`event_json`, '$.type') = 'tool' THEN `search_text` END
FROM `agent_events`
WHERE `search_text` IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `agent_events_fts_insert` AFTER INSERT ON `agent_events`
WHEN NEW.`search_text` IS NOT NULL
BEGIN
	INSERT OR REPLACE INTO `agent_events_fts` (`rowid`, `event_id`, `session_id`, `content`, `tool`)
	SELECT
		NEW.`rowid`, NEW.`id`, NEW.`session_id`,
		CASE WHEN json_extract(NEW.`event_json`, '$.type') = 'tool' THEN NULL ELSE NEW.`search_text` END,
		CASE WHEN json_extract(NEW.`event_json`, '$.type') = 'tool' THEN NEW.`search_text` END;
END;--> statement-breakpoint
CREATE TRIGGER `agent_events_fts_update` AFTER UPDATE OF `search_text` ON `agent_events`
BEGIN
	DELETE FROM `agent_events_fts` WHERE `rowid` = OLD.`rowid` AND `event_id` = OLD.`id`;
	INSERT OR REPLACE INTO `agent_events_fts` (`rowid`, `event_id`, `session_id`, `content`, `tool`)
	SELECT
		NEW.`rowid`, NEW.`id`, NEW.`session_id`,
		CASE WHEN json_extract(NEW.`event_json`, '$.type') = 'tool' THEN NULL ELSE NEW.`search_text` END,
		CASE WHEN json_extract(NEW.`event_json`, '$.type') = 'tool' THEN NEW.`search_text` END
	WHERE NEW.`search_text` IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER `agent_events_fts_delete` AFTER DELETE ON `agent_events`
BEGIN
	DELETE FROM `agent_events_fts` WHERE `rowid` = OLD.`rowid` AND `event_id` = OLD.`id`;
END;

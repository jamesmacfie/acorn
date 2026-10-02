// Repair definitions mirror migrations 0005 and 0012; ftsSchema.test.ts compares migrated and repaired objects.
export const searchDirtySchema = [
  `CREATE TABLE IF NOT EXISTS agent_search_dirty (session_id text PRIMARY KEY NOT NULL, from_seq integer NOT NULL);`,
  `CREATE TRIGGER IF NOT EXISTS agent_search_insert AFTER INSERT ON agent_events
BEGIN
  INSERT INTO agent_search_dirty VALUES (NEW.session_id, NEW.seq)
  ON CONFLICT (session_id) DO UPDATE SET from_seq = min(from_seq, NEW.seq);
END;`,
  `CREATE TRIGGER IF NOT EXISTS agent_search_update AFTER UPDATE OF event_json, seq, turn_id, session_id ON agent_events
BEGIN
  INSERT INTO agent_search_dirty VALUES (OLD.session_id, OLD.seq)
  ON CONFLICT (session_id) DO UPDATE SET from_seq = min(from_seq, OLD.seq);
  INSERT INTO agent_search_dirty VALUES (NEW.session_id, NEW.seq)
  ON CONFLICT (session_id) DO UPDATE SET from_seq = min(from_seq, NEW.seq);
END;`,
  `CREATE TRIGGER IF NOT EXISTS agent_search_delete AFTER DELETE ON agent_events
BEGIN
  INSERT INTO agent_search_dirty VALUES (OLD.session_id, OLD.seq)
  ON CONFLICT (session_id) DO UPDATE SET from_seq = min(from_seq, OLD.seq);
END;`,
  `CREATE TRIGGER IF NOT EXISTS agent_search_session_delete AFTER DELETE ON agent_sessions
BEGIN
  DELETE FROM agent_search_dirty WHERE session_id = OLD.id;
END;`,
]

export const searchFtsTriggers = [
  `CREATE TRIGGER IF NOT EXISTS agent_events_fts_insert AFTER INSERT ON agent_events
WHEN NEW.search_text IS NOT NULL
BEGIN
	INSERT OR REPLACE INTO agent_events_fts (rowid, event_id, session_id, content, tool)
	SELECT
		NEW.rowid, NEW.id, NEW.session_id,
		CASE WHEN json_extract(NEW.event_json, '$.type') = 'tool' THEN NULL ELSE NEW.search_text END,
		CASE WHEN json_extract(NEW.event_json, '$.type') = 'tool' THEN NEW.search_text END;
END;`,
  `CREATE TRIGGER IF NOT EXISTS agent_events_fts_update AFTER UPDATE OF search_text ON agent_events
BEGIN
	DELETE FROM agent_events_fts WHERE rowid = OLD.rowid AND event_id = OLD.id;
	INSERT OR REPLACE INTO agent_events_fts (rowid, event_id, session_id, content, tool)
	SELECT
		NEW.rowid, NEW.id, NEW.session_id,
		CASE WHEN json_extract(NEW.event_json, '$.type') = 'tool' THEN NULL ELSE NEW.search_text END,
		CASE WHEN json_extract(NEW.event_json, '$.type') = 'tool' THEN NEW.search_text END
	WHERE NEW.search_text IS NOT NULL;
END;`,
  `CREATE TRIGGER IF NOT EXISTS agent_events_fts_delete AFTER DELETE ON agent_events
BEGIN
	DELETE FROM agent_events_fts WHERE rowid = OLD.rowid AND event_id = OLD.id;
END;`,
]

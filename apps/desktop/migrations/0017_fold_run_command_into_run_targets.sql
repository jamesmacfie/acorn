-- Custom SQL migration file, put your code below! --

-- Fold the legacy scalar dev-server config (repo_paths.run_command / dev_port) into the
-- run_targets JSON column, replicating the synthetic `dev` target the old
-- loadRepoConfig.legacyRunTargets mapping produced:
--   { "id": "dev", "command": <run_command trimmed>, "default": true, "url": "http://localhost:<dev_port>"? }
-- Only rows that never adopted run_targets (NULL) and still have a usable run_command are folded;
-- an existing run_targets value always wins. The scalar columns stay for now — main/repoPaths.ts
-- (setRunConfig IPC) still writes them — and get dropped once that surface moves to run_targets.
UPDATE `repo_paths`
SET `run_targets` = CASE
	WHEN `dev_port` IS NOT NULL THEN json_array(json_object('id', 'dev', 'command', trim(`run_command`), 'default', json('true'), 'url', 'http://localhost:' || `dev_port`))
	ELSE json_array(json_object('id', 'dev', 'command', trim(`run_command`), 'default', json('true')))
END
WHERE `run_targets` IS NULL
	AND `run_command` IS NOT NULL
	AND trim(`run_command`) != '';

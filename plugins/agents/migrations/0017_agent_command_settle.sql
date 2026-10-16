-- Starts empty, so the first start after this migration settles commands across every event once
-- and then stores when that pass began.
CREATE TABLE `agent_command_settle` (
	`settled_before` integer NOT NULL
);

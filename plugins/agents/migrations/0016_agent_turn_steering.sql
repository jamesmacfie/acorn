-- The running turn a steered queued turn joined. `status` is plain text, so `steering` and `steered`
-- need no constraint change.
ALTER TABLE `agent_turns` ADD `steered_into_turn_id` text;
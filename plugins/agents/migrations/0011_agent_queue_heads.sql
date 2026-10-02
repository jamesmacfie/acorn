CREATE INDEX `agent_turns_queued_head_idx` ON `agent_turns` (`session_id`, `ordinal`) WHERE `status` = 'queued';

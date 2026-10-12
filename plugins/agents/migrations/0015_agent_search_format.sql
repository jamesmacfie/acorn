-- Starts empty, so the first start after this migration runs AgentSearchProjection's full index
-- check once and then stores the format it checked.
CREATE TABLE `agent_search_format` (`version` integer NOT NULL);

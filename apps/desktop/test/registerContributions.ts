// Vitest global setup: register the built-in agent-profile plugins into the core registry, as the
// composition roots do at boot (docs/plugins.md). Profiles are safe here because no test mocks
// them. Integration PROVIDERS are NOT registered globally — a test that mocks a provider plugin's
// modules must register providers in-graph (import '../../../../app/server/providers') so its
// vi.mock hoists above the registration; a global import would pre-load the real module first.
import '../src/app/main/agentProfiles'

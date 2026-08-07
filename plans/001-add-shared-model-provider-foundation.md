# Shared model-provider foundation — implemented

The model-providers plugin supplies OpenAI and Anthropic connections through the generic integration
lifecycle and exposes a provider-neutral `modelProviders.generate` capability. Consumers select an
opaque connection ID; the adapter resolves the encrypted credential for one call and returns safe
model/usage metadata.

## Current behavior

- Settings can add, rotate, test, disable, enable, and remove OpenAI/Anthropic API-key connections.
- Credentials reuse the core encrypted `integrations` rows and are write-only to the renderer.
- Provider adapters use bounded HTTP calls and map provider failures into safe domain errors.
- Prompts and responses are not persisted by the model-provider plugin.
- Consumers own their route, prompt construction, context selection, and output validation. The
  provider plugin does not own chat threads, task links, SQL semantics, or an arbitrary prompt route.
- The database plugin uses the optional capability for SQL generation; manual SQL remains available
  when no model provider is configured.

## Boundary

Model providers are connection providers, not external-item sources. The plugin is registered by the
Node composition root and is consumed through the capability registry, so feature packages do not
import OpenAI/Anthropic adapter internals. Provider credentials remain on the Node and are not
available to task-scoped child callers through a generic model endpoint.

## Verification

Provider descriptors, encrypted lifecycle, adapter normalization, concurrency/error behavior, and
consumer capability absence are covered by package and integration tests. Current contracts are in
[integrations.md](../docs/integrations.md), [plugins.md](../docs/plugins.md), and
[api-reference.md](../docs/api-reference.md).

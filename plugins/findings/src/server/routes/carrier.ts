import { portableCarrier } from '@acorn/plugin-api/node'

// Findings ships through the loaded-plugin fetch carrier. Keeping the context bridge in one module
// makes every route read the same host-authenticated principal; request bodies never supply identity.
export const { portableFetch, requestContext } = portableCarrier('findings')

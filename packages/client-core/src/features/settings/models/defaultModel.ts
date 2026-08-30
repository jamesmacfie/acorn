import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'

/** Which model a connection starts on. A `.ts` of its own rather than a line in
 *  ./ModelConnectionPicker.tsx, so a plugin bundle that draws a tree can have the answer without
 *  pulling a Solid component compiled for a document into a worker. */
export const defaultModelIdFor = (connection: AvailableModelConnection | undefined): string =>
  connection?.provider.defaultModelId ?? connection?.provider.models?.[0]?.id ?? ''

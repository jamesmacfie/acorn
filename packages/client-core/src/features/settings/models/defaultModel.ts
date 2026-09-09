// Which model a backend starts on. Re-exported rather than defined here: the Database plugin's node
// half needs the same answer for the palette's `Generate SQL` fast path, and a node cannot import
// client-core, so the fact moved to protocol where both sides can reach it
// (@acorn/protocol/modelProviders.ts).
//
// A `.ts` of its own rather than a line in ./ModelBackendPicker.tsx, so a plugin bundle that draws a
// tree can have the answer without pulling a Solid component compiled for a document into a worker.
export { defaultModelIdFor } from '@acorn/protocol/modelProviders.ts'

// Submit mode for sendToAgent's bracketed-paste delivery (docs/terminal-and-agents.md § Sending
// text to an agent).
//
// Lives in shared/ because four sides of this plugin need the same union and contract/ is one of them.
// A contract may import shared/ but never main/ or server/ (tools/arch/boundaries.test.ts), so
// declaring it in the engine and re-exporting it from the contract is not an option.
//
//   'now'         → paste, then submit after a short settle delay
//   'after-ready' → submit immediately if the session is idle, else queue on the busy→idle edge
//   'draft'       → paste only; the human reviews and presses enter
export type SendSubmit = 'now' | 'after-ready' | 'draft'

// Kept as the client import seam while the implementation lives in protocol so the Node manifest
// parser and sandboxed-frame SDK normalize exactly the same strings.
export { eventChord } from '@acorn/protocol/keybindings.ts'

// The formatter is the kit's, so every surface writes a chord the same way.
export { formatChord } from '../../kit/lib/rendering/formatChord'

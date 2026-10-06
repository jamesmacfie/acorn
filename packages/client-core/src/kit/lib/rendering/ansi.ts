// Terminal escape codes in text that is shown rather than run. A shell command writes them because
// every task child is told it has a colour terminal (node-core server/taskEnv.ts), and a <pre> draws
// the escape byte as a box and the rest of the code as text.
//
// Colour codes, `ESC [ … m`, are the only ones a static block can honour. The rest move a cursor, set
// a title, open a hyperlink, or switch a character set, and mean nothing once the output is stored.
// Zero imports, so the terminal kit can use this without loading the highlighter.

const COLOUR = /\x1b\[[0-9;:]*m/g

// In order: an OSC sequence (title, hyperlink) up to its BEL or ST terminator, a CSI sequence that
// is not a colour, any other escape such as the charset select `ESC ( B` that `tput sgr0` writes,
// and finally a lone ESC. The third excludes `[` and `]` as a final byte, so it cannot eat the
// start of a colour code the second one declined.
const NOT_COLOUR = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-ln-~]|\x1b[ -/]*[0-Z\\^-~]|\x1b(?!\[[0-9;:]*m)/g

// Control bytes other than tab, newline, and carriage return, which a <pre> also draws as boxes.
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g

/** Is there anything here that `stripAnsi` would remove? Cheap enough to ask of every block. */
export const hasAnsi = (text: string): boolean => /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)

/** The text with its colour codes kept and every other escape and control byte removed. */
export const keepAnsiColour = (text: string): string => text.replace(NOT_COLOUR, '').replace(CONTROL, '')

/** The text a reader sees, with no escape codes or control bytes at all. */
export const stripAnsi = (text: string): string => keepAnsiColour(text).replace(COLOUR, '')

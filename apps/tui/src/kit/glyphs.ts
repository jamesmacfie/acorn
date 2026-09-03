// Lucide names as one character each.
//
// `Icon` takes a Lucide name (docs/ui-design.md § Icons), and a terminal has no SVG. Drawing the name
// as words instead would push every row it sits in sideways by six cells, so a name either has a
// glyph here or draws nothing — which is what the node's row in the 80×24 table promises.
//
// Small on purpose. This is every name the app and the bundled plugins actually spend, read off the
// tree, plus the handful a person reaches for first. A name that is missing is a one-line addition,
// and a name nobody uses is a character somebody had to choose for no reader.
//
// **Every glyph here is one cell wide, and that is a rule rather than a coincidence.** A row holding
// a wide character is a row whose width the layout cannot predict: eight of these used to be emoji,
// and they drew the rail's names a cell to the right of every other row's.
//
// The rule is checked rather than remembered. `../width.test.ts` § GLYPHS runs the painter's own
// measure over every value here and insists on 1, which is what a new name is judged by. It replaced
// a `\p{Emoji_Presentation}` test that passed all 73 names and missed six wide ones — the property a
// character has is not the width a terminal gives it, and only the measure that lays the row out can
// answer that.
export const GLYPHS: Readonly<Record<string, string>> = {
  // Actions
  x: '✕',
  plus: '+',
  check: '✓',
  copy: '⧉',
  pencil: '✎',
  'square-pen': '✎',
  'trash-2': '␡',
  'refresh-cw': '↻',
  'rotate-ccw': '↺',
  send: '➤',
  play: '▶',
  ellipsis: '…',
  paperclip: '⇗',
  ban: '⊘',
  archive: '🗀',
  pin: '⌖',
  'pin-off': '⌖',
  // Movement
  'chevron-up': '▴',
  'chevron-down': '▾',
  'chevron-left': '◂',
  'chevron-right': '▸',
  'arrow-up': '↑',
  'arrow-down': '↓',
  'arrow-left': '←',
  'arrow-right': '→',
  // State
  circle: '○',
  'circle-dot': '◉',
  'circle-check': '✓',
  'circle-alert': '!',
  'circle-dashed': '◌',
  'square-check': '☑',
  'triangle-alert': '⚠',
  info: 'i',
  'loader-circle': '⠋',
  clock: '◔',
  eye: '👁',
  'eye-off': '👁',
  diamond: '◆',
  gauge: '◑',
  // Things
  folder: '🗀',
  'folder-plus': '🗀',
  'folder-tree': '🗀',
  'folder-x': '🗀',
  'file-text': '🗎',
  'file-diff': '🗎',
  'file-cog': '🗎',
  'notepad-text': '🗒',
  database: '🗃',
  globe: '⊕',
  house: '⌂',
  network: '⧉',
  monitor: '🖵',
  'app-window': '🖵',
  'square-terminal': '❯',
  keyboard: '⌨',
  'key-round': '⚿',
  puzzle: '⊞',
  bot: '⌬',
  sparkles: '✦',
  rocket: '↟',
  dices: '⚄',
  braces: '{',
  'user-round': '☺',
  radio: '◉',
  label: '🏷',
  // `≡`, not `☰`, which Unicode 16 moved to East Asian Width `W`: two cells by the standard, one in
  // any terminal with an older table, and therefore a width no layout can predict (../width.ts § WIDE).
  list: '≡',
  'list-checks': '☑',
  'layout-grid': '▦',
  kanban: '▤',
  // Version control
  'git-branch': '⑂',
  'git-compare': '⇄',
  'git-pull-request': '⇡',
  'git-commit-horizontal': '●',
}

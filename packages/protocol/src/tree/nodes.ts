// The vocabulary a remote tree is written in: the kit's node names, the semantic events a node can
// send back, and the role enums its props are allowed to spend.
//
// Here rather than in client-core because both ends compile against it. The node validates a bundle's
// declared nodes at install; the client validates the stream at runtime; neither may reach for the
// other's copy. See docs/future/layout/06-remote-tree.md § The wire format.
//
// The lists are duplicated from `client-core/src/ui/kit/{support,tokens}.ts`, which own them, and a
// test over there fails the moment the two disagree. Protocol is a pure sink (tools/arch/boundaries.test.ts),
// so an import is not available and a duplicate with a lock is the honest alternative.

/**
 * Version of the tree protocol, sent in the handshake. A mismatch is a placeholder, not a crash.
 *
 * On this file rather than beside the wire schemas because the sandbox half sends it, and the sandbox
 * half is bundled into a stranger's plugin. Everything in here is plain constants; `./messages.ts`
 * imports Zod, and a plugin's bundle must not.
 */
export const TREE_PROTOCOL_VERSION = 1

/** Every node a tree may name. Mirrors `NODE_SUPPORT` in client-core's kit. */
export const KIT_NODES = [
  // Grouping
  'Stack', 'Inline', 'Section', 'Fold', 'CollapsibleSection', 'Card', 'Timeline', 'Tabs', 'Toolbar',
  'Modal', 'ModalBody', 'ModalActions', 'Menu', 'Popover', 'ListDetail', 'ListColumn', 'DetailColumn',
  'SplitHandle', 'DocumentTabs', 'SectionHeader', 'TabPanel', 'ToolbarSpacer',
  // Showing
  'Text', 'Heading', 'Rows', 'Row', 'TreeRow', 'RowActions', 'Badge', 'Chip', 'ChipRow', 'StatusDot', 'Facts',
  'DescriptionList', 'Table', 'Grid', 'Meter', 'CodeBlock', 'Log', 'Markdown', 'DiffPane', 'DiffLine',
  'FileHead', 'NonCodeRow', 'SplitCell', 'EmptyState', 'Alert', 'Spinner', 'Kbd', 'UserAvatar', 'Icon',
  // Asking
  'Button', 'Input', 'Textarea', 'Select', 'Checkbox', 'SegmentedControl', 'ToggleButton', 'Picker',
  'PickerRow', 'Composer', 'MentionTextarea', 'KeyValueEditor', 'FindBar', 'Field', 'ConfirmButton',
  'CopyButton', 'ModelConnectionPicker',
  // Pixels. A tree naming this gets the box and the keyboard contract, and nothing else: what fills a
  // rectangle with somebody else's pixels is the `rectangle` extension kind, which is an iframe the
  // host places as a sibling region and never a node in another plugin's stream.
  'Rectangle',
  // Host wrappers
  'Only', 'Fallback',
] as const

export type KitNodeName = (typeof KIT_NODES)[number]

/** The one type that is not a component: a run of text. A string child is minted as one of these by
 *  the sandbox adapter, so the wire has a single node shape rather than two. */
export const TEXT_NODE = '#text'

const kitNodeSet: ReadonlySet<string> = new Set<string>(KIT_NODES)
export const isKitNode = (value: string): value is KitNodeName => kitNodeSet.has(value)

/**
 * The closed set of events a node may send back.
 *
 * Never a key and never a pointer event: a terminal host has neither, and it must be able to map its
 * own keys onto the same eleven names. A prop whose name is in here carries a handler id; a prop
 * whose name starts with `on` and is not in here is dropped.
 */
export const KIT_EVENTS = [
  'onPress', 'onChange', 'onSubmit', 'onSelect', 'onActivate', 'onToggle', 'onOpenChange',
  'onExpand', 'onDismiss', 'onPick', 'onRemove',
] as const
export type KitEvent = (typeof KIT_EVENTS)[number]

const kitEventSet: ReadonlySet<string> = new Set<string>(KIT_EVENTS)
export const isKitEvent = (value: string): value is KitEvent => kitEventSet.has(value)

/** The role enums, mirroring `ROLE_ENUMS` in the kit. A prop named here takes one of these and
 *  nothing else, which is what stops a colour or a pixel crossing the wire. */
export const ROLE_VALUES = {
  space: ['none', 'inline', 'row', 'stack', 'section'],
  size: ['xs', 'sm', 'md', 'lg'],
  tone: ['neutral', 'muted', 'accent', 'ok', 'warn', 'danger'],
  text: ['body', 'strong', 'muted', 'mono', 'eyebrow', 'heading'],
  border: ['none', 'divider', 'control', 'surface', 'stripe'],
  radius: ['control', 'surface', 'chip', 'pill'],
} as const satisfies Record<string, readonly string[]>

/**
 * Which prop names take which role enum. The kit spells the same meaning differently in a few places
 * (`gap` is a space, `emphasis` is a text role), so this is a map from prop name to enum rather than
 * the enum names themselves.
 */
export const ROLE_PROPS = {
  gap: 'space', space: 'space', pad: 'space',
  size: 'size',
  tone: 'tone',
  emphasis: 'text',
  border: 'border',
  radius: 'radius',
} as const satisfies Record<string, keyof typeof ROLE_VALUES>

/**
 * Props no node may ever receive over the wire, whatever its schema says.
 *
 * `class` and `style` are the kit's whole premise: a role is a meaning and a class is a pixel. The
 * rest are ways to reach the host's DOM through a component that would otherwise pass them on.
 */
export const FORBIDDEN_PROPS = [
  'class', 'className', 'classList', 'style', 'ref', 'innerHTML', 'innerText', 'textContent',
  'dangerouslySetInnerHTML', 'children',
] as const

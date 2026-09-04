// Published declaration for `acorn-plugin-sdk/remote`, hand-written and copied verbatim to
// dist/remote.d.ts, for the same reason ../public.ts is: the built file is a bundle and carries no
// types of its own. See docs/plugins.md § What is published, and what acorn promises about it.
//
// Only two things here are yours to call. Everything else is what the Solid JSX preset compiles
// against, and its names are Solid's; they are exported because the preset imports them by name, not
// because you write them.
import type { JSX } from 'solid-js'
import type { AcornBridge, TreeMount, TreeRender } from 'acorn-plugin-sdk'

/**
 * What a kit node takes: anything, checked on arrival.
 *
 * Loose on purpose. Acorn validates every prop before it reaches a component, so a narrow type here
 * would be a second, drifting copy of a rule already enforced where it matters. What the check does
 * guarantee is the shape: a function survives only under one of acorn's semantic event names
 * (`onPress`, `onChange`, `onSelect` and the rest), and `class`, `style` and the other DOM escape
 * hatches are dropped before they cross.
 */
export type KitNodeProps = Record<string, unknown> & { children?: unknown }

/**
 * Acorn's components, as things you write in JSX.
 *
 * `<Card>` compiles to "make a node called Card"; acorn mounts its own `Card` for it, and what the
 * reader gets has the shell's focus behaviour, keyboard handling, ARIA and style pack. A name that
 * this acorn does not have draws a labelled placeholder rather than failing the tree around it.
 */
export declare const Stack: (props: KitNodeProps) => JSX.Element
export declare const Inline: (props: KitNodeProps) => JSX.Element
export declare const Section: (props: KitNodeProps) => JSX.Element
export declare const Fold: (props: KitNodeProps) => JSX.Element
export declare const Card: (props: KitNodeProps) => JSX.Element
export declare const Timeline: (props: KitNodeProps) => JSX.Element
export declare const Tabs: (props: KitNodeProps) => JSX.Element
export declare const Toolbar: (props: KitNodeProps) => JSX.Element
export declare const Modal: (props: KitNodeProps) => JSX.Element
export declare const ModalBody: (props: KitNodeProps) => JSX.Element
export declare const ModalActions: (props: KitNodeProps) => JSX.Element
export declare const Menu: (props: KitNodeProps) => JSX.Element
export declare const Popover: (props: KitNodeProps) => JSX.Element
export declare const ListDetail: (props: KitNodeProps) => JSX.Element
export declare const ListColumn: (props: KitNodeProps) => JSX.Element
export declare const DetailColumn: (props: KitNodeProps) => JSX.Element
export declare const SplitHandle: (props: KitNodeProps) => JSX.Element
export declare const DocumentTabs: (props: KitNodeProps) => JSX.Element
export declare const SectionHeader: (props: KitNodeProps) => JSX.Element
export declare const TabPanel: (props: KitNodeProps) => JSX.Element
export declare const ToolbarSpacer: (props: KitNodeProps) => JSX.Element
export declare const Text: (props: KitNodeProps) => JSX.Element
export declare const Link: (props: KitNodeProps) => JSX.Element
export declare const Heading: (props: KitNodeProps) => JSX.Element
export declare const Rows: (props: KitNodeProps) => JSX.Element
export declare const Row: (props: KitNodeProps) => JSX.Element
export declare const TreeRow: (props: KitNodeProps) => JSX.Element
export declare const RowActions: (props: KitNodeProps) => JSX.Element
export declare const Badge: (props: KitNodeProps) => JSX.Element
export declare const Chip: (props: KitNodeProps) => JSX.Element
export declare const ChipRow: (props: KitNodeProps) => JSX.Element
export declare const StatusDot: (props: KitNodeProps) => JSX.Element
export declare const Facts: (props: KitNodeProps) => JSX.Element
export declare const DescriptionList: (props: KitNodeProps) => JSX.Element
export declare const Table: (props: KitNodeProps) => JSX.Element
export declare const TableHead: (props: KitNodeProps) => JSX.Element
export declare const TableRow: (props: KitNodeProps) => JSX.Element
export declare const TableCell: (props: KitNodeProps) => JSX.Element
export declare const Grid: (props: KitNodeProps) => JSX.Element
export declare const Meter: (props: KitNodeProps) => JSX.Element
export declare const CodeBlock: (props: KitNodeProps) => JSX.Element
export declare const Log: (props: KitNodeProps) => JSX.Element
export declare const Markdown: (props: KitNodeProps) => JSX.Element
export declare const DiffPane: (props: KitNodeProps) => JSX.Element
export declare const DiffLine: (props: KitNodeProps) => JSX.Element
export declare const FileHead: (props: KitNodeProps) => JSX.Element
export declare const NonCodeRow: (props: KitNodeProps) => JSX.Element
export declare const SplitCell: (props: KitNodeProps) => JSX.Element
export declare const EmptyState: (props: KitNodeProps) => JSX.Element
export declare const Alert: (props: KitNodeProps) => JSX.Element
export declare const Spinner: (props: KitNodeProps) => JSX.Element
export declare const Kbd: (props: KitNodeProps) => JSX.Element
export declare const UserAvatar: (props: KitNodeProps) => JSX.Element
export declare const Icon: (props: KitNodeProps) => JSX.Element
export declare const Button: (props: KitNodeProps) => JSX.Element
export declare const Input: (props: KitNodeProps) => JSX.Element
export declare const Textarea: (props: KitNodeProps) => JSX.Element
export declare const Select: (props: KitNodeProps) => JSX.Element
export declare const Checkbox: (props: KitNodeProps) => JSX.Element
export declare const SegmentedControl: (props: KitNodeProps) => JSX.Element
export declare const ToggleButton: (props: KitNodeProps) => JSX.Element
export declare const Picker: (props: KitNodeProps) => JSX.Element
export declare const PickerRow: (props: KitNodeProps) => JSX.Element
export declare const Composer: (props: KitNodeProps) => JSX.Element
export declare const MentionTextarea: (props: KitNodeProps) => JSX.Element
export declare const KeyValueEditor: (props: KitNodeProps) => JSX.Element
export declare const FindBar: (props: KitNodeProps) => JSX.Element
export declare const Field: (props: KitNodeProps) => JSX.Element
export declare const CopyButton: (props: KitNodeProps) => JSX.Element
export declare const ModelConnectionPicker: (props: KitNodeProps) => JSX.Element
export declare const Only: (props: KitNodeProps) => JSX.Element
export declare const Fallback: (props: KitNodeProps) => JSX.Element
/** Every node above, keyed by name, for code that picks one at runtime. */
export declare const KIT_NODE_COMPONENTS: Record<string, (props: KitNodeProps) => JSX.Element>

/**
 * Wrap a Solid component as a tree renderer.
 *
 * Point the JSX preset at this module and your components compile into acorn's tree instead of into
 * a document:
 *
 * ```ts
 * solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })
 * ```
 *
 * The props acorn mounted with arrive as a store, so a redraw reconciles rather than tearing the tree
 * down: a card whose data gains a line re-renders that line.
 *
 * `bridge` and `host` arrive beside them. `host` is the two things a tree may ask acorn for — call an
 * action the owning extension point declared, open the overlay your descriptor associated — and both
 * are stable for the mount's life, so a redraw does not invalidate a handler mid-await.
 */
export declare function solidTree<P extends Record<string, unknown>>(
  component: (props: P & { bridge: AcornBridge; host: TreeMount['host'] }) => JSX.Element,
): TreeRender

// The universal-renderer surface. Solid's compiler emits calls to these; you do not.
export declare const render: (code: () => unknown, node: unknown) => () => void
export declare const effect: (fn: (prev?: unknown) => unknown, init?: unknown) => void
export declare const memo: (fn: () => unknown, equal?: boolean) => () => unknown
export declare const createComponent: (component: unknown, props: unknown) => unknown
export declare const createElement: (type: string) => unknown
export declare const createTextNode: (value: string) => unknown
export declare const insertNode: (parent: unknown, node: unknown, anchor?: unknown) => void
export declare const insert: (parent: unknown, accessor: unknown, marker?: unknown, initial?: unknown) => unknown
export declare const spread: (node: unknown, accessor: unknown, skipChildren?: boolean) => void
export declare const setProp: (node: unknown, name: string, value: unknown, prev?: unknown) => unknown
export declare const mergeProps: (...sources: unknown[]) => unknown
export declare const use: (fn: unknown, element: unknown, arg: unknown) => unknown

// A type-level test. It has no assertions to run: `tsc --noEmit` across every package is what checks
// it, which is the same pass `pnpm lint` already makes. See docs/ui-design.md § The closed kit.
//
// What it holds: no kit node's props accept a class, a style, or an arbitrary string where a role
// token is meant. Those three are the whole of the rule, and a component that grows one back fails
// the build here rather than in review.
import type { Component } from 'solid-js'
import type {
  Alert, Badge, Button, Card, Checkbox, Chip, CodeBlock, DescriptionList, EmptyState, Field, Input,
  Kbd, ListDetail, Meter, Row, SectionHeader, SegmentedControl, Select, Spinner, StatusDot, Table,
  Textarea, ToggleButton, Toolbar, TreeRow,
} from '../components/primitives'
import type { ChipRow } from '../components/layout/ChipRow'
import type { Facts } from '../components/content/Facts'
import type { Fold } from '../components/layout/Fold'
import type { Grid } from '../components/layout/Grid'
import type { Graph } from '../components/content/Graph'
import type { Heading } from '../components/content/Heading'
import type { Inline } from '../components/layout/Inline'
import type { Log } from '../components/content/Log'
import type { Section } from '../components/layout/Section'
import type { Stack } from '../components/layout/Stack'
import type { Timeline } from '../components/content/Timeline'

/** The props of anything callable with props, whether it was written as a function or typed as a
 *  `Component`. */
type PropsOf<T> = T extends Component<infer P> ? P : T extends (props: infer P) => unknown ? P : never

/** `never` when the props are clean, and the offending key when they are not. Assigning it to
 *  `never` below is what turns a leak into a build error naming the node. */
type Styling<T> = Extract<keyof PropsOf<T>, 'class' | 'className' | 'style' | 'classList'>

type NoStyling<T extends never> = T

// One line per node. A node that grows `class` back names itself in the error.
type _Alert = NoStyling<Styling<typeof Alert>>
type _Badge = NoStyling<Styling<typeof Badge>>
type _Button = NoStyling<Styling<typeof Button>>
type _Card = NoStyling<Styling<typeof Card>>
type _Checkbox = NoStyling<Styling<typeof Checkbox>>
type _Chip = NoStyling<Styling<typeof Chip>>
type _ChipRow = NoStyling<Styling<typeof ChipRow>>
type _CodeBlock = NoStyling<Styling<typeof CodeBlock>>
type _DescriptionList = NoStyling<Styling<typeof DescriptionList>>
type _EmptyState = NoStyling<Styling<typeof EmptyState>>
type _Facts = NoStyling<Styling<typeof Facts>>
type _Field = NoStyling<Styling<typeof Field>>
type _Fold = NoStyling<Styling<typeof Fold>>
type _Grid = NoStyling<Styling<typeof Grid>>
type _Graph = NoStyling<Styling<typeof Graph>>
type _Heading = NoStyling<Styling<typeof Heading>>
type _Inline = NoStyling<Styling<typeof Inline>>
type _Input = NoStyling<Styling<typeof Input>>
type _Kbd = NoStyling<Styling<typeof Kbd>>
type _ListDetail = NoStyling<Styling<typeof ListDetail>>
type _Log = NoStyling<Styling<typeof Log>>
type _Meter = NoStyling<Styling<typeof Meter>>
type _Row = NoStyling<Styling<typeof Row>>
type _Section = NoStyling<Styling<typeof Section>>
type _SectionHeader = NoStyling<Styling<typeof SectionHeader>>
type _SegmentedControl = NoStyling<Styling<typeof SegmentedControl>>
type _Select = NoStyling<Styling<typeof Select>>
type _Spinner = NoStyling<Styling<typeof Spinner>>
type _Stack = NoStyling<Styling<typeof Stack>>
type _StatusDot = NoStyling<Styling<typeof StatusDot>>
type _Table = NoStyling<Styling<typeof Table>>
type _Textarea = NoStyling<Styling<typeof Textarea>>
type _Timeline = NoStyling<Styling<typeof Timeline>>
type _ToggleButton = NoStyling<Styling<typeof ToggleButton>>
type _Toolbar = NoStyling<Styling<typeof Toolbar>>
type _TreeRow = NoStyling<Styling<typeof TreeRow>>

// A role-typed prop takes its enum and nothing else: `tone="brandpurple"` has to fail.
type Assignable<T, Prop extends keyof PropsOf<T>> = string extends PropsOf<T>[Prop] ? Prop : never
type NoLooseString<T extends never> = T

type _ButtonTone = NoLooseString<Assignable<typeof Button, 'tone'>>
type _ButtonSize = NoLooseString<Assignable<typeof Button, 'size'>>
type _BadgeTone = NoLooseString<Assignable<typeof Badge, 'tone'>>
type _StatusDotTone = NoLooseString<Assignable<typeof StatusDot, 'tone'>>
type _StackGap = NoLooseString<Assignable<typeof Stack, 'gap'>>
type _InlineGap = NoLooseString<Assignable<typeof Inline, 'gap'>>

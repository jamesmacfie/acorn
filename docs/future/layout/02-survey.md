# Survey: how every plugin draws itself today, and what it becomes

Part of [docs/future/layout/](./README.md). Taken from the client and frame code of all 21 plugins
on 2026-08-28. Fifteen draw something. Between them they hold 85 `.tsx` files, import 40 distinct
components from `@acorn/plugin-api/ui`, and write roughly 700 raw `<div>` and `<span>` tags with
plugin-specific classes. That last number is where layout lives today, and it is the part that
cannot be responsive or reach a terminal for free.

Re-run the counts before starting phase 5. The shape will hold; the numbers will drift.

## The kit today, sorted by what it is for

Forty components, grouped by role. The grouping matters more than the list because it decides what
becomes a layout, what stays a node, and what stays a rectangle.

| Role | Components | What happens to them |
| --- | --- | --- |
| Arranging | `ListDetail` `Tabs` `Toolbar` `SplitHandle` `DocumentTabs` `Drawer` `Modal` `SectionHeader` `CollapsibleSection` | Most become **layouts** the host owns rather than nodes a plugin emits. `Tabs`, `CollapsibleSection` (as `Fold`), `Modal`, and `Toolbar` stay as nodes. |
| Showing | `Row` `Card` `Badge` `Chip` `StatusDot` `DescriptionList` `Table` `Meter` `CodeBlock` `Markdown` `EmptyState` `Alert` `Spinner` `Kbd` `UserAvatar` `Icon` `TreeRow` | All nodes. Every one has an obvious terminal rendering. |
| Asking | `Button` `Input` `Textarea` `Select` `Checkbox` `SegmentedControl` `ToggleButton` `Picker` `Composer` `MentionTextarea` `KeyValueEditor` `FindBar` `Field` `Menu` `RowActions` `ConfirmButton` | All nodes. Inputs are host-owned and uncontrolled; the tree hears `onChange` on commit, not per key. |
| Heavy but kit | `DiffPane` `Markdown` `CodeBlock` | Nodes, implemented per host. A terminal diff is `delta`-shaped, not a port of the DOM one. |
| Pixels | Monaco (`/ui/editor`), xterm, `WebContentsView`, the database result grid's virtual scroller | **Rectangles.** Not in the tree. Absent on a terminal, except the PTY, which is native there. |

## Six layouts cover fifteen plugins

Every pane is one of a small number of arrangements. The plugin writes it today with
`<section class="pane">`, a header div, a scroll div, and per-plugin CSS.

| Layout | Regions | Who uses it today | Below 80 columns |
| --- | --- | --- | --- |
| `list-detail` | list, detail, optional list header and list footer | agents, changes, notes, editor, http, database, linear, rollbar, github browse | One region at a time; a key switches |
| `header-body-footer` | header, body (scrolls), footer | agents (transcript over composer), context, docker task pane, memory section | Same, footer pinned |
| `tabs` | tab bar, one panel per tab | docker detail, linear, rollbar, http response, editor sidebar, github PR | Tab bar as one line |
| `document-over-frame` and `frame-beside-document` | document (host editor), frame | database; editor and http could | Document becomes a plain text view; frame region draws its tree |
| `stack-split` | top, bottom, a handle | terminal (tabs over a PTY) | Same, native |
| `wizard` | step body, step dots, back and next | onboarding, github importer | Same |

Three surfaces do not fit a layout because they are chrome: docker's footer badge, terminal's
drawer, agents' rail markers. Those are descriptors or slots already and stay that way.

## Where the hand-rolled layout is

Raw tag counts per plugin, as a rough measure of how much of each is layout it wrote itself rather
than kit it composed. High numbers gain most from host-owned layouts and cost most to move.

| Plugin | `.tsx` | Kit components | Raw div+span | Reading |
| --- | ---: | ---: | ---: | --- |
| agents | 20 | 24 | 121 | Six hand-drawn structures: transcript, event card, composer, sidebar, center, provider cards. Six raw `<details>`, which is a missing `Fold`. |
| github | 15 | 27 | 117 | PR detail is 26 KB of custom layout around kit pieces; browse is its own three-column layout. |
| http | 7 | 17 | 38 | Already a frame; mostly kit. URL bar and response strip are custom toolbars. |
| linear | 3 | 12 | 32 | Already a frame; header, chips, tabs, facts. Nearly all kit. |
| onboarding | 4 | 10 | 29 | Wizard chrome is custom; the steps are kit. |
| docker | 7 | 15 | 27 | Detail is tabs, description lists, a log with a find bar, meters. |
| context | 1 | 7 | 25 | Custom tray rows with per-section meters. A tree of sections, literally. |
| database | 6 | 14 | 23 | Already a frame under a host editor. Result grid is a custom virtual grid. |
| changes | 2 | 9 | 20 | list-detail with `DiffPane`. Review notes are custom rows. |
| editor | 4 | 10 | 19 | Sidebar is kit; the editor host div is Monaco. |
| rollbar | 3 | 9 | 12 | Already a frame; header, chips, tabs, list-detail of occurrences. |
| memory | 1 | 4 | 10 | A form inside somebody else's tray. Raw inputs. |
| notes | 2 | 9 | 9 | list-detail with a markdown and textarea toggle. |
| workflows | 1 | 2 | 10 | A settings section. |
| terminal | 4 | 10 | 4 | Tabs over xterm. The xterm is the whole thing. |
| preview | 2 | 3 | 2 | A webview with a URL input. |

The four loaded plugins (http, database, linear, rollbar) already look like trees, because a frame
with no shared CSS pushed them onto the kit. The compiled plugins, above all agents and github, hold
the custom layout, and they are the ones that have to move for a terminal client to show anything
worth opening a terminal for.

## Nine kit gaps

Each replaces a pattern hand-written in two or more plugins today.

| Node | Replaces |
| --- | --- |
| `Stack`, `Inline` | The raw `div` groupings every plugin writes for "these in sequence" and "these side by side" |
| `Heading` | Eyebrow plus title divs in linear, rollbar, github, docker detail |
| `Section` | Sidebar section labels in agents, changes, notes, docker browse |
| `Fold` | Six raw `<details>` in agents; `CollapsibleSection` folds in |
| `Timeline` | The transcript list in agents and the conversation in github |
| `Facts` | `DescriptionList` in facts layout, used by linear, rollbar, docker, onboarding; name it |
| `ChipRow` | The chip strips in docker, linear, rollbar, agents composer context |
| `Log` | The scrolling monospace `pre` with find in docker |
| `Grid` | The database `ResultGrid` |

## Plugin by plugin

For each: today, the tree it becomes, what stays a rectangle, and how it fits a terminal. The trees
are sketches in the kit's vocabulary, not final APIs. The phase file that moves each plugin holds the
acceptable visual differences.

### agents

**Today.** A `ListDetail`: sidebar of sessions on the left (custom sections of `Row`s with
`RowActions`); on the right a hand-built header, the transcript (an `Index` of `AgentEventCard`s,
each a custom card per event type with raw `<details>` folds), then the composer (custom shell with
context chips, a raw input, two `Picker`s, action buttons). Two `Modal`s for rename and archive. The
event card hosts other plugins' tool renderers and is the most complex component in the tree.

**As a tree.** `list-detail` whose detail region is `header-body-footer`. The transcript is a
`Timeline` of `Card`s; each tool card is a slot filled by the owning plugin's tree. The composer is a
`Composer` node with two slots.

```tsx
<Layout kind="list-detail">
  <Region name="list">
    <Section label="Needs you">{requests.map(r => <Row tone="warn" title={r.title} onPress=… />)}</Section>
    <Section label="Managed sessions">
      {sessions.map(s => <Row icon={s.provider} title={s.title} meta={s.state} actions={[rename, archive]} />)}
    </Section>
  </Region>
  <Region name="detail">
    <Layout kind="header-body-footer">
      <Region name="header"><Heading>{session.title}</Heading><StatusDot tone=… /><Menu items=… /></Region>
      <Region name="body">
        <Timeline>
          {events.map(e => e.kind === 'tool'
            ? <Slot point="tool-card" key={e.tool} props={e}><DefaultToolCard {...e} /></Slot>
            : <Card role={e.role}><Markdown>{e.text}</Markdown></Card>)}
        </Timeline>
      </Region>
      <Region name="footer">
        <Composer onSubmit={send}>
          <Slot point="composer-actions" mode="stack" max={4} />
          <Slot point="attachment" mode="replace" key={selected?.mime}><AttachmentChip … /></Slot>
        </Composer>
      </Region>
    </Layout>
  </Region>
</Layout>
```

**Rectangle left.** None in the pane. An image attachment is a rectangle on desktop and a filename
on a terminal. Agent Center is `header-body` of provider `Card`s, a filter `Toolbar`, and a `Row`
list. The three settings pages are `Field`s over `Select`, `Checkbox`, `Table`.

**Terminal.** Sessions, transcript, tool cards, composer, approvals all cross. This is the pane that
pays for the whole exercise and the hardest to move; it goes last.

### github

**Moved in phase 7.** The PR pane was a large custom detail: `PullSummary` (title, meta line, action
buttons, conflict alert), a label picker, reviewers, checks, a conversation of custom entries with two
`Composer`s, and `DiffForPull`. `GithubBrowse` was a hand-drawn three-column layout and `PullList`
owned its own virtualizer.

**As a tree.** The PR pane is `tabs` with Overview, Conversation and Files. Overview is `Heading`,
`Facts`, a `Toolbar` of actions, checks as `Row`s, and the `github:summary-badges` slot. Conversation
is a `Timeline` of `Card`s over two `Composer`s. Files is a split of the file list and `DiffPane`.
Browse is `ListDetail` whose detail is another `ListDetail`, which is what its three columns were. The
four stylesheets are gone.

**Rectangle left.** None. `DiffPane` is kit, implemented per host.

**Terminal.** Everything crosses.

### changes

**Today.** `ListDetail`: staged and unstaged groups of `Row`s with actions, a commit box (raw input
and buttons), `DiffPane` for the selected file. Review notes are custom rows under a hunk. The agent
tool renderer draws its tool's calls as a card in the transcript.

**As a tree.** `list-detail` with the commit box as the list region's footer. Review notes become
`DiffPane` annotations from the plugin itself, the same mechanism a coverage plugin uses. The tool
renderer is the first remote card and the proof for phase 3.

**Rectangle left.** None. changes drops off the first-party-only list; the tool renderer was its only
reason.

### editor

**Today.** `ListDetail` with a sidebar of `Tabs` (files as `TreeRow`s; search as input and results),
`DocumentTabs` over a raw div Monaco mounts into. The file palette is a `PaletteSurface` overlay.

**As a tree.** `frame-beside-document`, the document being the host editor and the beside region
the plugin's tree of tabs. This is the template `docs/third-party/editor.md` names as its one
blocker.

**Rectangle left.** Monaco. On a terminal the document region is a host text view, read-only in a
first version, with editing handed to `$EDITOR`. The palette is a `Picker` in a `Modal`.

### terminal

**Today.** A drawer with `SplitHandle`, `DocumentTabs` for sessions with a `Menu` of profiles, xterm
in the body.

**As a tree.** `stack-split` with a `tabs` header and a `Rectangle kind="pty"` body. The one plugin
where the terminal host has the better rendering.

### docker

**Today.** The task pane is container `Chip`s and a `ContainerDetail`: header with actions, `Tabs`
(info as `DescriptionList`, logs as a `pre` with `FindBar`, stats as `Meter`s, exec as xterm). Browse
is `TreeRow` groups with a filter `Toolbar`.

**As a tree.** `header-body` whose body is `tabs`. Logs become a `Log` node, stats stay `Meter`s, exec
is `Rectangle kind="pty"`, with a `stats-beside` stack slot. The footer badge is a descriptor already.

**Terminal.** Everything crosses; exec is native.

### context, memory, notes

**Today.** Context is a tray of sections, each a custom row with a `Meter`, expandable items with
origin badges, then a `CodeBlock` preview and a sync `Toolbar`. Memory renders a form (raw inputs,
`Select`, `Textarea`, accept and reject) inside context's tray through `contextSectionSlots`, the
docs' own example of a component that cannot be a descriptor. Notes is `list-detail` with a
`Markdown` view toggling to a `Textarea`.

**As a tree.** Context is `header-body-footer` whose body is a list of `Fold`s, one per section, and
each section is a slot. Memory's form is a tree grafted into its slot: `Field`, `Input`, `Select`,
`Textarea`, two `Button`s. Nothing in it is not kit, so memory becomes portable.

**Shipped (phase 6).** As described, with one thing the survey did not anticipate: memory stayed a
compiled component rather than becoming a worker bundle. The point is the same `remote` point either
way, and the carrier is `component` instead of a bundle hash. Making memory loadable is now a build
change with no host change behind it, which is the state the survey was aiming for.

```tsx
// context, the owner
<Region name="body">
  {sections.map(s =>
    <Fold label={s.label} meta={<Meter value={s.bytes} max={s.budget} compact />}>
      <Slot point="section" key={s.id}>
        {s.items.map(i => <Row title={i.title} badge={i.origin} checked={i.included} onToggle=… />)}
      </Slot>
    </Fold>)}
</Region>

// memory, filling context:section for key "memory"
<Stack>
  {proposals.map(p => <Card>
    <Field label="Name"><Input value={p.name} onChange=… /></Field>
    <Field label="Scope"><Select options={scopes} value={p.scope} /></Field>
    <Textarea value={p.body} />
    <Toolbar><Button tone="ok" onPress={accept}>Accept</Button><Button onPress={reject}>Reject</Button></Toolbar>
  </Card>)}
</Stack>
```

### http, database, linear, rollbar

Already iframes drawing with the kit plus a small stylesheet each. The difference for the author is
one build flag: render to the remote root instead of the iframe's DOM, and delete the CSS.

| Plugin | Layout | Tree, in one line | Rectangle left |
| --- | --- | --- | --- |
| http | `list-detail`, detail is `header-body` | `TreeRow` list; `Toolbar` (method `Select`, url `Input`, Send); `Tabs` (`KeyValueEditor`, `Textarea`); status strip; `Tabs` (`CodeBlock`, `Facts`) | none |
| database | `document-over-frame` | host SQL editor; `Toolbar` (`Picker` saved, Run); `Grid`; `Fold` row detail | Monaco on desktop; `ResultGrid` becomes kit `Grid` |
| linear | `header-body`, body is `tabs` | `Heading` eyebrow; `ChipRow`; `Tabs` (`Facts`, `Markdown`, `Timeline` and `Composer`) | none; inline images become links |
| rollbar | `header-body`, body is `tabs` | `Heading`; `ChipRow`; `Tabs` (`Facts`, `list-detail` of `Row`s and `CodeBlock` stack) | none |

### preview, browser, onboarding, workflows, model-providers, profiles

| Plugin | Today | As a tree |
| --- | --- | --- |
| preview | a URL `Input` over a `WebContentsView` | `header-body`: `Toolbar` (url, reload) over `Rectangle kind="webview"`, with a `beside` slot for audit rows |
| browser | agent tools only | a remote tool card showing the capture thumbnail and URL |
| onboarding | full-screen wizard in the overlay slot with custom backdrop | layout `wizard`; body is `Card`, `Field`, `Badge`, `Facts` |
| workflows | a settings section | `Field`s and `Alert`s |
| model-providers, profiles | no UI | none |

## What crosses to a terminal, and what does not

Recorded here so the door stays open, not because it is built.

| Plugin | Crosses | Does not |
| --- | --- | --- |
| agents | sessions, transcript, tool cards, composer, approvals | image attachments as images |
| github | list, overview, checks, conversation, diff with annotations, merge | nothing of note |
| changes | stage, diff, notes, commit, push | nothing |
| editor | file tree, search, read-only text view | Monaco; editing hands off to `$EDITOR` |
| terminal | the PTY, natively | nothing |
| docker | containers, info, logs with find, stats as bars, exec natively | nothing |
| context, memory, notes | all of it | nothing |
| http, linear, rollbar | all of it | inline images |
| database | SQL as a text region, results as a table | Monaco completions |
| preview, browser | URL, run state, capture filenames | the page |

A terminal client is not a subset. It is nearly the whole workspace minus three rectangles, and the
rectangle that defines an agent workspace is the one a terminal does best.

/** @jsxImportSource @opentui/solid */
import { createSignal, type JSX } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { TextAttributes } from '@opentui/core'
import { KIT_NODES, type KitNodeName } from '@acorn/protocol/tree/nodes.ts'
import { NODE_SUPPORT } from '@acorn/client-core/kit/tokens/support.ts'
import { NODE_FOCUS } from '@acorn/client-core/kit/tokens/focusRoles.ts'
import { hasFfi } from '../ffi'
import { HeaderBodyFooter } from '../layouts/HeaderBodyFooter'
import { renderCells, type Cells, type Frame } from './render'
import {
  Card, DetailColumn, DocumentTabs, Fold, Inline, ListColumn, ListDetail, Menu, Modal, ModalActions,
  ModalBody, Popover, Section, SectionHeader, Sections, SplitHandle, Stack, TabPanel, Tabs, Timeline,
  Toolbar,
  ToolbarSpacer,
} from './grouping'
import {
  Alert, Badge, Chip, ChipRow, CodeBlock, DescriptionList, DiffLine, DiffPane, EmptyState, Facts,
  FileHead, Grid, Heading, Icon, Kbd, Link, Log, Markdown, Meter, NonCodeRow, Row, RowActions, Rows,
  Spinner, SplitCell, StatusDot, Table, TableCell, TableHead, TableRow, Text, TreeRow, UserAvatar,
} from './showing'
import {
  Button, Checkbox, Composer, ConfirmButton, CopyButton, Field, FindBar, Input, KeyValueEditor,
  MentionTextarea, ModelConnectionPicker, Picker, PickerRow, SegmentedControl, Select, Textarea,
  ToggleButton,
} from './asking'
import { Fallback, Only, Rectangle } from './pixels'
import { Line } from './cells'
import { _resetCollections } from '../keys/collection'

// One case per kit node, asserting the sentence its row in docs/ui-design.md § Every node at 80 by 24
// promises, against the cells it actually drew.
//
// A case is written as "what would a reader look for on the screen", not as a snapshot of every cell.
// A snapshot fails on every spacing decision anybody makes afterwards and tells the next person
// nothing about which promise broke; `Badge` draws `[text]` is the promise.
//
// The list is checked against the kit itself below, so a node cannot be added with a component and no
// test any more than it can be added with a sentence and no component
// (tools/arch/kitTable.test.ts).

type Case = {
  node: KitNodeName
  /** What the sentence says, in the test's own words, so a failure names the promise. */
  draws: string
  render: () => import('solid-js').JSX.Element
  check: (frame: Frame) => void
  size?: { width?: number; height?: number }
}

const has = (frame: Frame, value: string) => expect(frame.text).toContain(value)
const lacks = (frame: Frame, value: string) => expect(frame.text).not.toContain(value)
const lineWith = (frame: Frame, value: string) => frame.lines.find((line) => line.includes(value)) ?? ''
const rowOf = (frame: Frame, value: string) => frame.lines.findIndex((line) => line.includes(value))

const noteFile = {
  path: 'src/login.ts',
  status: 'modified',
  additions: 3,
  deletions: 1,
  sha: null,
  viewed: false,
  patch: '@@ -1,2 +1,3 @@\n context\n-gone\n+added\n',
}

const CASES: Case[] = [
  // ── Grouping ────────────────────────────────────────────────────────────────────────────────
  {
    node: 'Stack',
    draws: 'children on successive lines',
    render: () => <Stack><Text>one</Text><Text>two</Text></Stack>,
    check: (frame) => expect(rowOf(frame, 'two')).toBe(rowOf(frame, 'one') + 1),
  },
  {
    node: 'Inline',
    draws: 'children on one line separated by a space',
    render: () => <Inline><Text>one</Text><Text>two</Text></Inline>,
    check: (frame) => expect(lineWith(frame, 'one')).toContain('two'),
  },
  {
    node: 'Section',
    draws: 'label in dim uppercase, children below',
    render: () => <Section label="notes" count={3}><Text>body</Text></Section>,
    check: (frame) => {
      has(frame, 'NOTES')
      expect(rowOf(frame, 'body')).toBeGreaterThan(rowOf(frame, 'NOTES'))
    },
  },
  {
    node: 'Fold',
    draws: '▸ label closed, ▾ label open, children indented two cells',
    render: () => (
      <Stack>
        <Fold label="shut"><Text>hidden</Text></Fold>
        <Fold label="open" defaultOpen><Text>shown</Text></Fold>
      </Stack>
    ),
    check: (frame) => {
      has(frame, '▸ shut')
      has(frame, '▾ open')
      lacks(frame, 'hidden')
      expect(lineWith(frame, 'shown').indexOf('shown')).toBe(2)
    },
  },
  {
    node: 'Card',
    draws: 'a box-drawing frame',
    render: () => <Card><Text>inside</Text></Card>,
    check: (frame) => {
      has(frame, '─')
      has(frame, 'inside')
    },
  },
  {
    node: 'Timeline',
    draws: 'cards in sequence',
    render: () => <Timeline><Text>first</Text><Text>second</Text></Timeline>,
    check: (frame) => expect(rowOf(frame, 'second')).toBe(rowOf(frame, 'first') + 1),
  },
  {
    node: 'Tabs',
    draws: 'Tab  [Tab]  Tab on one line, the selected one in brackets',
    render: () => (
      <Tabs
        idPrefix="t"
        ariaLabel="Tabs"
        active="b"
        onChange={() => {}}
        tabs={[{ id: 'a', label: 'one' }, { id: 'b', label: 'two' }]}
      />
    ),
    check: (frame) => expect(lineWith(frame, 'one')).toContain('[two]'),
  },
  {
    node: 'Toolbar',
    draws: 'children on one line',
    render: () => <Toolbar><Text>left</Text><Text>right</Text></Toolbar>,
    check: (frame) => expect(lineWith(frame, 'left')).toContain('right'),
  },
  {
    node: 'ToolbarSpacer',
    draws: 'the padding that pushes what follows to the right edge',
    render: () => <Toolbar><Text>left</Text><ToolbarSpacer /><Text>end</Text></Toolbar>,
    check: (frame) => expect(lineWith(frame, 'left').trimEnd().endsWith('end')).toBe(true),
  },
  {
    node: 'Modal',
    draws: 'a centred box with its title',
    render: () => <Modal onDismiss={() => {}} title="Rename"><Text>body</Text></Modal>,
    check: (frame) => {
      has(frame, 'Rename')
      has(frame, 'body')
      has(frame, '│')
    },
  },
  {
    node: 'ModalBody',
    draws: 'the lines between the title rule and the actions line',
    render: () => <ModalBody><Text>middle</Text></ModalBody>,
    check: (frame) => has(frame, 'middle'),
  },
  {
    node: 'ModalActions',
    draws: 'the buttons on one line, at the far end of the box',
    render: () => <ModalActions><Button label="Cancel" /><Button label="Save" /></ModalActions>,
    check: (frame) => {
      const line = lineWith(frame, '[Save]')
      expect(line).toContain('[Cancel]')
      expect(line.trimEnd().endsWith('[Save]')).toBe(true)
    },
  },
  {
    node: 'Menu',
    draws: 'a vertical list in a box',
    render: () => (
      <Menu ariaLabel="Menu" open={() => true} trigger={() => <Text>open me</Text>}>
        {() => <Text>choice</Text>}
      </Menu>
    ),
    check: (frame) => {
      has(frame, 'open me')
      has(frame, 'choice')
      has(frame, '│')
    },
  },
  {
    node: 'Popover',
    draws: 'reduced: a full-width block under its anchor rather than a floating panel',
    render: () => <Popover trigger={() => <Text>anchor</Text>}><Text>panel</Text></Popover>,
    check: (frame) => {
      has(frame, 'anchor')
      // Shut until something opens it, which is the same state the DOM popover starts in.
      lacks(frame, 'panel')
    },
  },
  {
    node: 'ListDetail',
    draws: 'reduced: two columns above 80 cells',
    render: () => <ListDetail list={<Text>the list</Text>}><Text>the detail</Text></ListDetail>,
    size: { width: 100, height: 6 },
    check: (frame) => {
      const line = lineWith(frame, 'the list')
      expect(line).toContain('│')
      expect(line).toContain('the detail')
    },
  },
  {
    node: 'Sections',
    draws: 'reduced: a strip of tabs over one panel, with main beside it while there is room',
    render: () => (
      <Sections
        id="case"
        ariaLabel="Sections"
        header={{ id: 'summary', label: 'Summary', render: () => <Text>what it is about</Text> }}
        sections={[
          { id: 'one', label: 'One', count: 2, render: () => <Text>first section</Text> },
          { id: 'two', label: 'Two', render: () => <Text>second section</Text> },
        ]}
        main={{ id: 'body', label: 'Body', render: () => <Text>the main region</Text> }}
      />
    ),
    size: { width: 140, height: 8 },
    check: (frame) => {
      const strip = lineWith(frame, 'Summary')
      expect(strip).toContain('One 2')
      expect(strip).toContain('Two')
      // The header is the tab that opens, and `main` keeps a column of its own at 140 cells.
      const body = lineWith(frame, 'what it is about')
      expect(body).toContain('the main region')
      expect(lineWith(frame, 'first section')).toBe('')
    },
  },
  {
    node: 'ListColumn',
    draws: 'reduced: the left column, with its label',
    render: () => <ListColumn label="notes"><Text>a note</Text></ListColumn>,
    check: (frame) => {
      has(frame, 'NOTES')
      has(frame, 'a note')
    },
  },
  {
    node: 'DetailColumn',
    draws: 'the right column',
    render: () => <DetailColumn><Text>detail</Text></DetailColumn>,
    check: (frame) => has(frame, 'detail'),
  },
  {
    node: 'SplitHandle',
    draws: 'absent: a terminal split moves by a key, not a grip',
    render: () => <Stack><Text>above</Text><SplitHandle axis="x" drag={{}} /><Text>below</Text></Stack>,
    check: (frame) => expect(rowOf(frame, 'below')).toBe(rowOf(frame, 'above') + 1),
  },
  {
    node: 'DocumentTabs',
    draws: 'one line of tab labels with a × on the current one',
    render: () => (
      <DocumentTabs
        idPrefix="d"
        ariaLabel="Documents"
        active="b"
        onActivate={() => {}}
        onClose={() => {}}
        tabs={[{ id: 'a', label: 'one' }, { id: 'b', label: 'two' }]}
      />
    ),
    check: (frame) => expect(lineWith(frame, 'one')).toContain('two ×'),
  },
  {
    node: 'SectionHeader',
    draws: 'a bold line with its actions at the far end',
    render: () => <SectionHeader actions={<Button label="New" />}>Files</SectionHeader>,
    check: (frame) => {
      const line = lineWith(frame, 'Files')
      expect(line.trimEnd().endsWith('[New]')).toBe(true)
    },
  },
  {
    node: 'TabPanel',
    draws: 'the rows under the tab strip, and nothing for a panel that is not current',
    render: () => (
      <Stack>
        <TabPanel idPrefix="t" id="a" active="a"><Text>current</Text></TabPanel>
        <TabPanel idPrefix="t" id="b" active="a"><Text>other</Text></TabPanel>
      </Stack>
    ),
    check: (frame) => {
      has(frame, 'current')
      lacks(frame, 'other')
    },
  },

  // ── Showing ─────────────────────────────────────────────────────────────────────────────────
  {
    node: 'Text',
    draws: 'plain text',
    render: () => <Text>words</Text>,
    check: (frame) => has(frame, 'words'),
  },
  {
    node: 'Link',
    draws: 'the text, underlined',
    render: () => <Link href="https://example.com">go there</Link>,
    check: (frame) => has(frame, 'go there'),
  },
  {
    node: 'Heading',
    draws: 'eyebrow in dim uppercase, heading in bold',
    render: () => <Heading eyebrow="task">fix login</Heading>,
    check: (frame) => {
      has(frame, 'TASK')
      expect(rowOf(frame, 'fix login')).toBe(rowOf(frame, 'TASK') + 1)
    },
  },
  {
    node: 'Rows',
    draws: 'its items on successive lines',
    render: () => (
      <Rows id="list" items={[{ key: 'a', label: 'alpha' }, { key: 'b', label: 'beta' }]}>
        {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
      </Rows>
    ),
    check: (frame) => expect(rowOf(frame, 'beta')).toBe(rowOf(frame, 'alpha') + 1),
  },
  {
    node: 'Row',
    draws: 'one line: status glyph, title, meta at the far end',
    render: () => <Row leading={<StatusDot tone="ok" />} meta="2m">a title</Row>,
    check: (frame) => {
      const line = lineWith(frame, 'a title')
      expect(line).toContain('●')
      expect(line.trimEnd().endsWith('2m')).toBe(true)
    },
  },
  {
    node: 'TreeRow',
    draws: 'Row indented depth cells with ▸ or ▾',
    render: () => <TreeRow depth={1} expandable expanded={false}>src</TreeRow>,
    check: (frame) => {
      const line = lineWith(frame, 'src')
      expect(line).toContain('▸')
      expect(line.indexOf('▸')).toBeGreaterThanOrEqual(2)
    },
  },
  {
    node: 'RowActions',
    draws: "the row's actions as glyphs, always drawn, never on hover",
    render: () => <Row reveal trailing={<RowActions ariaLabel="Actions">{() => <Icon name="x" />}</RowActions>}>a row</Row>,
    check: (frame) => expect(lineWith(frame, 'a row')).toContain('✕'),
  },
  {
    node: 'Badge',
    draws: '[text] in the tone colour',
    render: () => <Badge tone="ok">ready</Badge>,
    check: (frame) => has(frame, '[ready]'),
  },
  {
    node: 'Chip',
    draws: '(text), with a trailing ✕ when removable',
    render: () => <Chip onRemove={() => {}}>bug</Chip>,
    check: (frame) => has(frame, '(bug ✕)'),
  },
  {
    node: 'ChipRow',
    draws: 'chips on one line',
    render: () => <ChipRow><Chip>one</Chip><Chip>two</Chip></ChipRow>,
    check: (frame) => expect(lineWith(frame, '(one)')).toContain('(two)'),
  },
  {
    node: 'StatusDot',
    draws: '● in colour, ○ for muted',
    render: () => <Inline><StatusDot tone="ok" /><StatusDot tone="muted" /></Inline>,
    check: (frame) => {
      has(frame, '●')
      has(frame, '○')
    },
  },
  {
    node: 'Facts',
    draws: 'two columns, labels dim',
    render: () => <Facts items={[{ label: 'branch', value: 'main' }, { label: 'by', value: 'you' }]} />,
    check: (frame) => {
      expect(lineWith(frame, 'branch')).toContain('main')
      // Padded to the widest label, so the values line up.
      expect(lineWith(frame, 'main').indexOf('main')).toBe(lineWith(frame, 'you').indexOf('you'))
    },
  },
  {
    node: 'DescriptionList',
    draws: 'one pair per line',
    render: () => (
      <DescriptionList>
        <DescriptionList.Item label="size">21 B</DescriptionList.Item>
      </DescriptionList>
    ),
    check: (frame) => expect(lineWith(frame, 'size')).toContain('21 B'),
  },
  {
    node: 'Table',
    draws: 'reduced: box-drawn, and a line under it names the columns it had to drop',
    render: () => (
      <Table>
        <TableRow head>
          <TableHead priority="high">name</TableHead>
          <TableHead priority="low">when</TableHead>
        </TableRow>
        <TableRow><TableCell>lint</TableCell><TableCell>2m</TableCell></TableRow>
      </Table>
    ),
    size: { width: 10, height: 6 },
    check: (frame) => {
      // Ten cells is one column's worth, so the low-priority one goes — and a muted line under the
      // table names it, because a reader who can only see that something is missing has to widen the
      // pane to find out whether it was the column they wanted.
      expect(lineWith(frame, 'name')).not.toContain('when')
      has(frame, '+ when')
    },
  },
  {
    node: 'TableHead',
    draws: "reduced: the column's label in the bold header line",
    render: () => (
      <Table>
        <TableRow head><TableHead>name</TableHead><TableHead>when</TableHead></TableRow>
      </Table>
    ),
    check: (frame) => expect(lineWith(frame, 'name')).toContain('when'),
  },
  {
    node: 'TableRow',
    draws: 'reduced: one line per row',
    render: () => (
      <Table>
        <TableRow><TableCell>lint</TableCell><TableCell>2m</TableCell></TableRow>
        <TableRow><TableCell>test</TableCell><TableCell>4m</TableCell></TableRow>
      </Table>
    ),
    check: (frame) => expect(rowOf(frame, 'test')).toBe(rowOf(frame, 'lint') + 1),
  },
  {
    node: 'TableCell',
    draws: "reduced: the cell's text in its column's width, ellipsised where it does not fit",
    render: () => (
      <Table>
        <TableRow><TableCell>a very long cell indeed</TableCell></TableRow>
      </Table>
    ),
    size: { width: 12, height: 4 },
    check: (frame) => has(frame, '…'),
  },
  {
    node: 'Grid',
    draws: 'reduced: as Table, with a row-range indicator instead of a scrollbar',
    render: () => (
      <Grid
        ariaLabel="Runs"
        columns={['name', 'when']}
        rows={[['lint', '2m'], ['test', '4m'], ['build', '9m']]}
        selected={0}
      />
    ),
    size: { width: 30, height: 5 },
    check: (frame) => {
      has(frame, 'name')
      has(frame, 'of 3')
    },
  },
  {
    node: 'Meter',
    draws: '████░░░░ 62%',
    render: () => <Meter value={0.5} label="Disk" />,
    check: (frame) => {
      const line = lineWith(frame, '50%')
      expect(line).toContain('████')
      expect(line).toContain('░')
    },
  },
  {
    node: 'CodeBlock',
    draws: 'monospace lines, a dim rule above and below',
    render: () => <CodeBlock>{'first\nsecond'}</CodeBlock>,
    check: (frame) => {
      expect(rowOf(frame, 'second')).toBe(rowOf(frame, 'first') + 1)
      expect(rowOf(frame, 'first')).toBeGreaterThan(rowOf(frame, '───'))
    },
  },
  {
    node: 'Log',
    draws: 'monospace lines, find as a bottom line',
    render: () => <Log ariaLabel="Logs" lines={['boot', 'ready']} find={<Text>/ query</Text>} />,
    size: { width: 30, height: 5 },
    check: (frame) => {
      has(frame, 'boot')
      expect(rowOf(frame, '/ query')).toBeGreaterThan(rowOf(frame, 'ready'))
    },
  },
  {
    node: 'Markdown',
    draws: 'reduced: headings bold, lists as •, no images, links as text with the URL',
    render: () => (
      <Markdown text={'# Title\n\n- one\n- two\n\n![alt](https://example.com/a.png)\n\n[docs](https://example.com)'} />
    ),
    size: { width: 60, height: 12 },
    check: (frame) => {
      has(frame, 'Title')
      has(frame, '• one')
      has(frame, 'docs')
      has(frame, '(https://example.com)')
      lacks(frame, 'a.png')
    },
  },
  {
    node: 'DiffPane',
    draws: 'reduced: unified only',
    render: () => <DiffPane source={{ files: () => [noteFile], loading: () => false }} />,
    size: { width: 40, height: 10 },
    check: (frame) => {
      has(frame, 'src/login.ts')
      has(frame, '+added')
      has(frame, '-gone')
    },
  },
  {
    node: 'DiffLine',
    draws: 'reduced: one line, +/-/space in the gutter',
    render: () => (
      <DiffLine r={{ kind: 'insert', path: 'a.ts', oldNo: null, newNo: 3, toks: [], raw: 'added' }} />
    ),
    check: (frame) => has(frame, '+added'),
  },
  {
    node: 'FileHead',
    draws: 'reduced: the path in bold with +n −m at the far end',
    render: () => <FileHead file={noteFile} />,
    size: { width: 40, height: 3 },
    check: (frame) => {
      const line = lineWith(frame, 'src/login.ts')
      expect(line).toContain('+3')
      expect(line.trimEnd().endsWith('−1')).toBe(true)
    },
  },
  {
    node: 'NonCodeRow',
    draws: 'reduced: a dim line saying what is not being shown',
    render: () => <NonCodeRow row={{ kind: 'gap', path: 'a.ts', sha: null, side: 'mid', oldStart: 1, newStart: 1, count: 12 }} />,
    check: (frame) => has(frame, '12 unchanged lines'),
  },
  {
    node: 'SplitCell',
    draws: 'absent: side-by-side needs 160 cells',
    render: () => (
      <Stack>
        <Text>above</Text>
        <SplitCell r={null} gutter={null} />
        <Text>below</Text>
      </Stack>
    ),
    check: (frame) => expect(rowOf(frame, 'below')).toBe(rowOf(frame, 'above') + 1),
  },
  {
    node: 'EmptyState',
    draws: 'dim text',
    render: () => <EmptyState title="Nothing yet">Make one to get started.</EmptyState>,
    check: (frame) => {
      has(frame, 'Nothing yet')
      has(frame, 'Make one')
    },
  },
  {
    node: 'Alert',
    draws: "one line prefixed with the tone's glyph",
    render: () => <Alert tone="warn">Careful.</Alert>,
    check: (frame) => expect(lineWith(frame, 'Careful.')).toContain('!'),
  },
  {
    node: 'Spinner',
    draws: 'reduced: a braille spinner',
    render: () => <Spinner />,
    check: (frame) => has(frame, '⠋'),
  },
  {
    node: 'Kbd',
    draws: 'the chord as its characters',
    render: () => <Kbd>ctrl+k</Kbd>,
    check: (frame) => has(frame, 'ctrl+k'),
  },
  {
    node: 'UserAvatar',
    draws: 'reduced: initials in brackets, no image',
    render: () => <UserAvatar login="ada-lovelace" />,
    check: (frame) => has(frame, '[AL]'),
  },
  {
    node: 'Icon',
    draws: 'reduced: a glyph from the name table, and nothing for a name with none',
    render: () => <Inline><Icon name="check" /><Icon name="not-a-real-icon" /></Inline>,
    check: (frame) => {
      has(frame, '✓')
      lacks(frame, 'not-a-real-icon')
    },
  },

  // ── Asking ──────────────────────────────────────────────────────────────────────────────────
  {
    node: 'Button',
    draws: '[ label ]',
    render: () => <Button label="Save" />,
    check: (frame) => has(frame, '[Save]'),
  },
  {
    node: 'ConfirmButton',
    draws: 'the label at rest; the armed button is the prompt',
    render: () => <ConfirmButton label="Delete" onConfirm={() => {}} />,
    check: (frame) => {
      has(frame, '[Delete]')
      // Arming is a press, and a button becomes a focus stop in phase 2. The armed label is
      // `createArmedConfirm`'s, which client-core tests directly.
      lacks(frame, 'Delete?')
    },
  },
  {
    node: 'Input',
    draws: 'a field that takes the room its row has left',
    render: () => <Input placeholder="Filter…" />,
    size: { width: 30, height: 3 },
    check: (frame) => has(frame, 'Filter'),
  },
  {
    node: 'Textarea',
    draws: 'a multi-line field holding its value',
    render: () => <Textarea value={'first\nsecond'} rows={3} />,
    size: { width: 30, height: 5 },
    check: (frame) => {
      has(frame, 'first')
      has(frame, 'second')
    },
  },
  {
    node: 'Select',
    draws: '[ value ▾ ], opening a Menu',
    render: () => (
      <Select value="b" options={[{ value: 'a', label: 'one' }, { value: 'b', label: 'two' }]} />
    ),
    check: (frame) => has(frame, '[ two ▾ ]'),
  },
  {
    node: 'Checkbox',
    draws: '[x] label',
    render: () => <Checkbox checked label="Include" />,
    check: (frame) => expect(lineWith(frame, 'Include')).toContain('[x]'),
  },
  {
    node: 'SegmentedControl',
    draws: '( a | [b] | c )',
    render: () => (
      <SegmentedControl
        ariaLabel="View"
        value="b"
        onChange={() => {}}
        options={[{ value: 'a' as const, label: 'a' }, { value: 'b' as const, label: 'b' }]}
      />
    ),
    check: (frame) => has(frame, '( a | [b] )'),
  },
  {
    node: 'ToggleButton',
    draws: '[x] label',
    render: () => <ToggleButton pressed label="Preview" onPressedChange={() => {}} />,
    check: (frame) => expect(lineWith(frame, 'Preview')).toContain('[x]'),
  },
  {
    node: 'Picker',
    draws: 'a field that opens a Menu filtered by typing',
    render: () => <Picker label="Repo" placeholder="Find…" emptyText="Nothing" items={[]} />,
    check: (frame) => has(frame, '[ Repo ▾ ]'),
  },
  {
    node: 'PickerRow',
    draws: 'one line in that menu: glyph, label, dim hint',
    render: () => <PickerRow label="acorn" description="runn-fast" onSelect={() => {}} />,
    check: (frame) => expect(lineWith(frame, 'acorn')).toContain('runn-fast'),
  },
  {
    node: 'Composer',
    draws: 'a boxed field with a > prompt',
    render: () => <Composer value="hello" onSubmit={() => {}} submitLabel="Send" />,
    size: { width: 40, height: 8 },
    check: (frame) => {
      has(frame, '>')
      has(frame, '[Send]')
    },
  },
  {
    node: 'MentionTextarea',
    draws: 'reduced: a Textarea with the mention menu below it, no inline highlight',
    render: () => <MentionTextarea value="ping @ad" onInput={() => {}} mentions={['ada', 'bob']} />,
    size: { width: 40, height: 8 },
    check: (frame) => {
      has(frame, 'ping @ad')
      has(frame, 'ada')
      lacks(frame, 'bob')
    },
  },
  {
    node: 'KeyValueEditor',
    draws: 'a two-column table with editable cells',
    render: () => (
      <KeyValueEditor ariaLabel="Headers" rows={[{ key: 'Accept', value: 'text/plain' }]} onChange={() => {}} />
    ),
    size: { width: 50, height: 6 },
    check: (frame) => {
      has(frame, 'Name')
      has(frame, 'Accept')
      has(frame, 'text/plain')
    },
  },
  {
    node: 'FindBar',
    draws: '/ query  3/12 on one line',
    render: () => (
      <FindBar query="login" onQuery={() => {}} count={{ current: 3, total: 12 }} onNext={() => {}} onPrev={() => {}} />
    ),
    size: { width: 40, height: 3 },
    check: (frame) => {
      const line = lineWith(frame, '/')
      expect(line).toContain('login')
      expect(line).toContain('3/12')
    },
  },
  {
    node: 'Field',
    draws: 'the label above its child',
    render: () => <Field label="Title"><Text>a note</Text></Field>,
    check: (frame) => expect(rowOf(frame, 'a note')).toBe(rowOf(frame, 'Title') + 1),
  },
  {
    node: 'CopyButton',
    draws: 'fallback: a control that copies where the terminal takes OSC 52, and prints otherwise',
    render: () => <CopyButton text={() => 'copied text'} />,
    check: (frame) => has(frame, '⧉'),
  },
  {
    node: 'ModelConnectionPicker',
    draws: 'a picker over the connected models',
    render: () => (
      <ModelConnectionPicker
        connectionId="c1"
        modelId="m1"
        onChange={() => {}}
        connections={[{ connection: { id: 'c1', label: 'Anthropic' }, provider: { models: [{ id: 'm1', label: 'Opus' }] } }]}
      />
    ),
    check: (frame) => has(frame, '[ Opus ▾ ]'),
  },

  // ── Pixels, and the host wrappers ───────────────────────────────────────────────────────────
  {
    node: 'Rectangle',
    draws: 'pty and editor native; webview and frame draw their Fallback child',
    render: () => (
      <Stack>
        <Rectangle kind="pty" label="Terminal" />
        <Rectangle kind="webview" label="Preview"><Fallback forNode="Rectangle"><Text>open it in a browser</Text></Fallback></Rectangle>
      </Stack>
    ),
    // Taller than most cases: a `pty` rectangle is a real emulator with a real screen in it and grows
    // to fill what it is given, so two rectangles stacked in ten lines leave the second one no interior
    // at all — and since the pane sweep nothing in the kit shrinks to make room, it clips instead.
    size: { width: 40, height: 30 },
    check: (frame) => {
      has(frame, 'Terminal')
      // The box says how to get into it, which is what makes it one stop rather than a picture
      // (../keys/install.ts, ./rectangle.tsx).
      has(frame, 'enter')
      has(frame, 'open it in a browser')
    },
  },
  {
    node: 'Only',
    draws: 'children on the named hosts and nowhere else',
    render: () => (
      <Stack>
        <Only hosts={['tui']}><Text>here</Text></Only>
        <Only hosts={['dom']}><Text>elsewhere</Text></Only>
      </Stack>
    ),
    check: (frame) => {
      has(frame, 'here')
      lacks(frame, 'elsewhere')
    },
  },
  {
    node: 'Fallback',
    draws: 'what to draw where this host cannot draw the node it is inside',
    render: () => (
      <Stack>
        <Fallback forNode="SplitHandle"><Text>no grip here</Text></Fallback>
        <Fallback forNode="Badge"><Text>never</Text></Fallback>
      </Stack>
    ),
    check: (frame) => {
      has(frame, 'no grip here')
      lacks(frame, 'never')
    },
  },
]

describe.skipIf(!hasFfi)('the kit in cells', () => {
  it('has a case for every node in the kit, and no case for a node that is gone', () => {
    expect(CASES.map((entry) => entry.node).sort()).toEqual([...KIT_NODES].sort())
    // Anti-vacuity: two empty lists compare equal, and the kit is not empty.
    expect(CASES.length).toBeGreaterThan(70)
  })

  it.each(CASES.map((entry) => [`${entry.node}: ${entry.draws}`, entry] as const))('%s', async (_name, entry) => {
    // The collection store is module state, so two renders in one process share a caret.
    _resetCollections()
    const frame = await renderCells(entry.render, entry.size)
    try {
      entry.check(frame)
    } finally {
      frame.done()
    }
  }, 20_000)

  it('draws loose text wherever it lands, in every shape that has thrown', async () => {
    // The class, not an instance. A run of text needs a `text` parent here and on the DOM a bare
    // string anywhere is a text node nobody thinks about, so `<Stack>{count()}</Stack>` is correct kit
    // that used to throw — out of `insertNode`, inside a signal write, which aborts the update pass
    // and stops the screen following with nothing to say why.
    //
    // Every case below is one that reached a reader before `kit/reconciler.ts` answered it in one
    // place. They stay together because what is being tested is the boundary, not the six components.
    const [count, setCount] = createSignal(7)
    const cases: [string, () => JSX.Element][] = [
      ['loose text in a Stack', () => <Stack>hello</Stack>],
      ['a dynamic string in a Stack', () => <Stack>{count()}</Stack>],
      ['a node beside a dynamic string', () => <Line><Icon name="copy" />{count()}</Line>],
      ['a node beside text in an Inline', () => <Inline><Icon name="copy" />{'x'}</Inline>],
      ['an empty string in a Card', () => <Card>{''}</Card>],
    ]
    for (const [, render] of cases) {
      _resetCollections()
      const frame = await renderCells(render, { width: 20, height: 4 })
      frame.done()
    }
    setCount(8)
  }, 30_000)

  it('draws a node beside a value that changes, and keeps drawing it when it does', async () => {
    // The shape every element-typed prop and every mixed line is: one node and one dynamic string.
    // Solid compiles the string half to an accessor, and `slot` used to hand that straight back — so
    // the renderer inserted a bare string into a box, which is the one structure a cell host refuses.
    // It threw from inside whatever signal had just moved, which on a row holding a count meant the
    // whole update pass died and the screen stopped following (./cells.tsx § slot).
    //
    // Reactive, not just first paint: reading the accessor inside `slot` has to be a tracked read, or
    // the fix trades a crash for a number that never changes.
    _resetCollections()
    const [count, setCount] = createSignal(7)
    const frame = await renderCells(() => <Line><Icon name="copy" />{count()}</Line>, { width: 20, height: 3 })
    try {
      expect(frame.text).toContain('7')
      setCount(8)
      expect((await frame.frame()).text).toContain('8')
    } finally {
      frame.done()
    }
  }, 20_000)

  it('an absent node draws nothing at all, rather than a placeholder', async () => {
    // The difference that makes `absent` a level rather than a bug: a node this host refuses draws a
    // labelled placeholder, and a node the matrix says is absent draws nothing and takes no room.
    const absent = Object.entries(NODE_SUPPORT).filter(([, row]) => row.tui === 'absent').map(([node]) => node)
    expect(absent.sort()).toEqual(['Rectangle', 'SplitCell', 'SplitHandle'])
    _resetCollections()
    const frame = await renderCells(() => (
      <Stack><SplitHandle axis="x" drag={{}} /><SplitCell r={null} gutter={null} /></Stack>
    ), { width: 30, height: 4 })
    try {
      expect(frame.lines.filter((line) => line.trim().length)).toEqual([])
    } finally {
      frame.done()
    }
  }, 20_000)
})

// ── Behaviour: every control is a stop ─────────────────────────────────────────────────────────
//
// The cases above assert the characters a node draws. These assert that it does something: the keys
// land on it, it says so, and the handler its props have always carried is called
// (docs/tui.md § Keys and focus).
//
// Each case is drawn as the whole body of a pane, and nothing presses Tab first: a region takes the
// keys when the pane opens, because this host has no pointer to click with
// (../keys/regions.ts § regionFocus). So the node under test has to be the region's first stop, which
// for one control in an empty body it is.

type Behaviour = {
  node: KitNodeName
  /** The promise, in the test's own words, so a failure names it rather than a line number. */
  does: string
  /** The node, wired so its handlers write into the list `drive` reads. */
  render: (record: (what: string) => void) => JSX.Element
  /** Press keys and assert. `pressed` is everything recorded so far, in order. */
  drive: (screen: Cells, pressed: string[]) => Promise<void>
  size?: { width?: number; height?: number }
}

/** The run containing this text is drawn in the focused form: `strong` in the `accent` tone.
 *
 *  Read off the colours rather than the characters, because that is where the answer is — a focused
 *  `[Save]` has the same six characters as an unfocused one. Accent is the palette's own sixth slot
 *  and the default foreground is white, so "the red channel is below the green" is "this is the accent
 *  slot" without naming a hex anywhere (../appearance.ts § TERMINAL_PALETTE). */
const lit = (screen: Cells, text: string) => {
  const run = screen.runs().find((entry) => entry.text.includes(text))
  expect(run, `no run containing ${JSON.stringify(text)}`).toBeDefined()
  expect(run!.fg.r).toBeLessThan(run!.fg.g)
  expect(run!.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
}

const BEHAVIOURS: Behaviour[] = [
  {
    node: 'Button',
    does: 'presses on Enter, and draws the focused form while it has the keys',
    render: (record) => <Button label="Save" onPress={() => record('press')} />,
    drive: async (screen, pressed) => {
      lit(screen, '[Save]')
      await screen.press('RETURN')
      expect(pressed).toEqual(['press'])
    },
  },
  {
    node: 'ConfirmButton',
    does: 'arms on the first press and confirms on the second',
    render: (record) => <ConfirmButton label="Delete" onConfirm={() => record('confirm')} />,
    drive: async (screen, pressed) => {
      const armed = await screen.press('RETURN')
      expect(armed.text).toContain('Delete?')
      expect(pressed).toEqual([])
      await armed.press('RETURN')
      expect(pressed).toEqual(['confirm'])
    },
  },
  {
    node: 'CopyButton',
    does: 'copies on Enter',
    render: (record) => <CopyButton text={() => 'copied text'} onCopy={record} />,
    drive: async (screen, pressed) => {
      await screen.press('RETURN')
      expect(pressed).toEqual(['copied text'])
    },
  },
  {
    node: 'Link',
    does: 'presses on Enter where it was given a handler',
    render: (record) => <Link onPress={() => record('press')}>go there</Link>,
    drive: async (screen, pressed) => {
      await screen.press('RETURN')
      expect(pressed).toEqual(['press'])
    },
  },
  {
    node: 'Link',
    does: 'prints the URL on the line below where all it has is an href',
    render: () => <Link href="https://example.com">go there</Link>,
    size: { width: 30, height: 4 },
    drive: async (screen) => {
      expect(screen.text).not.toContain('example.com')
      expect((await screen.press('RETURN')).text).toContain('https://example.com')
    },
  },
  {
    node: 'Checkbox',
    does: 'toggles on Space and on Enter, because both are activate',
    render: (record) => <Checkbox label="Include" onChange={(checked) => record(String(checked))} />,
    drive: async (screen, pressed) => {
      // A literal space, because `KeyCodes` has no name for it — a named key there is one with an
      // escape sequence, and space is a character.
      const spaced = await screen.press(' ')
      expect(pressed).toEqual(['true'])
      await spaced.press('RETURN')
      expect(pressed).toEqual(['true', 'true'])
    },
  },
  {
    node: 'ToggleButton',
    does: 'toggles on Enter',
    render: (record) => (
      <ToggleButton pressed={false} label="Preview" onPressedChange={(pressed) => record(String(pressed))} />
    ),
    drive: async (screen, pressed) => {
      await screen.press('RETURN')
      expect(pressed).toEqual(['true'])
    },
  },
  {
    node: 'Chip',
    does: 'presses on Enter and removes on Delete',
    render: (record) => (
      <Chip onPress={() => record('press')} onRemove={() => record('remove')}>bug</Chip>
    ),
    drive: async (screen, pressed) => {
      const after = await screen.press('RETURN')
      expect(pressed).toEqual(['press'])
      await after.press('DELETE')
      expect(pressed).toEqual(['press', 'remove'])
    },
  },
  {
    node: 'Fold',
    does: 'opens on Enter with the header keeping the keys',
    render: () => <Fold label="notes"><Text>shown</Text></Fold>,
    drive: async (screen) => {
      expect(screen.text).toContain('▸ notes')
      lit(screen, 'notes')
      const open = await screen.press('RETURN')
      expect(open.text).toContain('▾ notes')
      expect(open.text).toContain('shown')
    },
  },
  {
    node: 'Card',
    does: 'presses on Enter where it was given a handler',
    render: (record) => <Card onPress={() => record('press')}><Text>inside</Text></Card>,
    drive: async (screen, pressed) => {
      await screen.press('RETURN')
      expect(pressed).toEqual(['press'])
    },
  },
  {
    node: 'TableRow',
    does: 'presses on Enter, marking the focused row at its end',
    render: (record) => (
      <Table>
        <TableRow onPress={() => record('press')}><TableCell>lint</TableCell></TableRow>
      </Table>
    ),
    size: { width: 30, height: 4 },
    drive: async (screen, pressed) => {
      expect(screen.text).toContain('›')
      await screen.press('RETURN')
      expect(pressed).toEqual(['press'])
    },
  },
  {
    node: 'SegmentedControl',
    does: 'changes its value on the horizontal arrows, one stop from outside',
    render: (record) => {
      const [value, setValue] = createSignal<'a' | 'b'>('a')
      return (
        <SegmentedControl
          ariaLabel="View"
          value={value()}
          options={[{ value: 'a' as const, label: 'a' }, { value: 'b' as const, label: 'b' }]}
          onChange={(next) => { setValue(next); record(next) }}
        />
      )
    },
    drive: async (screen, pressed) => {
      expect(screen.text).toContain('( [a] | b )')
      const moved = await screen.press('ARROW_RIGHT')
      expect(pressed).toEqual(['b'])
      expect(moved.text).toContain('( a | [b] )')
    },
  },
  {
    node: 'Grid',
    does: 'moves its selected row on the arrows, the index the caller holds',
    render: (record) => {
      const [selected, setSelected] = createSignal(0)
      return (
        <Grid
          ariaLabel="Runs"
          columns={['name']}
          rows={[['lint'], ['test']]}
          selected={selected()}
          onSelect={(index) => { setSelected(index); record(String(index)) }}
        />
      )
    },
    size: { width: 30, height: 6 },
    drive: async (screen, pressed) => {
      await screen.press('ARROW_DOWN')
      expect(pressed).toEqual(['1'])
    },
  },
  {
    node: 'Menu',
    does: 'opens on Enter and runs the item the keys are on',
    render: (record) => (
      <Menu ariaLabel="Menu" trigger={() => <Line>open me</Line>}>
        {(context) => (
          <Menu.Item context={context} onSelect={() => record('chosen')}>choice</Menu.Item>
        )}
      </Menu>
    ),
    drive: async (screen, pressed) => {
      expect(screen.text).not.toContain('choice')
      const open = await screen.press('RETURN')
      expect(open.text).toContain('choice')
      const chosen = await open.press('RETURN')
      expect(pressed).toEqual(['chosen'])
      expect(chosen.text).not.toContain('choice')
    },
  },
  {
    node: 'Select',
    does: 'opens a list on Enter, moves in it, and changes the value',
    render: (record) => {
      const [value, setValue] = createSignal('a')
      return (
        <Select
          value={value()}
          options={[{ value: 'a', label: 'one' }, { value: 'b', label: 'two' }]}
          onChange={(next) => { setValue(next); record(next) }}
        />
      )
    },
    size: { width: 30, height: 8 },
    drive: async (screen, pressed) => {
      expect(screen.text).toContain('[ one ▾ ]')
      const open = await screen.press('RETURN')
      expect(open.text).toContain('two')
      const moved = await open.press('ARROW_DOWN')
      const chosen = await moved.press('RETURN')
      expect(pressed).toEqual(['b'])
      // The trigger now says `two`, so the list is gone when the *other* label has left the screen.
      expect(chosen.text).not.toContain('one')
      expect(chosen.text).toContain('[ two ▾ ]')
    },
  },
  {
    node: 'Picker',
    does: 'opens a filtered list on Enter and picks a row from it',
    render: (record) => (
      <Picker
        label="Repo"
        placeholder="Find…"
        emptyText="Nothing"
        items={[{ id: 'a', label: 'one' }, { id: 'b', label: 'two' }]}
        onPick={record}
      />
    ),
    size: { width: 30, height: 10 },
    drive: async (screen, pressed) => {
      const open = await screen.press('RETURN')
      expect(open.text).toContain('one')
      expect(open.text).toContain('two')
      const moved = await open.press('ARROW_DOWN')
      const picked = await moved.press('RETURN')
      expect(pressed.length).toBe(1)
      expect(picked.text).not.toContain('two')
    },
  },
  {
    node: 'PickerRow',
    does: 'selects on Enter',
    render: (record) => <PickerRow label="acorn" onSelect={() => record('selected')} />,
    drive: async (screen, pressed) => {
      await screen.press('RETURN')
      expect(pressed).toEqual(['selected'])
    },
  },
  {
    node: 'Composer',
    does: 'submits what is in the box on commit',
    render: (record) => {
      const [value, setValue] = createSignal('')
      return <Composer value={value()} onInput={setValue} onSubmit={record} submitLabel="Send" />
    },
    size: { width: 40, height: 8 },
    drive: async (screen, pressed) => {
      const typed = await (await screen.press('h')).press('i')
      expect(typed.text).toContain('hi')
      // Ctrl+Return, which is a chord only because the app asks the terminal for the kitty keyboard
      // protocol: without it a terminal sends the same single byte for Return either way
      // (../main.tsx, ./render.tsx).
      await typed.press('RETURN', { ctrl: true })
      expect(pressed).toEqual(['hi'])
    },
  },
  {
    node: 'MentionTextarea',
    does: 'completes the word being typed from the list under the field',
    render: (record) => (
      <MentionTextarea value="ping @ad" onInput={record} mentions={['ada', 'bob']} />
    ),
    size: { width: 40, height: 8 },
    drive: async (screen, pressed) => {
      expect(screen.text).toContain('ada')
      const inList = await screen.press('ARROW_DOWN')
      await inList.press('RETURN')
      // The last value, for the mount-time content change `Textarea` above explains.
      expect(pressed.at(-1)).toBe('ping @ada ')
    },
  },
  {
    node: 'Input',
    does: 'takes what is typed at it',
    render: (record) => <Input value="" onInput={record} />,
    size: { width: 30, height: 3 },
    drive: async (screen, pressed) => {
      await screen.press('a')
      expect(pressed).toEqual(['a'])
    },
  },
  {
    node: 'Textarea',
    does: 'takes what is typed at it',
    render: (record) => <Textarea value="" onInput={record} />,
    size: { width: 30, height: 5 },
    drive: async (screen, pressed) => {
      await screen.press('a')
      // The last value, not the only one: an OpenTUI textarea raises one content change as it mounts,
      // with the text it was built with. Harmless — the value it reports is the value it was given —
      // and pre-existing, so it is not this phase's to change.
      expect(pressed.at(-1)).toBe('a')
    },
  },
  {
    node: 'FindBar',
    does: 'takes a query typed at it',
    render: (record) => <FindBar query="" onQuery={record} onNext={() => {}} onPrev={() => {}} />,
    size: { width: 30, height: 3 },
    drive: async (screen, pressed) => {
      await screen.press('a')
      expect(pressed).toEqual(['a'])
    },
  },
  {
    node: 'ModelConnectionPicker',
    does: 'opens its model list on Enter',
    render: (record) => (
      <ModelConnectionPicker
        connectionId="c1"
        modelId="m1"
        onChange={(selection) => record(selection.modelId)}
        connections={[{
          connection: { id: 'c1', label: 'Anthropic' },
          provider: { models: [{ id: 'm1', label: 'Opus' }, { id: 'm2', label: 'Sonnet' }] },
        }]}
      />
    ),
    size: { width: 40, height: 8 },
    drive: async (screen, pressed) => {
      const open = await screen.press('RETURN')
      expect(open.text).toContain('Sonnet')
      const moved = await open.press('ARROW_DOWN')
      await moved.press('RETURN')
      expect(pressed).toEqual(['m2'])
    },
  },
  {
    node: 'DocumentTabs',
    does: 'opens the next document with the arrows and closes the current one with Delete',
    render: (record) => (
      <DocumentTabs
        idPrefix="documents"
        ariaLabel="Open files"
        active="a"
        onActivate={(id) => record(`open ${id}`)}
        onClose={(id) => record(`close ${id}`)}
        tabs={[{ id: 'a', label: 'one' }, { id: 'b', label: 'two' }]}
      />
    ),
    drive: async (screen, pressed) => {
      const moved = await screen.press('ARROW_RIGHT')
      expect(pressed).toEqual(['open b'])
      // Delete closes what the caret is on, which is the tab the arrow just opened. The strip is
      // uncontrolled in this fixture, so `active` is still `a` on the screen and the collection's own
      // caret is the thing that moved — which is the state the real editor keeps in step.
      await moved.press('DELETE')
      expect(pressed).toEqual(['open b', 'close a'])
    },
  },
]

/**
 * A node the focus table calls a stop, a collection or a conditional stop, and that no case above
 * drives. Each line is the reason, and the reason has to be one of two kinds: there is no handler to
 * press, or the keys are driven in a named suite of their own.
 *
 * The point of the table below is that this list cannot grow quietly. A node cannot join the kit as a
 * stop without somebody deciding whether this host presses it.
 */
const NOT_DRIVEN_HERE: Partial<Record<KitNodeName, string>> = {
  // No handler to press.
  Section: 'takes no press on either host: `conditional` is for the DOM, where a collapsing header is a button',
  Timeline: 'reduced to a column of cards; the cards are the caller’s and each is its own stop',
  ChipRow: 'a wrapper around chips; each chip is the stop, and `Chip` is driven above',
  Log: 'a document, not a control: the viewport under it owns the scroll (./scrolling.test.tsx)',
  // Driven in a suite of its own, because what they do needs a pane or a shell around them.
  Rows: 'its intents are driven against the real region store in ../keys/keys.test.tsx',
  Tabs: 'its arrows and its Down edge are driven in ../panes.test.tsx and ../spatial.test.tsx',
  Sections: 'driven in ../sections.test.tsx',
}

describe.skipIf(!hasFfi)('every control is a stop', () => {
  it.each(BEHAVIOURS.map((entry) => [`${entry.node}: ${entry.does}`, entry] as const))('%s', async (_name, entry) => {
    _resetCollections()
    const pressed: string[] = []
    const screen = await renderCells(
      () => (
        <HeaderBodyFooter
          stateKey="controls"
          label="Controls"
          regions={{ body: () => entry.render((what) => pressed.push(what)) }}
        />
      ),
      { width: entry.size?.width ?? 40, height: entry.size?.height ?? 6 },
    )
    try {
      await entry.drive(screen, pressed)
    } finally {
      screen.done()
    }
  }, 30_000)

  it('drives every node the focus table calls a stop, or says why not', () => {
    const owed = (Object.keys(NODE_FOCUS) as KitNodeName[]).filter((node) => {
      const role = NODE_FOCUS[node]
      if (role !== 'stop' && role !== 'collection' && role !== 'conditional') return false
      // A node this host does not draw cannot be pressed on it, and `support.ts` is where that is said.
      return NODE_SUPPORT[node].tui !== 'absent'
    })
    const driven = new Set(BEHAVIOURS.map((entry) => entry.node))
    const missing = owed.filter((node) => !driven.has(node) && !NOT_DRIVEN_HERE[node])
    expect(missing).toEqual([])
    // Anti-vacuity, both ways: the table is not empty, and an excuse for a node that is no longer a
    // stop is an excuse nobody will read.
    expect(owed.length).toBeGreaterThan(20)
    expect(Object.keys(NOT_DRIVEN_HERE).filter((node) => !owed.includes(node as KitNodeName))).toEqual([])
  })
})

// ── A tab strip with panels ────────────────────────────────────────────────────────────────────
//
// Two surfaces that looked the same behaved differently, because `Sections` handed its strip a list
// of panels and a plugin drawing `Tabs` and `TabPanel` as siblings had no way to. The pairing is
// `idPrefix` now, which both halves already carry, so the relation is drawn rather than passed
// (./grouping.tsx § Which panels a strip owns, docs/tui.md § Focus regions).

/** `Tabs` and its `TabPanel`s as siblings, the way a plugin writes them. */
function TwoPanels() {
  const [tab, setTab] = createSignal('a')
  return (
    <Stack>
      <Tabs
        idPrefix="fixture"
        ariaLabel="Fixture"
        active={tab()}
        onChange={setTab}
        tabs={[{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }]}
      />
      <TabPanel idPrefix="fixture" id="a" active={tab()}>
        <Button label="Inside one" onPress={() => {}} />
      </TabPanel>
      <TabPanel idPrefix="fixture" id="b" active={tab()}>
        <Button label="Inside two" onPress={() => {}} />
      </TabPanel>
    </Stack>
  )
}

/** A strip with no panels above a list — GitHub's Open/Closed filter, in miniature. */
function FilterAndRows() {
  const [tab, setTab] = createSignal('open')
  return (
    <Stack>
      <Tabs
        idPrefix="filter"
        ariaLabel="Filter"
        active={tab()}
        onChange={setTab}
        tabs={[{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }]}
      />
      <Rows id="pulls" items={[{ key: 'first', label: 'first pull' }, { key: 'second', label: 'second pull' }]}>
        {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
      </Rows>
    </Stack>
  )
}

const inPane = (body: () => JSX.Element, height: number) => renderCells(
  () => <HeaderBodyFooter stateKey="strip" label="Strip" regions={{ body }} />,
  { width: 60, height },
)

describe.skipIf(!hasFfi)('a tab strip with panels', () => {
  it('is a parent stop: Down enters the panel it is showing, Escape comes back', async () => {
    const screen = await inPane(() => <TwoPanels />, 12)
    try {
      // Entry lands on the strip rather than in the panel, because a parent stop is what `entryStop`
      // prefers — and the proof is that the arrows are the strip's.
      const second = await screen.press('ARROW_RIGHT')
      expect(second.text).toContain('[Two]')
      expect(second.text).toContain('Inside two')

      // Down into the panel this strip is showing. The button inside it draws in the focused form.
      const inside = await second.press('ARROW_DOWN')
      lit(inside, '[Inside two]')

      // Escape climbs to the strip, and the arrows are the strip's again.
      const back = await inside.press('ESCAPE')
      const first = await back.press('ARROW_LEFT')
      expect(first.text).toContain('[One]')
      expect(first.text).toContain('Inside one')
    } finally {
      screen.done()
    }
  }, 30_000)

  it('is an ordinary stop with no panels, so a region enters on the list below it', async () => {
    const screen = await inPane(() => <FilterAndRows />, 12)
    try {
      // The caret is the collection's, and it is on the first row: a filter strip owns no panels, so
      // it is not what entering the region lands on (../keys/regions.ts § entryStop).
      const caret = screen.lines.find((line) => line.includes('\u203a')) ?? ''
      expect(caret).toContain('first pull')
    } finally {
      screen.done()
    }
  }, 30_000)
})

import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import { Chip, EmptyState, SectionHeader } from './primitives'
import { Section } from './layout/Section'
import { FindBar } from './inputs/FindBar'
import { Composer } from './inputs/Composer'
import MentionTextarea from './inputs/MentionTextarea'

// A slot that a Show tests and then inserts is two reads of a prop getter, and each read runs the
// caller's JSX, so the mark was built twice and the unused copy stayed alive. Each case counts the
// builds against what is on screen. Row, Button, and Fold have the same check in ./layout/Fold.test.tsx.

let built = 0
const Mark = () => {
  built++
  return <b>mark</b>
}

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  built = 0
})

const draw = (element: () => ReturnType<typeof Mark>) => {
  const host = document.createElement('div')
  dispose = render(element, host)
  return host
}

it('builds a chip’s leading mark once', () => {
  const host = draw(() => <Chip leading={<Mark />}>label</Chip>)
  expect(host.querySelectorAll('b')).toHaveLength(1)
  expect(built).toBe(1)
})

it('builds an empty state’s icon, text, and action once', () => {
  const host = draw(() => <EmptyState icon={<Mark />} action={<Mark />}><Mark /></EmptyState>)
  expect(host.querySelectorAll('b')).toHaveLength(3)
  expect(built).toBe(3)
})

it('builds no icon while an empty state is busy', () => {
  const host = draw(() => <EmptyState busy icon={<Mark />} />)
  expect(host.querySelectorAll('b')).toHaveLength(0)
  expect(built).toBe(0)
})

it('builds a section’s actions and children once', () => {
  const host = draw(() => (
    <>
      <Section label="Changes" actions={<Mark />}><Mark /></Section>
      <SectionHeader actions={<Mark />}>Files</SectionHeader>
    </>
  ))
  expect(host.querySelectorAll('b')).toHaveLength(3)
  expect(built).toBe(3)
})

it('builds a find bar’s status and toggles once', () => {
  const host = draw(() => (
    <FindBar query="" onQuery={() => {}} onNext={() => {}} onPrev={() => {}} status={<Mark />} toggles={<Mark />} />
  ))
  expect(host.querySelectorAll('b')).toHaveLength(2)
  expect(built).toBe(2)
})

it('builds a composer’s hint and secondary action, and a mention field’s overlay, once', () => {
  const host = draw(() => (
    <>
      <Composer value="" onSubmit={() => {}} hint={<Mark />} secondary={<Mark />} />
      <MentionTextarea value="" onInput={() => {}} overlay={<Mark />} />
    </>
  ))
  expect(host.querySelectorAll('b')).toHaveLength(3)
  expect(built).toBe(3)
})

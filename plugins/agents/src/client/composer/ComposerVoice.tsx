import { createEffect, createMemo, createResource, createSignal, Match, onCleanup, Show, Switch } from 'solid-js'
import type { SpeechStatusResponse } from '@acorn/protocol/api.ts'
import { clientEvents, formatChord, readJson } from '@acorn/plugin-api/client'
import { Button, Card, Icon, IconButton, Inline, Meter, Spinner, Stack, Text } from '@acorn/plugin-api/ui'
import { createVoiceInput } from './dictation'
import { DICTATE_CHORD, listenForDictation } from './voiceShortcut'

// Voice input for one composer: the mic button for the action bar and the pill that shows while the
// mic is live (docs/managed-agents/composer.md § Voice input). Both draw nothing until the Node names a
// speech engine, so a Node without one looks as it did before.

const elapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function createComposerVoice(props: {
  nodeId: () => string | null
  /** Whether focus is inside this composer, for the shortcut. */
  owns: (element: Element | null) => boolean
  /** Called when recording starts. Returns where the words go once they arrive. */
  begin: () => (text: string) => void
}) {
  // Keyed by an object, because a resource skips its fetch for a falsy key and a null node is this one.
  const [status, { refetch }] = createResource(
    () => ({ nodeId: props.nodeId() }),
    ({ nodeId }) => readJson<SpeechStatusResponse>('/v1/core/speech/status', { nodeId }),
  )
  const engine = () => (status.error ? null : (status()?.engine ?? null))
  const voice = createVoiceInput({ nodeId: props.nodeId, begin: props.begin })
  const recording = () => voice.phase().kind === 'recording'
  // Recording can start while the engine loads its model. The words wait on the Node until it's done.
  // Memos, so a status poll that changes nothing doesn't re-register the shortcut.
  const usable = createMemo(() => engine()?.state === 'ready' || engine()?.state === 'preparing')
  const loading = createMemo(() => engine()?.state === 'preparing')

  createEffect(() => {
    if (!usable()) return
    onCleanup(listenForDictation({ owns: props.owns, press: voice.press }))
  })

  // While someone speaks to an engine still loading, ask again until it's ready, so the pill's loader
  // turns back into the mic.
  createEffect(() => {
    if (!recording() || !loading()) return
    const timer = setInterval(() => void refetch(), 500)
    onCleanup(() => clearInterval(timer))
  })

  const [now, setNow] = createSignal(performance.now())
  createEffect(() => {
    if (!recording()) return
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 250)
    onCleanup(() => clearInterval(timer))
  })

  // Escape cancels a recording or a transcription, or dismisses a message, and never edits the draft.
  // While dictating it's caught before the message box sees it, where it would stop the agent's turn.
  createEffect(() => {
    const kind = voice.phase().kind
    if (kind === 'idle') return
    const busy = kind === 'recording' || kind === 'transcribing'
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (busy) {
        event.preventDefault()
        event.stopImmediatePropagation()
        voice.cancel()
      } else voice.dismiss()
    }
    window.addEventListener('keydown', onEscape, { capture: busy })
    onCleanup(() => window.removeEventListener('keydown', onEscape, { capture: busy }))
  })

  const openSettings = (tab: string | undefined) =>
    clientEvents.emit('presentation:open-settings', { tab: tab ?? 'plugins' })

  const button = () => (
    <Show when={engine()}>
      {(found) => (
        <Switch>
          <Match when={found().state === 'needs-setup'}>
            <Button size="sm" title={found().detail} onPress={() => openSettings(found().settings)}>
              Set up voice input
            </Button>
          </Match>
          <Match when={true}>
            <IconButton
              icon="mic"
              label={recording() ? 'Stop dictating' : 'Dictate'}
              pressed={recording()}
              disabled={!usable() || voice.phase().kind === 'transcribing'}
              tip={found().state === 'failed' ? found().detail : recording() ? 'Stop dictating' : 'Dictate'}
              tipKey={formatChord(DICTATE_CHORD)}
              onPress={voice.toggle}
            />
          </Match>
        </Switch>
      )}
    </Show>
  )

  const pill = () => (
    <Show when={voice.phase().kind !== 'idle'}>
      <Card pad="sm" fit stripe={recording() ? 'danger' : undefined}>
        <Switch>
          <Match when={voice.phase().kind === 'recording' && (voice.phase() as { startedAt: number })}>
            {(live) => (
              // The meter takes the full width of whatever holds it, so it gets a line of its own.
              <Stack gap="inline">
                <Inline>
                  <Show when={!voice.hearing() || loading()} fallback={<Icon name="mic" tone="danger" />}>
                    <Spinner label={voice.hearing() ? 'Loading the speech model' : 'Starting the microphone'} />
                  </Show>
                  <Text>
                    {!voice.hearing()
                      ? 'Starting the microphone'
                      : loading()
                        ? 'Listening, loading the speech model'
                        : 'Listening'}{' '}
                    {elapsed(now() - live().startedAt)}
                  </Text>
                  <Button size="sm" onPress={voice.toggle}>
                    Stop
                  </Button>
                  <IconButton
                    icon="x"
                    label="Cancel dictation"
                    tip="Cancel"
                    tipKey={formatChord('escape')}
                    onPress={voice.cancel}
                  />
                </Inline>
                <Meter value={Math.min(1, voice.level() * 8)} label="Microphone level" tone="ok" />
              </Stack>
            )}
          </Match>
          <Match when={voice.phase().kind === 'transcribing'}>
            <Inline>
              <Spinner label="Transcribing" />
              <Text>Transcribing</Text>
              <IconButton
                icon="x"
                label="Cancel dictation"
                tip="Cancel"
                tipKey={formatChord('escape')}
                onPress={voice.cancel}
              />
            </Inline>
          </Match>
          <Match when={voice.phase().kind === 'message' && (voice.phase() as { text: string })}>
            {(message) => (
              <Inline>
                <Text tone="danger" wrap>
                  {message().text}
                </Text>
                <IconButton icon="x" label="Dismiss" onPress={voice.dismiss} />
              </Inline>
            )}
          </Match>
        </Switch>
      </Card>
    </Show>
  )

  return { button, pill, refresh: () => void refetch() }
}

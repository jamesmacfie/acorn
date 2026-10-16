import { createSignal, onCleanup, Show } from 'solid-js'
import { oauthCallback } from '@acorn/plugin-api/client'
import { Alert, Button, Field, Inline, Input, Link, SettingRow, Stack, Text } from '@acorn/plugin-api/ui'
import { confirmAction } from '@acorn/plugin-api/ui/host'
import type { AgentMcpServer, AgentMcpSignIn, AgentMcpSignInFinish } from '../../shared/mcpServers'
import {
  cancelAgentMcpSignIn,
  finishAgentMcpSignIn,
  signOutAgentMcpServer,
  startAgentMcpSignIn,
} from './mcpServersClient'

// Where the browser goes when this host cannot listen for it. Nothing answers there, and that's fine:
// the address bar still holds the code, which the person pastes back.
const PASTE_REDIRECT_URI = 'http://127.0.0.1/acorn-oauth'

type Attempt = { attemptId: string; authorizationUrl: string; listener: { close(): void } | null }

const message = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

/** The list row's word for a sign-in. */
export const signInWord = (signIn: AgentMcpSignIn): string =>
  signIn.status === 'signed_in' ? 'Signed in' : signIn.status === 'expired' ? 'Sign-in expired' : 'Not signed in'

// The sign-in part of an HTTP server's editor (docs/mcp/sign-in.md). The node does the
// OAuth work. This opens the browser and carries the code from its return trip back to the node,
// either through the host's loopback listener or as the address the person pastes.
export function McpSignInPanel(props: {
  server: AgentMcpServer
  /** Asks for consent to the saved configuration if it has none. Null when the person declined. */
  consented: (server: AgentMcpServer) => Promise<AgentMcpServer | null>
  onServer: (server: AgentMcpServer) => void
}) {
  const [attempt, setAttempt] = createSignal<Attempt | null>(null)
  const [pasting, setPasting] = createSignal(false)
  const [address, setAddress] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const name = () => props.server.name
  const signIn = () => props.server.signIn ?? { status: 'signed_out' as const, signedInAt: null }
  // A page and the desktop can hand the sign-in page to a browser. A terminal can't, so it shows the
  // address, which also serves someone on SSH whose browser is on another machine.
  const opensBrowser = typeof window !== 'undefined' && typeof window.open === 'function'

  const clear = (current: Attempt) => {
    current.listener?.close()
    if (attempt() !== current) return
    setAttempt(null)
    setPasting(false)
    setAddress('')
  }
  const cancel = (current = attempt()) => {
    if (!current) return
    clear(current)
    void cancelAgentMcpSignIn(name(), current.attemptId).catch(() => undefined)
  }
  // Leaving the editor drops a sign-in still waiting on the browser.
  onCleanup(() => cancel())

  const finish = async (current: Attempt, input: AgentMcpSignInFinish) => {
    setBusy(true)
    setError('')
    try {
      props.onServer(await finishAgentMcpSignIn(name(), current.attemptId, input))
    } catch (cause) {
      setError(message(cause, 'The sign-in could not finish. Start again.'))
    } finally {
      // The node spends an attempt on its first finish, so a failure needs a fresh start either way.
      clear(current)
      setBusy(false)
    }
  }

  const start = async () => {
    setError('')
    let server: AgentMcpServer | null
    try {
      server = await props.consented(props.server)
    } catch (cause) {
      return setError(message(cause, 'The server changed before consent.'))
    }
    if (!server) return
    setBusy(true)
    let listener: { redirectUri: string; result: Promise<URLSearchParams>; close(): void } | null = null
    try {
      listener = (await oauthCallback()?.listen()) ?? null
      const started = await startAgentMcpSignIn(name(), listener?.redirectUri ?? PASTE_REDIRECT_URI)
      const current: Attempt = { ...started, listener }
      setAttempt(current)
      if (opensBrowser) window.open(started.authorizationUrl, '_blank', 'noopener,noreferrer')
      if (!listener) return void setPasting(true)
      const redirectUri = listener.redirectUri
      listener.result.then(
        (params) => {
          if (attempt() !== current) return
          const code = params.get('code')
          const state = params.get('state')
          // Without a code the server said no. The node reads its reason out of the address.
          void finish(current, code && state ? { code, state } : { address: `${redirectUri}?${params}` })
        },
        () => {
          if (attempt() !== current) return
          cancel(current)
          setError('Nobody came back from the sign-in page in time. Start again.')
        },
      )
    } catch (cause) {
      listener?.close()
      setError(message(cause, 'The sign-in could not start.'))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    const confirmed = await confirmAction({
      title: `Sign out of ${name()}`,
      actionLabel: 'Sign out',
      goes: `Acorn's sign-in to ${name()}. Open sessions lose its tools, and new sessions start without it.`,
      stays: 'The server and its settings.',
      danger: true,
    })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      props.onServer(await signOutAgentMcpServer(name()))
    } catch (cause) {
      setError(message(cause, 'The sign-out could not finish.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap="inline">
      <Show
        when={attempt()}
        fallback={
          <SettingRow
            label={signInWord(signIn())}
            description={
              signIn().status === 'signed_in'
                ? `Since ${new Date(signIn().signedInAt!).toLocaleDateString()}. Every session on this node uses this sign-in.`
                : signIn().status === 'expired'
                  ? 'The server refused to renew the sign-in. Sessions start without this server until you sign in again.'
                  : 'Sessions start without this server until you sign in.'
            }
          >
            <Show
              when={signIn().status === 'signed_in'}
              fallback={
                <Button busy={busy()} onPress={() => void start()}>
                  {signIn().status === 'expired' ? 'Sign in again' : 'Sign in'}
                </Button>
              }
            >
              <Button variant="ghost" busy={busy()} onPress={() => void signOut()}>
                Sign out
              </Button>
            </Show>
          </SettingRow>
        }
      >
        {(current) => (
          <>
            <Text>Waiting for the browser.</Text>
            <Link href={current().authorizationUrl}>Open the sign-in page</Link>
            <Show when={!opensBrowser}>
              <Text emphasis="muted" wrap>
                {current().authorizationUrl}
              </Text>
            </Show>
            <Show when={pasting()}>
              <Field
                label="Address"
                hint="After you approve, copy the whole address from the browser's address bar, even if the page didn't load."
              >
                <Input value={address()} placeholder={`${PASTE_REDIRECT_URI}?code=…`} onInput={setAddress} />
              </Field>
            </Show>
            <Inline gap="row">
              <Show
                when={pasting()}
                fallback={
                  <Button variant="ghost" onPress={() => setPasting(true)}>
                    Paste the address instead
                  </Button>
                }
              >
                <Button
                  tone="accent"
                  variant="solid"
                  busy={busy()}
                  onPress={() => void finish(current(), { address: address() })}
                >
                  Finish sign-in
                </Button>
              </Show>
              <Button variant="ghost" onPress={() => cancel()}>
                Cancel
              </Button>
            </Inline>
          </>
        )}
      </Show>
      <Show when={error()}>
        <Alert>{error()}</Alert>
      </Show>
    </Stack>
  )
}

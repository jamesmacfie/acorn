import { createSignal } from 'solid-js'
import { Button, Field, Input } from '@acorn/client-core/kit/components/primitives.tsx'

/** The one screen a phone without a session sees: the gateway's one-time code, spent on
 *  `POST /session` for a cookie this page can't read. A right code reloads the app, which then boots
 *  with the cookie. */
export function SignIn() {
  const [code, setCode] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const signIn = async () => {
    if (!code().trim() || busy()) return
    setBusy(true)
    setError('')
    try {
      const answer = await fetch('/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code().trim() }),
      })
      if (answer.ok) return location.reload()
      const body = (await answer.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(body.error?.message ?? `The gateway answered ${answer.status}.`)
    } catch {
      setError("Can't reach the gateway. Check it's running, then try again.")
    }
    setBusy(false)
  }
  return (
    <main class="mobile-body mobile-sign-in">
      <Field label="Sign-in code" hint="The gateway prints one when it starts." error={error() || undefined}>
        <Input value={code()} onInput={setCode} onSubmit={() => void signIn()} invalid={!!error()} autofocus />
      </Field>
      <Button variant="solid" tone="accent" busy={busy()} onPress={() => void signIn()}>
        Sign in
      </Button>
    </main>
  )
}

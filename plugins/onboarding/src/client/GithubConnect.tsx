import { createMemo, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { createDeviceFlow, integrationsOptions, type Project, projectImporterRegistry } from '@acorn/plugin-api/client'
import { Alert, Button, Card, CopyButton, Heading, Inline, Stack, Text, Toolbar } from '@acorn/plugin-api/ui'
import { safeVerificationUrl } from '@acorn/protocol/externalUrl.ts'
import { AddedTally } from './AddedTally'

// The GitHub branch of the wizard: the device grant, then whatever GitHub registered as a project
// importer. Neither half is written here. The grant is core's shared createDeviceFlow, the same one
// Settings → Services runs, and the repo list is the github plugin's own component, reached through
// projectImporterRegistry so this plugin never imports another plugin.
//
// The screen doesn't leave on its own after an import. An account has many repositories and taking
// several is normal, so the list stays put, says what has been added so far, and waits for the owner
// to press the wizard's Next, which reads "Done adding" here.
export default function GithubConnect(props: {
  onImported: (projectIds?: readonly string[]) => void
  onBack: () => void
  added: Project[]
}) {
  const integrations = createQuery(() => integrationsOptions(true))
  const connected = () =>
    !!integrations.data?.integrations.some((entry) => entry.providerId === 'github' && entry.status === 'connected')
  const flow = createDeviceFlow(() => 'github', async () => { await integrations.refetch() })
  const importer = createMemo(() => projectImporterRegistry.get('github'))
  const githubVerification = (value: string): URL | null => {
    const url = safeVerificationUrl(value)
    return url?.hostname === 'github.com' && url.pathname === '/login/device' ? url : null
  }

  return (
    <Stack gap="row">
      <Show
        when={connected()}
        fallback={
          <Stack gap="row">
            <Heading
              level={2}
              help="If you don't finish signing in, nothing breaks. You can connect GitHub later in Settings, under Services."
            >
              Connect GitHub
            </Heading>
            <Text emphasis="muted" wrap>Enter a code at GitHub to sign in. acorn never sees your password.</Text>
            <Show
              when={flow.device()}
              fallback={
                <Toolbar variant="actions" size="sm">
                  <Button onPress={() => void flow.start()} disabled={flow.busy()}>
                    {flow.busy() ? 'Starting…' : 'Get a code'}
                  </Button>
                </Toolbar>
              }
            >
              {(started) => (
                <Card>
                  <Stack gap="row">
                    <Show when={githubVerification(started().verificationUri)} fallback={<Alert>GitHub sent a sign-in link that acorn doesn't trust. Cancel and try again.</Alert>}>
                      {(url) => <Text emphasis="muted">{url().host}{url().pathname}</Text>}
                    </Show>
                    {/* The code is the thing to read, so it gets the emphasis. */}
                    <Inline gap="inline">
                      <Text emphasis="mono">{started().userCode}</Text>
                      <CopyButton text={() => started().userCode} title="Copy the code" />
                    </Inline>
                    <Toolbar variant="actions" size="sm">
                      {/* A real link, not a fetch: the shell's external-URL gate routes it to the
                          owner's browser. */}
                      <Show when={githubVerification(started().verificationUri)}>
                        {(url) => <Button href={url().href}>Open GitHub</Button>}
                      </Show>
                      <Button variant="ghost" onPress={flow.cancel}>Cancel</Button>
                    </Toolbar>
                    <Text emphasis="muted">Waiting for you to approve on GitHub…</Text>
                  </Stack>
                </Card>
              )}
            </Show>
            <Show when={flow.error()}>{(text) => <Alert>{text()}</Alert>}</Show>
          </Stack>
        }
      >
        <Stack gap="row">
          <Heading level={2}>Choose repositories</Heading>
          <Text emphasis="muted" wrap>
            Clone a repository, or link one you already have on this computer. You can import more later
            in Settings.
          </Text>
          <Show when={importer()} fallback={<Text emphasis="muted">GitHub import isn't available on this computer.</Text>}>
            {(entry) => (
              // showClose: the wizard's own chrome already has back and skip.
              <Dynamic component={entry().component} onClose={props.onBack} onImported={props.onImported} showClose={false} />
            )}
          </Show>
          {/* The running tally is the whole reason this screen can stay put: without it, adding a third
              repository is an act of faith. */}
          <AddedTally added={props.added} />
        </Stack>
      </Show>
    </Stack>
  )
}

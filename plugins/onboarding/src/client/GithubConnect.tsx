import { createMemo, For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { createDeviceFlow, integrationsOptions, type Project, projectImporterRegistry } from '@acorn/plugin-api/client'
import { Alert, Badge, Button, Card, ChipRow, Chip, CopyButton, Heading, Inline, Stack, Text, Toolbar } from '@acorn/plugin-api/ui'

// The GitHub branch of the wizard: the device grant, then whatever GitHub registered as a project
// importer. Neither half is written here. The grant is core's shared createDeviceFlow, the same one
// Settings → Integrations runs, and the repo list is the github plugin's own component, reached through
// projectImporterRegistry so this plugin never imports another plugin.
//
// The screen doesn't leave on its own after an import. An account has many repositories and taking
// several is normal, so the list stays put, says what has been added so far, and waits for the owner.
export default function GithubConnect(props: {
  onImported: (projectIds?: readonly string[]) => void
  onBack: () => void
  added: Project[]
  onContinue: () => void
}) {
  const integrations = createQuery(() => integrationsOptions(true))
  const connected = () =>
    !!integrations.data?.integrations.some((entry) => entry.providerId === 'github' && entry.status === 'connected')
  const flow = createDeviceFlow(() => 'github', async () => { await integrations.refetch() })
  const importer = createMemo(() => projectImporterRegistry.get('github'))

  return (
    <Stack gap="row">
      <Show
        when={connected()}
        fallback={
          <Stack gap="row">
            <Heading level={2}>Connect GitHub.</Heading>
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
                    <Text emphasis="muted">{new URL(started().verificationUri).host}{new URL(started().verificationUri).pathname}</Text>
                    {/* The code is the thing to read, so it gets the emphasis. */}
                    <Inline gap="inline">
                      <Text emphasis="mono">{started().userCode}</Text>
                      <CopyButton text={() => started().userCode} title="Copy the code" />
                    </Inline>
                    <Toolbar variant="actions" size="sm">
                      {/* A real link, not a fetch: the shell's external-URL gate routes it to the
                          owner's browser. */}
                      <Button href={started().verificationUri}>Open GitHub</Button>
                      <Button variant="bare" onPress={flow.cancel}>Cancel</Button>
                    </Toolbar>
                    <Text emphasis="muted">Waiting for approval…</Text>
                  </Stack>
                </Card>
              )}
            </Show>
            <Show when={flow.error()}>{(text) => <Alert>{text()}</Alert>}</Show>
            <Text emphasis="muted" wrap>
              If you close this or deny the request, nothing breaks — you land in the app and can retry
              from Settings → Integrations.
            </Text>
          </Stack>
        }
      >
        <Stack gap="row">
          <Heading level={2}>Pick your repositories.</Heading>
          <Text emphasis="muted" wrap>
            Clone them fresh, or map ones you already have on disk. Add as many as you like — anything you
            skip stays in GitHub, and you can import it from Settings whenever you want it.
          </Text>
          <Show when={importer()} fallback={<Text emphasis="muted">The GitHub importer is not available on this node.</Text>}>
            {(entry) => (
              // showClose: the wizard's own chrome already has back and skip.
              <Dynamic component={entry().component} onClose={props.onBack} onImported={props.onImported} showClose={false} />
            )}
          </Show>
          {/* The running tally is the whole reason this screen can stay put: without it, adding a third
              repository is an act of faith. */}
          <Show when={props.added.length}>
            <Inline gap="stack" wrap>
              <Badge tone="ok">{props.added.length} project{props.added.length === 1 ? '' : 's'} added</Badge>
              <ChipRow ariaLabel="Projects added">
                <For each={props.added}>{(project) => <Chip>{project.name}</Chip>}</For>
              </ChipRow>
            </Inline>
          </Show>
          <Toolbar variant="actions" size="sm">
            <Button variant="solid" tone="accent" disabled={!props.added.length} onPress={props.onContinue}>
              {props.added.length ? 'Done adding' : 'Add a repository to continue'}
            </Button>
          </Toolbar>
        </Stack>
      </Show>
    </Stack>
  )
}

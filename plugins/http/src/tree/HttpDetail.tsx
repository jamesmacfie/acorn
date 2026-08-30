// The API panel's `detail` region: the request being edited, its tabs, and what came back
// (docs/http-client.md § Client). The variables editor takes the same region when the list's
// Variables button is on, because it is what the reader asked to look at.
//
// A region rather than a column inside one tree. Everything it shares with the list beside it is in
// ./panelModel.ts, which one worker holds for both.
import { Show } from 'solid-js'
import {
  Button, Input, Select, StatusDot, Text, Toolbar, ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import { httpMethods } from '../shared/model'
import type { Draft } from './draft'
import type { HttpPanelModel } from './panelModel'
import HttpVariables from './HttpVariables'
import RequestTabs from './RequestTabs'
import ResponseView from './ResponseView'
import SaveRequestModal from './SaveRequestModal'

export default function HttpDetail(props: { model: HttpPanelModel }) {
  const model = () => props.model
  return (
    <>
      <Show
        when={model().selection().kind !== 'variables'}
        fallback={<HttpVariables projectId={model().projectId} projectName={model().projectName} />}
      >
        <Toolbar ariaLabel="Request">
          <Select
            width="narrow"
            value={model().draft().method}
            label="Method"
            onChange={(value: string) => model().patch({ method: value })}
            options={[...httpMethods.map((m) => ({ value: m, label: m }))]}
          />
          <Input
            value={model().draft().url}
            placeholder="{{BASE_URL}}/users  ·  or paste a curl command"
            assist={false}
            label="URL"
            onChange={(value: string) => model().commitUrl(value)}
            onSubmit={(value: string) => {
              // A curl command that just expanded is not a request to send: the reader pressed Enter
              // to fill the fields in, and firing on the same keystroke would send the old URL.
              if (!model().commitUrl(value)) void model().fire()
            }}
          />
          <Button variant="solid" tone="accent" busy={model().sending()} onPress={() => void model().fire()}>
            Send
          </Button>
        </Toolbar>

        <Toolbar size="sm" ariaLabel="Request meta">
          {/* The name is a label, not a field: it opens the save dialog, which is also the rename
              and the move-into-the-repo path. */}
          <Button variant="bare" size="sm" title="Rename, move or file this request" onPress={() => model().openSave()}>
            <Show when={model().draft().folder}>
              <Text emphasis="muted">{model().draft().folder}/</Text>
            </Show>
            <Text>{model().draft().name || 'Untitled request'}</Text>
            <Show when={model().draft().taskId}><Text emphasis="eyebrow">task</Text></Show>
          </Button>
          <ToolbarSpacer />
          <Show when={model().dirty()}>
            <StatusDot tone="accent" label="Unsaved changes" />
          </Show>
          <Button size="sm" variant="ghost" onPress={() => model().copyAsCurl()}>
            Copy as curl
          </Button>
          <Button size="sm" busy={model().saving()} onPress={() => model().onSaveClick()}>
            {model().current() ? 'Save' : 'Save…'}
          </Button>
        </Toolbar>

        <RequestTabs draft={model().draft()} patch={model().patch} />
        <ResponseView
          result={model().result()}
          error={model().error()}
          sending={model().sending()}
          onCopy={(text) => model().copy(text)}
        />
      </Show>

      <Show when={model().saveOpen()}>
        <SaveRequestModal
          target={model().saveTarget()}
          inTask={!!model().taskId}
          folders={model().folders()}
          busy={model().saving()}
          error={model().error()}
          onDismiss={() => model().setSaveOpen(false)}
          onSave={(target) => {
            const next: Draft = {
              ...model().draft(),
              name: target.name,
              // A task-scoped request has no folder: the task is its home.
              folder: target.scope === 'project' ? target.folder : '',
              taskId: target.scope === 'task' ? (model().taskId ?? null) : null,
            }
            model().setDraft(next)
            void model().persist(next)
          }}
        />
      </Show>
    </>
  )
}

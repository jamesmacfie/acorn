import { Show, createSignal } from 'solid-js'
import type { BridgeProject, BridgeWorkspace } from '@acorn/protocol/extensionBridge.ts'
import {
  associationMatches,
  parseSiteAddress,
  parseSiteAssociation,
  siteKind,
  siteText,
  type ProjectSite,
  type SiteAssociation,
  type SiteKind,
} from '@acorn/protocol/siteAssociations.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import Picker from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { Inline } from '@acorn/client-core/kit/components/layout'
import { Alert, Button, Field, Input, SegmentedControl } from '@acorn/client-core/kit/components/primitives.tsx'
import { Modal } from '@acorn/client-core/kit/components/overlays'

const KINDS: readonly {
  value: SiteKind
  label: string
  hint: string
  placeholder: string
}[] = [
  {
    value: 'domain',
    label: 'Domain',
    hint: 'The domain and its subdomains, on any page.',
    placeholder: 'example.com',
  },
  {
    value: 'prefix',
    label: 'Starts with',
    hint: 'This address and every page under it.',
    placeholder: 'https://example.com/docs',
  },
  {
    value: 'exact',
    label: 'Exact page',
    hint: 'Only this page. Anything after ? or # is ignored.',
    placeholder: 'https://example.com/page',
  },
  {
    value: 'regex',
    label: 'Regex',
    hint: "A regular expression, tested against the page's whole address.",
    placeholder: '^https://example\\.com/(app|admin)/',
  },
]

// The page beside the sidebar, written as each kind would take it. A pattern starts empty.
function pageSuggestion(kind: SiteKind, pageUrl: string | undefined): string {
  const page = pageUrl ? parseSiteAddress(pageUrl) : null
  if (!page?.ok || kind === 'regex') return ''
  if (kind === 'domain') return new URL(page.site.origin).hostname
  return page.site.origin + (page.site.pathPrefix === '/' ? '' : page.site.pathPrefix)
}

// The dialog behind Add site, and behind a site's Edit: which project, what kind of match, and the
// address or pattern. A new site starts on the page beside the sidebar. It says what was typed wrong
// before anything goes to the Node. docs/browser-extension/project-sites.md.
export function AddSite(props: {
  projects: readonly BridgeProject[]
  workspaces: readonly BridgeWorkspace[]
  // The project a new site starts on: the current task's.
  projectId: string | null
  // The association being edited, which the dialog starts from.
  editing?: ProjectSite
  pageUrl: string | undefined
  busy: boolean
  save(projectId: string, site: SiteAssociation): Promise<void>
  close(): void
}) {
  const start = props.editing?.projectId ?? props.projectId
  const [projectId, setProjectId] = createSignal(
    props.projects.some((project) => project.id === start) ? start! : props.projects[0]!.id,
  )
  const [kind, setKind] = createSignal<SiteKind>(props.editing ? siteKind(props.editing) : 'domain')
  const [text, setText] = createSignal(
    props.editing ? siteText(props.editing) : pageSuggestion('domain', props.pageUrl),
  )
  // Until the person types, the field follows the kind with the page's own address.
  const [typed, setTyped] = createSignal(!!props.editing)
  const [problem, setProblem] = createSignal<string | null>(null)
  const parsed = () => parseSiteAssociation(kind(), text())
  const details = () => KINDS.find((option) => option.value === kind())!
  const coversPage = () => {
    const site = parsed()
    return kind() !== 'regex' && !!props.pageUrl && site.ok && associationMatches(site.site, props.pageUrl)
  }
  const workspaceName = (project: BridgeProject) =>
    props.workspaces.find((workspace) => workspace.id === project.workspaceId)?.name

  const chooseKind = (next: SiteKind) => {
    setKind(next)
    setProblem(null)
    if (!typed()) setText(pageSuggestion(next, props.pageUrl))
  }
  const submit = async () => {
    const site = parsed()
    if (!site.ok) return setProblem(site.reason)
    setProblem(null)
    try {
      await props.save(projectId(), site.site)
      props.close()
    } catch (error) {
      setProblem((error as Error).message)
    }
  }

  return (
    <Modal title={props.editing ? 'Edit site' : 'Add a site'} size="sm" onDismiss={props.close}>
      <Modal.Body>
        <Field label="Project">
          <Picker
            label={props.projects.find((project) => project.id === projectId())?.name}
            ariaLabel="Project"
            placeholder="Filter projects"
            emptyText="No project matches."
            items={props.projects.map((project) => ({
              id: project.id,
              label: project.name,
              note: workspaceName(project),
              active: project.id === projectId(),
            }))}
            onPick={setProjectId}
          />
        </Field>
        <Field label="Match">
          <SegmentedControl options={KINDS} value={kind()} onChange={chooseKind} size="sm" ariaLabel="Match" />
        </Field>
        <Field
          label={kind() === 'regex' ? 'Pattern' : kind() === 'domain' ? 'Domain' : 'Address'}
          hint={details().hint}
        >
          <Input
            name="site"
            value={text()}
            placeholder={details().placeholder}
            onInput={(value) => {
              setTyped(true)
              setProblem(null)
              setText(value)
            }}
            onSubmit={() => void submit()}
          />
        </Field>
        <Show when={coversPage()}>
          <Inline gap="inline">
            <Icon name="circle-check" tone="ok" />
            <Text tone="ok">Covers this page</Text>
          </Inline>
        </Show>
        <Show when={problem()}>{(message) => <Alert>{message()}</Alert>}</Show>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onPress={props.close}>
          Cancel
        </Button>
        <Button variant="solid" busy={props.busy} disabled={!text().trim()} onPress={() => void submit()}>
          {props.editing ? 'Save' : 'Add site'}
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

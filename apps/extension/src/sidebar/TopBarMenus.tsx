import { For, Show, type JSX } from 'solid-js'
import type { BridgeTaskPage } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import { Menu } from '@acorn/client-core/kit/components/overlays'
import type { BrowserApi } from '../browser'
import { pageMatches } from '../taskPages'
import { followAcornLink } from './OpenInAcorn'
import { openTabs, showPage, tabFor } from './openTabs'

type MenuContext = Parameters<Parameters<typeof Menu>[0]['children']>[0]

// The ⋯ button and its menu, at the bar's right edge.
function More(props: { label: string; children(context: MenuContext): JSX.Element }) {
  return (
    <Menu
      ariaLabel={props.label}
      placement="bottom-end"
      trigger={(state) => (
        <IconButton
          icon="ellipsis"
          label={props.label}
          size="md"
          opens="menu"
          expanded={state.open()}
          onPress={() => state.toggle()}
        />
      )}
    >
      {props.children}
    </Menu>
  )
}

// Open in Acorn, where this build runs beside a desktop that opens `acorn://` links, and Copy Acorn link.
function LinkItems(props: { context: MenuContext; href: string | null; opensLinks: boolean }) {
  return (
    <Show when={props.href}>
      {(href) => (
        <>
          <Show when={props.opensLinks}>
            <Menu.Item
              context={props.context}
              leading={<Icon name="arrow-up-right" />}
              onSelect={() => followAcornLink(href())}
            >
              Open in Acorn
            </Menu.Item>
          </Show>
          <Menu.Item
            context={props.context}
            leading={<Icon name="copy" />}
            onSelect={() => void navigator.clipboard.writeText(href()).catch(() => {})}
          >
            Copy Acorn link
          </Menu.Item>
          <Menu.Separator />
        </>
      )}
    </Show>
  )
}

// How the menu shows a task page: a published app by its label, a pull request by its number, and
// any other page by its address without the scheme.
function pageEntry(page: BridgeTaskPage): { icon: string; name: string } {
  if (page.status) return { icon: 'server', name: page.status.label }
  const pull = page.source === 'github' ? /\/pull\/(\d+)/.exec(page.pathPrefix) : null
  if (pull) return { icon: 'git-pull-request', name: `Pull request #${pull[1]}` }
  return { icon: 'link', name: `${new URL(page.origin).host}${page.pathPrefix}` }
}

// The task's ⋯ menu: its Acorn link, its pages, each switching to its browser tab or opening one, and
// Settings.
export function TaskMenu(props: {
  api: BrowserApi
  href: string | null
  opensLinks: boolean
  pages: readonly BridgeTaskPage[]
  // The page beside the panel.
  pageUrl: string | undefined
  openSettings(): void
}) {
  const tabs = openTabs(props.api)
  const where = (page: BridgeTaskPage) => {
    if (page.status) return page.status.state
    if (props.pageUrl && pageMatches(page, props.pageUrl)) return 'This tab'
    return tabFor(tabs(), page) ? 'Switch to tab' : 'Open'
  }
  return (
    <More label="Task menu">
      {(context) => (
        <>
          <LinkItems context={context} href={props.href} opensLinks={props.opensLinks} />
          <Show when={props.pages.length}>
            <Menu.Label>Pages</Menu.Label>
            <For each={props.pages}>
              {(page) => (
                <Menu.Item
                  context={context}
                  leading={<Icon name={pageEntry(page).icon} />}
                  trailing={where(page)}
                  onSelect={() => void showPage(props.api, tabs(), page)}
                >
                  {pageEntry(page).name}
                </Menu.Item>
              )}
            </For>
            <Menu.Separator />
          </Show>
          <Menu.Item context={context} leading={<Icon name="settings" />} onSelect={() => props.openSettings()}>
            Settings
          </Menu.Item>
        </>
      )}
    </More>
  )
}

// The conversation's ⋯ menu: its Acorn link, and Archive chat.
export function ConversationMenu(props: { href: string | null; opensLinks: boolean; archive(): void }) {
  return (
    <More label="Conversation menu">
      {(context) => (
        <>
          <LinkItems context={context} href={props.href} opensLinks={props.opensLinks} />
          <Menu.Item context={context} leading={<Icon name="inbox" />} onSelect={() => props.archive()}>
            Archive chat
          </Menu.Item>
        </>
      )}
    </More>
  )
}

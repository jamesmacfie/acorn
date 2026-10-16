import { Show, createSignal } from 'solid-js'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import CopyButton from '@acorn/client-core/kit/components/inputs/CopyButton.tsx'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'

// Follows an `acorn://` link as a plain link does, which both browsers hand to the app that registered
// the scheme. The kit's buttons take only web links as an `href`, so the press follows it.
export const followAcornLink = (href: string) => Object.assign(document.createElement('a'), { href }).click()

// Opens the desktop app on `href`. Only a release desktop registers `acorn://`, so a development build
// copies the link instead. `label` names where the link goes, when that is more than the app, and
// `iconOnly` draws the arrow alone with the label as its name.
export function OpenInAcorn(props: { href: string | null; opensLinks: boolean; label?: string; iconOnly?: boolean }) {
  const label = () => props.label ?? 'Open in Acorn'
  return (
    <Show when={props.href}>
      {(href) => (
        <Show when={props.opensLinks} fallback={<CopyAcornLink href={href()} iconOnly={props.iconOnly} />}>
          <Show
            when={props.iconOnly}
            fallback={
              <Button size="sm" onPress={() => followAcornLink(href())}>
                <Icon name="arrow-up-right" />
                {label()}
              </Button>
            }
          >
            <IconButton icon="arrow-up-right" label={label()} onPress={() => followAcornLink(href())} />
          </Show>
        </Show>
      )}
    </Show>
  )
}

// The labelled form is a kit `Button`, because `CopyButton` draws only the mark.
function CopyAcornLink(props: { href: string; iconOnly?: boolean }) {
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    await navigator.clipboard.writeText(props.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Show
      when={props.iconOnly}
      fallback={
        <Button size="sm" tip={props.href} onPress={() => void copy().catch(() => {})}>
          <Icon name={copied() ? 'check' : 'copy'} />
          {copied() ? 'Copied' : 'Copy Acorn link'}
        </Button>
      }
    >
      <CopyButton text={props.href} title="Copy Acorn link" tipSub={props.href} size="sm" />
    </Show>
  )
}

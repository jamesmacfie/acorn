/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show } from 'solid-js'
import { basename, extname, isAbsolute } from 'node:path'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { Alert } from '../kit/showing'
import { Button, Input } from '../kit/asking'
import { Line } from '../kit/cells'
import { Modal, ModalBody } from '../kit/grouping'
import { finishFilePrompt, type FilePrompt } from './filePrompt'

const mime: Record<string, string> = {
  csv: 'text/csv', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
  json: 'application/json', md: 'text/markdown', pdf: 'application/pdf',
  png: 'image/png', txt: 'text/plain', webp: 'image/webp',
}
// The Agent attachment route rejects files above this size. The terminal checks the local file
// before loading its bytes so a mistaken path cannot allocate a much larger buffer in the TUI.
const MAX_PICK_BYTES = 10 * 1024 * 1024

/** Local terminal paths are a host choice. The shared attachment and export calls still exchange
 * bytes with this host, so remote Nodes do not need access to the terminal machine's filesystem. */
export function FileDialog(props: { prompt: FilePrompt }) {
  const [path, setPath] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [overwrite, setOverwrite] = createSignal(false)
  const close = () => finishFilePrompt()
  const submit = async () => {
    if (busy()) return
    setBusy(true)
    setError('')
    try {
      const target = path().trim()
      if (!isAbsolute(target)) throw new Error('Enter an absolute path on this computer.')
      if (props.prompt.kind === 'pick') {
        const info = await stat(target)
        if (!info.isFile()) throw new Error('Choose a file, not a folder.')
        if (info.size > MAX_PICK_BYTES) throw new Error('Attachments are limited to 10 MiB each.')
        const extension = extname(target).slice(1).toLowerCase()
        if (props.prompt.accept.length && !props.prompt.accept.some((allowed) => allowed.toLowerCase() === extension)) {
          throw new Error(`Choose one of: ${props.prompt.accept.map((value) => `.${value}`).join(', ')}`)
        }
        const bytes = await readFile(target)
        finishFilePrompt([{ name: basename(target), type: mime[extension] ?? 'application/octet-stream', bytes }])
      } else {
        if (!overwrite()) {
          try {
            await writeFile(target, props.prompt.request.bytes, { flag: 'wx' })
          } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === 'EEXIST') { setOverwrite(true); return }
            throw cause
          }
        } else {
          await writeFile(target, props.prompt.request.bytes)
        }
        finishFilePrompt(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onDismiss={close} title={props.prompt.kind === 'pick' ? 'Attach local file' : 'Save to local file'} size="wide">
      <ModalBody>
        <box flexDirection="column" gap={1}>
          <Line role="muted">Path on this computer:</Line>
          <Show when={props.prompt.kind === 'save'}><Line role="muted">Suggested name: {props.prompt.kind === 'save' ? props.prompt.request.suggestedName : ''}</Line></Show>
          <Input value={path()} placeholder="/absolute/path/to/file" onInput={(value) => { setPath(value); setOverwrite(false) }} onSubmit={() => void submit()} />
          <Show when={props.prompt.kind === 'pick' && props.prompt.accept.length}>
            <Line role="muted">Accepted: {props.prompt.kind === 'pick' ? props.prompt.accept.map((value) => `.${value}`).join(', ') : ''}</Line>
          </Show>
          <Show when={error()}><Alert tone="danger">{error()}</Alert></Show>
          <Show when={overwrite()}><Alert tone="warn">This file exists. Save again to replace it.</Alert></Show>
          <Button disabled={busy() || !path().trim()} onPress={() => void submit()}>{overwrite() ? 'Replace file' : props.prompt.kind === 'pick' ? 'Attach file' : 'Save file'}</Button>
          <Button variant="bare" onPress={close}>Cancel</Button>
        </box>
      </ModalBody>
    </Modal>
  )
}

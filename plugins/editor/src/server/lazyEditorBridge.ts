import type { PluginHookRegistry } from '@acorn/plugin-api/node'
import type { EditorCoreServices, EditorChanged } from './editor'
import type { EditorBridge } from './routes/editor'
import type { EditorLineMarkerProvider } from '../contract/lineMarkers'

/** Route registration is a boot concern; filesystem and marker work loads on its first request. */
export function lazyEditorBridge(
  core: EditorCoreServices,
  changed: EditorChanged,
  hooks: Pick<PluginHookRegistry, 'run'>,
  markerProviders: () => readonly EditorLineMarkerProvider[],
): EditorBridge {
  let loaded: Promise<EditorBridge> | undefined
  const bridge = () => loaded ??= import('./editor').then(({ editorBridge }) => editorBridge(core, changed, hooks, markerProviders))
  return {
    root: (...args) => bridge().then((owner) => owner.root(...args)),
    list: (...args) => bridge().then((owner) => owner.list(...args)),
    files: (...args) => bridge().then((owner) => owner.files(...args)),
    read: (...args) => bridge().then((owner) => owner.read(...args)),
    readImage: (...args) => bridge().then((owner) => owner.readImage(...args)),
    lineMarkers: (...args) => bridge().then((owner) => owner.lineMarkers(...args)),
    markerSnapshot: (...args) => bridge().then((owner) => owner.markerSnapshot!(...args)),
    write: (...args) => bridge().then((owner) => owner.write(...args)),
    entry: (...args) => bridge().then((owner) => owner.entry(...args)),
    trashAvailability: (...args) => bridge().then((owner) => owner.trashAvailability(...args)),
    renameAvailability: (...args) => bridge().then((owner) => owner.renameAvailability(...args)),
    create: (...args) => bridge().then((owner) => owner.create(...args)),
    rename: (...args) => bridge().then((owner) => owner.rename(...args)),
    trash: (...args) => bridge().then((owner) => owner.trash(...args)),
  }
}

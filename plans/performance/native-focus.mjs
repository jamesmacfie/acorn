// Uses the installed Tauri SDK's IPC verbs in a separately permissioned automation bundle.
import { writeFile } from 'node:fs/promises'
import { resolveManifest } from '../../apps/desktop/scripts/agent/state.mjs'
import { PerformanceDriver } from './native-driver.mjs'

const name = process.argv[2]
if (!name?.startsWith('perf-focus-')) throw new Error('Use an isolated perf-focus- session.')
const manifest = await resolveManifest(name)
if (!manifest.executable?.includes('/Acorn Performance Automation.app/Contents/MacOS/')) {
  throw new Error('The session does not use the separate focus automation bundle.')
}
const driver = new PerformanceDriver(manifest.webdriverEndpoint, manifest.webdriverSessionId)
const before = await driver.execute('return { visibility: document.visibilityState, focused: document.hasFocus() }')
await driver.execute(`
  globalThis.__ACORN_PERF_FOCUS_RESULT__ = null;
  (async () => {
    const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('The installed Tauri invoke seam is absent.');
    const identifier = await invoke('plugin:app|identifier');
    if (identifier !== 'com.acorn.performance.automation') throw new Error('Unexpected automation bundle identifier.');
    await invoke('plugin:app|app_show');
    await invoke('plugin:window|show', { label: 'main' });
    await invoke('plugin:window|unminimize', { label: 'main' });
    await invoke('plugin:window|set_focus', { label: 'main' });
    return {
      identifier,
      nativeVisible: await invoke('plugin:window|is_visible', { label: 'main' }),
      nativeFocused: await invoke('plugin:window|is_focused', { label: 'main' })
    };
  })().then(value => { globalThis.__ACORN_PERF_FOCUS_RESULT__ = { ok: true, ...value }; },
    error => { globalThis.__ACORN_PERF_FOCUS_RESULT__ = { ok: false, message: String(error) }; });
  return true;
`)
let result = null
for (let attempt = 0; attempt < 50; attempt++) {
  result = await driver.execute('return globalThis.__ACORN_PERF_FOCUS_RESULT__')
  if (result) break
  await new Promise(resolve => setTimeout(resolve, 200))
}
const after = await driver.execute('return { visibility: document.visibilityState, focused: document.hasFocus(), domNodes: document.querySelectorAll("*").length, xterms: document.querySelectorAll(".xterm").length }')
const record = { session: name, before, commands: result ?? { ok: false, message: 'Focus commands did not settle within the bounded polling window.' }, after }
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(record))

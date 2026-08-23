// Preview's page-rule helpers (docs/panes.md). What used to sit above them here — the accessibility
// tree, its refs, and the CDP payload shapes — moved to `plugins/browser` when browser automation left
// the shell (docs/future/tauri/webviews-and-frames.md § Agent browser automation).

// Preview navigation allows only HTTP(S) URLs with no userinfo in the authority, so a configured URL
// like `http://localhost@evil.com` can't disguise a foreign host as localhost.
export const isAllowedPreviewUrl = (url: string): boolean => /^https?:\/\/[^@/?#]+(?::\d+)?(\/|$|\?|#)/.test(url)

// Page-rule fill script (docs/panes.md), run via wc.executeJavaScript on dom-ready. Both strings are
// JSON.stringify-embedded so selector and value content can't escape into the script. Sets the value
// through the native prototype setter so controlled inputs observe it, then dispatches the events their
// bindings listen for. Retries briefly for SPA-rendered inputs, and returns a boolean because
// executeJavaScript rejects on non-serializable completion values.
export function buildFillScript(selector: string, value: string): string {
  return `(() => {
  const sel = ${JSON.stringify(selector)}, val = ${JSON.stringify(value)};
  let tries = 0;
  const attempt = () => {
    const el = document.querySelector(sel);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (++tries < 10) setTimeout(attempt, 300);
    return false;
  };
  return attempt();
})()`
}

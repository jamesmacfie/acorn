# Static mockups

Hand-off snapshots of every aacorn view for design work. Open the `.html` files
directly in a browser — no build, no server.

| File | View |
| --- | --- |
| `index.html` | Main three-pane app: PR list, PR detail (description, labels, files, checks, conversation, all action buttons), unified diff with syntax highlighting, word-level diff, inline review threads (open + resolved), and an open line-comment composer. |
| `states.html` | Everything else: split (side-by-side) diff, the repo-picker popover, the `?` keyboard-shortcuts overlay, the `/` file-finder overlay, the logged-out top bar, and empty/loading states. |
| `styles.css` | Copied verbatim from the live app (`apps/web/src/client/styles.css`). **Edit this** — both pages share it, so restyle once and both update. Dark mode follows your OS setting (or add `data-theme="dark"` to `<html>`). |

Each page carries a small, clearly-commented "static-mockup shim" that only neutralises
JS-driven row positioning (the live app virtualizes long lists) and pins the floating
overlays into the page so they're all visible at once. It's not app CSS — ignore it / delete
it when porting changes back.

# 11-11. Docker's detail: a level-3 title, long row meta, and a prune button in the wrong place

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Docker's container detail title is a level 3 heading, where a detail title is level 2. Container rows
spend 156 to 171 pixels on the full status sentence as meta. The stale badge touches the "8/10 running"
text after it. The object bar for images, volumes, and networks puts **Prune dangling**, the only
destructive button in the column, right after the count instead of at the end. The empty detail is
corner text.

## Where to see it

Docker in the left rail. **Docker is the user's real Docker.** Read only: never press Start, Stop,
Restart, Remove, Clean up, or Prune, and never open a container's **Terminal** tab.

## Already done

- K1a's row meta cap made container names visible again (they went from 0 or 8 pixels wide to 59).
- K2 fixed the list column's left edges, and B02's 02-9 made the header "Docker" with the running count.
- K1a gave every Docker confirmation a "{Verb} {thing}?" label.

## The fix

The partial fix. The rail-source detail's inset needs a padded detail column that does not scroll, a
kit mode the closed kit lacks; `scrollDetail` would undo 11-1's log scroller. Deferred (see
[deferred.md](../deferred.md)).

- `plugins/docker/src/client/ContainerDetail.tsx:169`: `Heading level={2}`.
- `plugins/docker/src/client/DockerBrowse.tsx:179-240`: short row meta ("Up 14h"), with the full status
  in the row's tip.
- `DockerBrowse.tsx:232-238`: the gap an `Inline` gives between the stale badge and the count.
- `DockerBrowse.tsx:273-285`: a `ToolbarSpacer` before **Prune**.
- `DockerBrowse.tsx:466-475`: a centred empty state with a title.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DockerBrowse.tsx:300` | Docker is unavailable | Rewrite | Docker isn't available |
| `DockerBrowse.tsx:304` | The docker CLI was not found on PATH. | Rewrite | acorn can't find the docker command. Install Docker or OrbStack, then try again. |
| `DockerBrowse.tsx:305` | The docker daemon is not reachable — is Docker/OrbStack running? | Rewrite | Docker isn't running. Start Docker or OrbStack, then try again. |
| `DockerBrowse.tsx:235` | stale (badge) | Rewrite | Left over, with tip "Its worktree was deleted" |
| `DockerBrowse.tsx:335` | {n} stale project(s) — worktree gone. | Rewrite | {n} project(s) left over from deleted worktrees |
| `DockerBrowse.tsx:332` | Clean up | Rewrite | Remove them. Armed: "Remove stale projects?" (done by K1a). |
| `DockerBrowse.tsx:338` | No containers. | Keep | |
| `DockerBrowse.tsx:351, 388, 425` | Prune dangling / Prune unused | Rewrite | Remove unused, with tip "Runs docker image prune" (volume prune, network prune). Armed labels are done. |
| `DockerBrowse.tsx:107-109` | pruning… / reclaimed {x} | Rewrite | Removing… / Freed {x} |
| `DockerBrowse.tsx:470` | Select a container. / Docker {section}. | Rewrite | Containers: centred title "Choose a container". Other tabs: no detail text. |
| `DockerBrowse.tsx:255` | Compose down (remove the project's containers and networks; volumes kept) (`title`) | Rewrite | tip "Remove this project", `tipSub` "Its containers and networks go. Volumes stay." |
| `ContainerDetail.tsx:179-182` | Terminal / Copy exec (titles "Open a shell in this container in the task terminal" / "Copy a docker exec command") | Rewrite | Open shell / Copy shell command, as tips |
| `ContainerDetail.tsx:144` | Copied exec command | Rewrite | Copied the shell command |
| `ContainerDetail.tsx:156` | could not open a terminal session | Rewrite | Couldn't open a terminal. |
| `ContainerDetail.tsx:164` | Container not found. / Loading… | Keep | |
| `ContainerDetail.tsx:290` | live / stream ended | Rewrite | Live / Log stream ended (the plan's overrule, not "Stopped") |
| `ContainerDetail.tsx:304-305` | Clear the current log view / The stream keeps appending | Rewrite | Clear the log / New lines keep coming in. |
| `ContainerDetail.tsx:323` | Stats stream ended (container stopped?). / Sampling… / Container is not running. | Rewrite | Stats stopped. The container may have stopped. / Reading stats… / The container isn't running. |
| `DockerTaskPane.tsx:94` | No containers linked to this task. | Keep | |

## Risk and checks

- Before you start, read the Docker safety note again. Measure with scripts through `execute`, and strip
  surrogate pairs from any string you return (`.replace(/[\uD800-\uDFFF]/g, '')`): a sliced emoji in a
  Docker row crashed the shell twice.
- Screens: containers, a container's Info, Logs, and Stats, and images.
- Tests: `plugins/docker`.

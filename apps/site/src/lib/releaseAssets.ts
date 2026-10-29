// Sorts a release's files into the downloads the download page offers, by name. The patterns match
// what the builds write today: Tauri's `acorn_<version>_<arch>.dmg` and `acorn_<version>_x64-setup.exe`
// (.github/workflows/build-desktop.yml), and `acorn-node-<version>.tar.gz` (scripts/pack-node.mjs).
// The updater's `.app.tar.gz` and `.sig` files match nothing, so the page never offers them. When the
// bundle plan settles the published names (docs/future/bundle.md), change this table and the fixtures
// in releaseFixtures.ts together.
import type { Release, ReleaseAsset } from './github.ts'

const PATTERNS = {
  macosArm64: /_(aarch64|arm64)\.dmg$/,
  macosX64: /_(x64|x86_64)\.dmg$/,
  windows: /_x64-setup\.exe$/,
  node: /^acorn-node-.+\.(tar\.gz|tgz)$/,
  checksums: /(SHA256SUMS|checksums\.txt|\.sha256)$/i,
}

type Kind = keyof typeof PATTERNS
type Downloads = Partial<Record<Kind, ReleaseAsset>>

/** The first file that matches each kind of download. A kind the release doesn't have is left out. */
export function sortAssets(assets: ReleaseAsset[]): Downloads {
  return Object.fromEntries(
    Object.entries(PATTERNS).flatMap(([kind, pattern]) => {
      const asset = assets.find(({ name }) => pattern.test(name))
      return asset ? [[kind, asset]] : []
    }),
  )
}

/** Where the page links a download, such as /download/macos-arm64. src/worker.ts counts the visit and
 *  redirects to the file on GitHub. */
export const downloadPath = (kind: Kind) =>
  `/download/${kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

/** What /download/links.json holds: the release's tag, and the GitHub file behind each download path. */
export function downloadLinks(release: Release | null) {
  const files = Object.entries(sortAssets(release?.assets ?? [])).map(([kind, asset]) => [
    downloadPath(kind as Kind),
    asset.url,
  ])
  return { tag: release?.tag ?? null, files: Object.fromEntries(files) as Record<string, string> }
}

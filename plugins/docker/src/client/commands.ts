import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  localSearch,
  setSelectedSource,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { fetchImages, fetchNetworks, fetchVolumes } from './dockerClient'
import { containers, refreshDocker } from './dockerStore'
import { revealDockerResource } from './dockerViewStore'
import type { DockerScope } from '../shared/model'

// Docker in the palette: open the browse surface, and find one of the four things on the daemon
// (docs/future/command-palette/command-catalog.md § Docker).
//
// **One search over all four scopes, not four searches.** A reader looking for `postgres` does not
// know or care whether they are about to find a container, an image or a volume, and a badge says
// which one a row is. The four lists are loaded once when the frame opens and filtered here, which is
// what the browse surface itself does per section (client-core/host/registries/commands/localSearch.ts).
//
// **Where a row goes.** The rail source, not the pane. The Docker pane draws the containers of one
// task and only appears on a task that has some (./paneContribution.ts); an image, a volume and a
// network belong to the daemon and have nowhere in a task to be shown. So selection selects the rail
// source and leaves a reveal for the browse surface to land on (./dockerViewStore.ts).
//
// Starting, stopping, removing, pruning and compose-down are all absent. Each is either a result
// action this programme deliberately stops before, or a confirmed operation that belongs where the
// consequences are visible (docs/future/command-palette/refused.md).

const badge: Record<DockerScope, string> = {
  containers: 'container',
  images: 'image',
  volumes: 'volume',
  networks: 'network',
}

/** `<scope>:<id>` because the four namespaces are separate and a volume is keyed by its name while
 *  everything else is keyed by an id: a bare id could collide across them, and the row has to say
 *  which list it came from anyway. */
const resourceItem = (scope: DockerScope, id: string, title: string, subtitle?: string): CommandSearchItem => ({
  id: `${scope}:${id}`,
  title,
  ...(subtitle ? { subtitle } : {}),
  badge: badge[scope],
  ref: id,
})

export const dockerCommands: readonly ContributedCommand[] = [
  {
    id: 'source.docker.open',
    title: 'Open Docker',
    hint: 'containers, images, volumes and networks on this node',
    keywords: ['docker', 'containers'],
    category: 'navigation',
    palette: true,
    // The rail is this device's view of the node, not a property of any one task or project.
    scope: 'none',
    requires: { plugin: 'docker' },
    run: () => setSelectedSource('docker'),
  },
  {
    id: 'docker.find',
    kind: 'search',
    title: 'Find a Docker resource',
    hint: 'a container, image, volume or network',
    keywords: ['docker', 'container', 'image', 'volume', 'network'],
    category: 'navigation',
    palette: true,
    scope: 'none',
    requires: { plugin: 'docker' },
    placeholder: 'Find a container, image, volume or network…',
    ...localSearch(async () => {
      // The containers come from the store this plugin already keeps in step with the daemon over the
      // socket; the other three are read here, because nothing keeps them resident.
      await refreshDocker()
      const [images, volumes, networks] = await Promise.all([fetchImages(), fetchVolumes(), fetchNetworks()])
      return [
        ...containers().map((container) => resourceItem(
          'containers',
          container.id,
          container.name,
          [container.image, container.composeProject].filter(Boolean).join(' · ') || undefined,
        )),
        ...images.map((image) => resourceItem('images', image.id, `${image.repository}:${image.tag}`, image.size)),
        // A volume has no id of its own; its name is the key the daemon addresses it by.
        ...volumes.map((volume) => resourceItem('volumes', volume.name, volume.name, volume.driver)),
        ...networks.map((network) => resourceItem('networks', network.id, network.name, network.driver)),
      ]
    }),
    select: (item): CommandOutcome => {
      const scope = item.id.slice(0, item.id.indexOf(':')) as DockerScope
      if (!item.ref || !(scope in badge)) return COMMAND_CLOSED
      // The source first, then what to land on: the shell draws from the selected source, and the
      // browse surface consumes the reveal whether it was already mounted or opens because of this.
      revealDockerResource(scope, item.ref)
      setSelectedSource('docker')
      return COMMAND_CLOSED
    },
  },
]

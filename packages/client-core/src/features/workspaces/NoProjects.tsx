import { Heading, Text } from '../../kit/components/content/public'
import AddProjectControls from './AddProjectControls'
import './no-projects.css'

export default function NoProjects(props: { onProjectAdded: (id: string) => void }) {
  return <main class="no-projects">
    <div class="no-projects-content">
      <Heading level={1}>Add a project</Heading>
      <Text emphasis="muted">A project is a folder on this Node's machine.</Text>
      <AddProjectControls onProjectAdded={props.onProjectAdded} />
    </div>
  </main>
}

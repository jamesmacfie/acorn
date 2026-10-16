import { Inline, Text, UserAvatar } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'UserAvatar',
  caption: 'A GitHub avatar beside its login. Here the avatar draws as its frame, without the photo.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function UserAvatarSpecimen() {
  return (
    <Inline gap="inline">
      <UserAvatar login="octocat" />
      <Text>octocat</Text>
    </Inline>
  )
}

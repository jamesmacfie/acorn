import { Show } from 'solid-js'
import { githubAvatarUrl } from './displayMeta'

type UserAvatarProps = {
  login: string | null | undefined
  size?: 'sm' | 'md'
}

export function UserAvatar(props: UserAvatarProps) {
  const login = () => props.login?.trim()
  const size = () => props.size ?? 'sm'
  const px = () => (size() === 'md' ? 24 : 18)

  return (
    <Show
      when={login()}
      fallback={<span class={`user-avatar user-avatar-${size()} user-avatar-empty`} aria-hidden="true" />}
    >
      {(name) => (
        <img
          class={`user-avatar user-avatar-${size()}`}
          src={githubAvatarUrl(name(), px() * 2)}
          alt=""
          width={px()}
          height={px()}
          loading="lazy"
          decoding="async"
        />
      )}
    </Show>
  )
}

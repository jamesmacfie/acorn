// Settings → Permissions: re-request GitHub access (e.g. after adding organizations or private
// repos). The action itself lives in App (it reloads acorn through the OAuth permissions flow).
export default function PermissionsSettings(props: { onPermissions: () => void | Promise<void> }) {
  return (
    <>
      <p class="muted">Re-request GitHub access (e.g. after adding organizations or private repos). This reloads acorn.</p>
      <div class="settings-actions">
        <button type="button" class="overlay-btn" onClick={() => void props.onPermissions()}>
          Re-request GitHub permissions
        </button>
      </div>
    </>
  )
}

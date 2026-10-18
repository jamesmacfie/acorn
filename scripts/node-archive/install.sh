#!/bin/sh
# Installs this extracted acorn Node archive for the current user, upgrades an earlier install, or
# removes it. The layout and each step are in docs/node-distribution/install.md.
#
#   ./install.sh [--service | --no-service] [--force]
#   ./install.sh --uninstall [--purge]
set -eu

service=ask force='' uninstall='' purge=''
for arg in "$@"; do
  case $arg in
    --service) service=yes ;;
    --no-service) service=no ;;
    --force) force=1 ;;
    --uninstall) uninstall=1 ;;
    --purge) purge=1 ;;
    *) echo "install.sh: unknown option $arg. It takes --service, --no-service, --force, --uninstall, and --purge." >&2; exit 2 ;;
  esac
done

# A Node runs agents with its user's rights, and a per-user install needs none of root's.
if [ "$(id -u)" = 0 ]; then
  echo "install.sh: run this as the person who will use the Node, not as root." >&2
  exit 1
fi

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
version=$(sed -n 's/^version=//p' "$here/BUILD" 2>/dev/null || true)
if [ -z "$version" ]; then
  echo "install.sh: run this from an extracted acorn Node archive. $here has no BUILD file." >&2
  exit 1
fi
# installRoot in apps/cli/src/supervision/service.ts and appDataDir in packages/custody/src/local/paths.ts
# name the same folders.
if [ "$(uname -s)" = Darwin ]; then
  root="$HOME/Library/Application Support/acorn-node"
  config="$HOME/Library/Application Support"
else
  root="${XDG_DATA_HOME:-$HOME/.local/share}/acorn-node"
  config="${XDG_CONFIG_HOME:-$HOME/.config}"
fi
bindir="$HOME/.local/bin"
shim="$bindir/acorn"
data="${ACORN_DATA_DIR:-$root/node}"
installed="$root/current/bin/acorn"

acorn() { ACORN_DATA_DIR="$data" "$installed" "$@"; }
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

if [ -n "$uninstall" ]; then
  if [ -x "$installed" ]; then
    acorn node service uninstall >/dev/null || true
    acorn node stop >/dev/null || true
  fi
  rm -rf "$root/versions" "$root/current" "$root/logs" "$shim"
  echo "Removed acorn from $root."
  if [ -n "$purge" ] && [ -d "$data" ]; then
    printf 'To delete the Node'"'"'s data, type its path, %s: ' "$data"
    read -r answer || answer=''
    if [ "$answer" = "$data" ]; then
      rm -rf "$data"
      echo "Deleted $data."
    else
      echo "That didn't match, so the data stays."
    fi
  fi
  if [ -d "$data" ]; then echo "Kept the Node's data in $data."; fi
  echo "Kept the acorn command's device tokens in $config/acorn."
  rmdir "$root" 2>/dev/null || true
  exit 0
fi

desktop="$config/com.acorn.desktop/node"
if [ -f "$desktop/node.json" ] && [ -z "$force" ]; then
  echo "install.sh: the acorn desktop app already runs a Node on this machine, with its data in $desktop. One machine runs one Node, so pair with the desktop's Node instead. Run install.sh --force to install a second one anyway." >&2
  exit 1
fi

# Copy first, so a failure before the switch leaves the earlier version current and its Node running.
target="$root/versions/$version"
previous=$(readlink "$root/current" 2>/dev/null || true)
previous=${previous##*/}
mkdir -p "$root/versions"
if [ "$here" != "$target" ]; then
  rm -rf "$target.partial"
  cp -R "$here" "$target.partial"
  if [ "$(uname -s)" = Darwin ]; then xattr -dr com.apple.quarantine "$target.partial" 2>/dev/null || true; fi
fi

stopped=''
if [ -x "$installed" ] && acorn node status --output json 2>/dev/null | grep -q '"state":"running'; then
  acorn node stop >/dev/null
  stopped=1
fi

if [ "$here" != "$target" ]; then
  rm -rf "$target"
  mv "$target.partial" "$target"
fi
ln -sfn "versions/$version" "$root/current"
mkdir -p "$bindir"
{
  echo '#!/bin/sh'
  echo "# Written by the acorn Node installer. Runs the installed acorn with the Node's data folder."
  echo "[ -n \"\${ACORN_DATA_DIR:-}\" ] || ACORN_DATA_DIR=$(quote "$root/node")"
  echo 'export ACORN_DATA_DIR'
  echo "exec $(quote "$installed") \"\$@\""
} >"$shim.new"
chmod 755 "$shim.new"
mv -f "$shim.new" "$shim"
mkdir -p "$data"
chmod 700 "$data"

registered=''
if acorn node service status --output json 2>/dev/null | grep -q '"loaded":true'; then registered=1; fi
if [ -n "$stopped" ]; then
  # Installing the service again starts the Node through it.
  if [ -n "$registered" ]; then acorn node service install >/dev/null; else acorn node start --background >/dev/null; fi
fi
if [ -z "$registered" ]; then
  if [ "$service" = ask ] && [ -t 0 ]; then
    printf 'Start the Node when you log in, and restart it after a crash? [Y/n] '
    read -r answer || answer=n
    case $answer in [Nn]*) service=no ;; *) service=yes ;; esac
  fi
  if [ "$service" = yes ]; then
    acorn node service install
    registered=1
  fi
fi

for dir in "$root/versions"/*; do
  name=${dir##*/}
  if [ -e "$dir" ] && [ "$name" != "$version" ] && [ "$name" != "$previous" ]; then rm -rf "$dir"; fi
done

echo
echo "Installed acorn $version in $root, with the Node's data in $data."
echo "Next:"
if [ -z "$registered" ] && [ -z "$stopped" ]; then
  echo "  acorn node start --background   start the Node now, or run install.sh --service to start it at login"
fi
echo "  acorn node reach HOST           let other machines reach the Node at this computer's name or address"
echo "  acorn node pair                 print a pairing code for a client on another machine"
echo "  acorn agent providers           check that the Node finds claude or codex"
case ":$PATH:" in
  *":$bindir:"*) ;;
  *) printf '\n%s is not on your PATH. Add this line to your shell'"'"'s startup file, then open a new terminal:\n  export PATH="$HOME/.local/bin:$PATH"\n' "$bindir" ;;
esac

#!/bin/zsh
set -eu

cd "${0:A:h}"

temporary_directory=""
finish() {
  status=$?
  if [[ -n "$temporary_directory" && -d "$temporary_directory" ]]; then
    rm -rf "$temporary_directory"
  fi
  if (( status != 0 )); then
    echo
    echo "Neemo could not finish setup. Check your internet connection and try again."
    read -r "?Press Return to close this window."
  fi
}
trap finish EXIT

echo
echo "========================================"
echo "          Starting Neemo"
echo "========================================"
echo

node_is_ready=false
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if (( node_major >= 22 )); then
    node_is_ready=true
  fi
fi

if [[ "$node_is_ready" != "true" ]]; then
  node_version="v22.22.2"
  case "$(uname -m)" in
    arm64) node_architecture="arm64" ;;
    x86_64) node_architecture="x64" ;;
    *)
      echo "This Mac type is not supported yet."
      exit 1
      ;;
  esac
  node_archive="node-${node_version}-darwin-${node_architecture}.tar.gz"
  node_directory="$PWD/.runtime/node-${node_version}-darwin-${node_architecture}"

  if [[ ! -x "$node_directory/bin/node" ]]; then
    echo "Preparing Neemo's private runtime. This only happens once…"
    temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/neemo-node.XXXXXX")"
    curl --fail --location --progress-bar \
      "https://nodejs.org/dist/${node_version}/${node_archive}" \
      --output "$temporary_directory/$node_archive"
    curl --fail --location --silent --show-error \
      "https://nodejs.org/dist/${node_version}/SHASUMS256.txt" \
      --output "$temporary_directory/SHASUMS256.txt"
    (
      cd "$temporary_directory"
      grep "  ${node_archive}\$" SHASUMS256.txt | shasum -a 256 -c -
    )
    mkdir -p "$PWD/.runtime"
    tar -xzf "$temporary_directory/$node_archive" -C "$PWD/.runtime"
  fi

  export PATH="$node_directory/bin:$PATH"
fi

if [[ ! -d node_modules ]] || ! corepack pnpm list --prod --depth 0 >/dev/null 2>&1; then
  echo "Finishing Neemo's first-time setup…"
  corepack pnpm install --prod
fi

echo
echo "Paste the setup code from the Neemo Hubs page when asked."
corepack pnpm connect

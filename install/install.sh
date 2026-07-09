#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
WORKSPACE="$(pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_ROOT="$REPO_ROOT/templates/.agent-context"
TARGET_ROOT="$WORKSPACE/.agent-context"

echo "Agent Context Patch installer"
echo "Mode: $MODE"
echo "Workspace: $WORKSPACE"
echo
echo "Planned workspace files:"
find "$TEMPLATE_ROOT" -type f | sed "s#^$TEMPLATE_ROOT/#  .agent-context/#"
echo

for file in AGENTS.md CLAUDE.md; do
  if [[ -f "$WORKSPACE/$file" ]]; then
    echo "Existing $file detected. Installer will not modify it directly."
    echo "Ask your agent to create a patch using adapters/codex or adapters/claude."
  fi
done

if [[ "$MODE" == "dry-run" ]]; then
  echo
  echo "Dry run complete. No files were written."
  exit 0
fi

if [[ "$MODE" != "workspace" ]]; then
  echo "Supported modes: dry-run, workspace" >&2
  exit 1
fi

mkdir -p "$TARGET_ROOT"
while IFS= read -r -d '' source; do
  relative="${source#$TEMPLATE_ROOT/}"
  dest="$TARGET_ROOT/$relative"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" ]]; then
    echo "Skip existing: $dest"
  else
    cp "$source" "$dest"
    echo "Created: $dest"
  fi
done < <(find "$TEMPLATE_ROOT" -type f -print0)

echo
echo "Workspace context installed. Next: run \$evolve init."

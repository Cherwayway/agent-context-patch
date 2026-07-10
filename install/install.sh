#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
WORKSPACE="$(pwd)"
AGENT="Other"
SKILL_TARGET=""
INSTRUCTION_TARGET=""
APPROVED_PLAN_HASH=""

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
    --agent)
      AGENT="$2"
      shift 2
      ;;
    --skill-target)
      SKILL_TARGET="$2"
      shift 2
      ;;
    --instruction-file)
      INSTRUCTION_TARGET="$2"
      shift 2
      ;;
    --approved-plan-hash)
      APPROVED_PLAN_HASH="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$MODE" == "workspace" ]]; then
  echo "Mode workspace was replaced by dry-run/apply. Dry-run first, approve the plan hash, then use --mode apply --approved-plan-hash <hash>." >&2
  exit 1
fi
if [[ "$MODE" != "dry-run" && "$MODE" != "apply" ]]; then
  echo "Supported modes: dry-run, apply" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
TEMPLATE_ROOT="$REPO_ROOT/templates/.agent-context"
SKILL_SOURCE_ROOT="$REPO_ROOT/skills/evolve"
WORKSPACE="$(cd "$WORKSPACE" && pwd -P)"
TARGET_ROOT="$WORKSPACE/.agent-context"

absolute_input_path() {
  local value="$1"
  if [[ -z "$value" ]]; then
    printf ''
  elif [[ "$value" == /* ]]; then
    printf '%s' "$value"
  else
    printf '%s/%s' "$(pwd -P)" "$value"
  fi
}

SKILL_TARGET="$(absolute_input_path "$SKILL_TARGET")"
INSTRUCTION_TARGET="$(absolute_input_path "$INSTRUCTION_TARGET")"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

first_symlink() {
  local root="$1"
  if [[ -L "$root" ]]; then
    printf '%s' "$root"
  elif [[ -d "$root" ]]; then
    find "$root" -type l -print -quit
  fi
}

ACTION_STATES=()
ACTION_KINDS=()
ACTION_SOURCES=()
ACTION_TARGETS=()
ACTION_DETAILS=()

add_action() {
  ACTION_STATES+=("$1")
  ACTION_KINDS+=("$2")
  ACTION_SOURCES+=("$3")
  ACTION_TARGETS+=("$4")
  ACTION_DETAILS+=("${5:-}")
}

add_tree_plan() {
  local source_root="$1"
  local destination_root="$2"
  local kind="$3"
  local source relative destination source_hash
  while IFS= read -r -d '' source; do
    relative="${source#"$source_root"/}"
    destination="$destination_root/$relative"
    source_hash="$(sha256_file "$source")"
    if [[ ! -e "$destination" ]]; then
      add_action "Create" "$kind" "$source" "$destination" "source-sha256=$source_hash"
    elif [[ -d "$destination" ]]; then
      add_action "Conflict" "$kind" "$source" "$destination" "target-is-directory;source-sha256=$source_hash"
    elif [[ "$source_hash" == "$(sha256_file "$destination")" ]]; then
      add_action "Skip" "$kind" "$source" "$destination" "identical;source-sha256=$source_hash"
    elif [[ "$kind" == "workspace-context" ]]; then
      add_action "Preserve" "$kind" "$source" "$destination" "existing-workspace-context;source-sha256=$source_hash"
    else
      add_action "Conflict" "$kind" "$source" "$destination" "existing-skill-differs;source-sha256=$source_hash"
    fi
  done < <(find "$source_root" -type f -print0)
}

LEGACY_CONFIG="$TARGET_ROOT/config.yml"
LEGACY_WORKSPACE=false
CONTEXT_SYMLINK="$(first_symlink "$TARGET_ROOT")"
if [[ -n "$CONTEXT_SYMLINK" ]]; then
  LEGACY_WORKSPACE=true
  add_action "Conflict" "workspace-context" "" "$CONTEXT_SYMLINK" "symlink-not-followed"
elif [[ -e "$TARGET_ROOT" && ! -d "$TARGET_ROOT" ]]; then
  LEGACY_WORKSPACE=true
  add_action "Conflict" "workspace-context" "" "$TARGET_ROOT" "context-root-is-not-directory"
elif [[ -e "$LEGACY_CONFIG" && ! -f "$LEGACY_CONFIG" ]]; then
  LEGACY_WORKSPACE=true
  add_action "Conflict" "workspace-context" "" "$LEGACY_CONFIG" "config-is-not-a-file"
elif [[ -f "$LEGACY_CONFIG" ]]; then
  SCHEMA_MATCHES="$(grep -E '^[[:space:]]*schema_version[[:space:]]*:[[:space:]]*[0-9]+[[:space:]]*(#.*)?$' "$LEGACY_CONFIG" || true)"
  SCHEMA_COUNT="$(printf '%s\n' "$SCHEMA_MATCHES" | sed '/^$/d' | wc -l | tr -d '[:space:]')"
  if [[ "$SCHEMA_COUNT" -gt 1 ]]; then
    LEGACY_WORKSPACE=true
    add_action "Conflict" "workspace-context" "" "$LEGACY_CONFIG" "duplicate-schema-version"
  elif [[ "$SCHEMA_COUNT" -eq 0 ]]; then
    LEGACY_WORKSPACE=true
    add_action "MigrationRequired" "workspace-context" "" "$LEGACY_CONFIG" "legacy-v0-is-read-only"
  else
    SCHEMA_VERSION="$(printf '%s\n' "$SCHEMA_MATCHES" | sed -E 's/^[[:space:]]*schema_version[[:space:]]*:[[:space:]]*([0-9]+).*/\1/')"
    if [[ "$SCHEMA_VERSION" == "0" ]]; then
      LEGACY_WORKSPACE=true
      add_action "MigrationRequired" "workspace-context" "" "$LEGACY_CONFIG" "legacy-v0-is-read-only"
    elif [[ "$SCHEMA_VERSION" != "1" ]]; then
      LEGACY_WORKSPACE=true
      add_action "UpgradeRequired" "workspace-context" "" "$LEGACY_CONFIG" "schema-version=$SCHEMA_VERSION;newer-bootstrap-required"
    fi
  fi
elif [[ -d "$TARGET_ROOT" && ! -f "$LEGACY_CONFIG" ]] &&
  [[ -n "$(find "$TARGET_ROOT" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
  LEGACY_WORKSPACE=true
  add_action "MigrationRequired" "workspace-context" "" "$TARGET_ROOT" "legacy-v0-missing-config-is-read-only"
fi

if [[ "$LEGACY_WORKSPACE" == false ]]; then
  add_tree_plan "$TEMPLATE_ROOT" "$TARGET_ROOT" "workspace-context"
fi

manifest_version() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}

if [[ -n "$SKILL_TARGET" ]]; then
  SOURCE_MANIFEST="$SKILL_SOURCE_ROOT/manifest.json"
  TARGET_MANIFEST="$SKILL_TARGET/manifest.json"
  SKILL_SYMLINK="$(first_symlink "$SKILL_TARGET")"
  if [[ -n "$SKILL_SYMLINK" ]]; then
    add_action "Conflict" "skill" "$SOURCE_MANIFEST" "$SKILL_SYMLINK" "symlink-not-followed"
  elif [[ -e "$SKILL_TARGET" && ! -f "$TARGET_MANIFEST" ]]; then
    add_action "Conflict" "skill" "$SOURCE_MANIFEST" "$SKILL_TARGET" "existing-unversioned-skill"
  elif [[ -f "$TARGET_MANIFEST" ]]; then
    SOURCE_VERSION="$(manifest_version "$SOURCE_MANIFEST")"
    TARGET_VERSION="$(manifest_version "$TARGET_MANIFEST")"
    if [[ "$SOURCE_VERSION" != "$TARGET_VERSION" ]]; then
      add_action "UpgradeRequired" "skill" "$SOURCE_MANIFEST" "$TARGET_MANIFEST" "installed=$TARGET_VERSION;source=$SOURCE_VERSION"
    else
      add_tree_plan "$SKILL_SOURCE_ROOT" "$SKILL_TARGET" "skill"
    fi
  else
    add_tree_plan "$SKILL_SOURCE_ROOT" "$SKILL_TARGET" "skill"
  fi
fi

if [[ -n "$INSTRUCTION_TARGET" ]]; then
  add_action "GuidancePatchRequired" "instruction" "" "$INSTRUCTION_TARGET" "agent-must-propose-semantic-patch"
fi

PLAN_TMP="${TMPDIR:-/tmp}/agent-context-plan-$$.txt"
trap 'rm -f "$PLAN_TMP"' EXIT
{
  printf 'agent=%s\n' "$AGENT"
  printf 'workspace=%s\n' "$WORKSPACE"
  printf 'skillTarget=%s\n' "$SKILL_TARGET"
  printf 'instructionTarget=%s\n' "$INSTRUCTION_TARGET"
  for ((i = 0; i < ${#ACTION_STATES[@]}; i++)); do
    printf '%s|%s|%s|%s|%s\n' \
      "${ACTION_STATES[$i]}" \
      "${ACTION_KINDS[$i]}" \
      "${ACTION_SOURCES[$i]}" \
      "${ACTION_TARGETS[$i]}" \
      "${ACTION_DETAILS[$i]}"
  done | LC_ALL=C sort
} > "$PLAN_TMP"
PLAN_HASH="$(sha256_stdin < "$PLAN_TMP")"

BLOCKED=false
for state in "${ACTION_STATES[@]}"; do
  if [[ "$state" == "Conflict" || "$state" == "MigrationRequired" || "$state" == "UpgradeRequired" ]]; then
    BLOCKED=true
  fi
done

echo "Agent Context Patch Bootstrap"
echo "Mode: $MODE"
echo "Agent: $AGENT"
echo "Workspace: $WORKSPACE"
[[ -n "$SKILL_TARGET" ]] && echo "Skill target: $SKILL_TARGET"
[[ -n "$INSTRUCTION_TARGET" ]] && echo "Instruction target: $INSTRUCTION_TARGET"
echo
echo "Plan:"
for ((i = 0; i < ${#ACTION_STATES[@]}; i++)); do
  suffix=""
  [[ -n "${ACTION_DETAILS[$i]}" ]] && suffix=" (${ACTION_DETAILS[$i]})"
  echo "${ACTION_STATES[$i]}: ${ACTION_TARGETS[$i]}$suffix"
done
echo "Plan hash: $PLAN_HASH"
if [[ "$BLOCKED" == true ]]; then
  echo "Plan status: blocked"
else
  echo "Plan status: ready"
fi

if [[ "$MODE" == "dry-run" ]]; then
  echo "Dry run complete. No files were written."
  [[ "$BLOCKED" == true ]] && exit 2
  exit 0
fi

if [[ -z "$APPROVED_PLAN_HASH" ]]; then
  echo "Apply requires --approved-plan-hash from the reviewed dry-run." >&2
  exit 1
fi
NORMALIZED_APPROVED_HASH="$(printf '%s' "$APPROVED_PLAN_HASH" | tr '[:upper:]' '[:lower:]')"
if [[ "$NORMALIZED_APPROVED_HASH" != "$PLAN_HASH" ]]; then
  echo "Approved plan hash does not match the current plan. Re-run dry-run and review the new plan." >&2
  exit 1
fi
if [[ "$BLOCKED" == true ]]; then
  echo "The approved plan is blocked by a conflict, upgrade, or migration requirement." >&2
  exit 2
fi

CREATED=()
rollback_created() {
  local created
  for created in "${CREATED[@]}"; do
    [[ -f "$created" ]] && rm -f "$created"
  done
}
fail_apply() {
  local message="$1"
  rollback_created
  echo "$message" >&2
  exit 1
}
copy_exclusive() {
  local source="$1"
  local target="$2"
  set -o noclobber
  if ! exec 3> "$target"; then
    set +o noclobber
    return 1
  fi
  set +o noclobber
  CREATED+=("$target")
  if ! cat "$source" >&3; then
    exec 3>&-
    return 2
  fi
  exec 3>&-
}
trap 'rollback_created; rm -f "$PLAN_TMP"' ERR

for ((i = 0; i < ${#ACTION_STATES[@]}; i++)); do
  if [[ "${ACTION_STATES[$i]}" == "Create" ]]; then
    mkdir -p "$(dirname "${ACTION_TARGETS[$i]}")"
    if [[ -e "${ACTION_TARGETS[$i]}" ]]; then
      fail_apply "Target changed after planning: ${ACTION_TARGETS[$i]}"
    fi
    expected_source_hash="$(printf '%s' "${ACTION_DETAILS[$i]}" | sed -n 's/.*source-sha256=\([a-f0-9]\{64\}\).*/\1/p')"
    if [[ -z "$expected_source_hash" || "$(sha256_file "${ACTION_SOURCES[$i]}")" != "$expected_source_hash" ]]; then
      fail_apply "Source changed after planning: ${ACTION_SOURCES[$i]}"
    fi
    if ! copy_exclusive "${ACTION_SOURCES[$i]}" "${ACTION_TARGETS[$i]}"; then
      fail_apply "Target changed or copy failed after planning: ${ACTION_TARGETS[$i]}"
    fi
    if [[ "$(sha256_file "${ACTION_TARGETS[$i]}")" != "$expected_source_hash" ]]; then
      fail_apply "Copied content did not match its planned source: ${ACTION_TARGETS[$i]}"
    fi
  fi
done
trap 'rm -f "$PLAN_TMP"' EXIT
trap - ERR

PRESERVED_COUNT=0
SKIPPED_COUNT=0
for state in "${ACTION_STATES[@]}"; do
  [[ "$state" == "Preserve" ]] && PRESERVED_COUNT=$((PRESERVED_COUNT + 1))
  [[ "$state" == "Skip" ]] && SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
done

echo
echo "Install receipt:"
echo "Status: applied"
echo "Plan hash: $PLAN_HASH"
echo "Created files: ${#CREATED[@]}"
echo "Preserved files: $PRESERVED_COUNT"
echo "Skipped files: $SKIPPED_COUNT"
if [[ -n "$INSTRUCTION_TARGET" ]]; then
  echo "Guidance patch required: true"
else
  echo "Guidance patch required: false"
fi

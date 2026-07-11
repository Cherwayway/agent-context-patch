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

inspect_v1_config() {
  LC_ALL=C awk '
    BEGIN {
      dq = sprintf("%c", 34)
      sq = sprintf("%c", 39)
      bs = sprintf("%c", 92)
      require_path("schema_version")
      require_path("created_with_kit_version")
      require_path("last_migrated_with_kit_version")
      require_path("context_write_policy")
      require_path("enabled_domains")
      require_path("budgets")
      require_path("budgets.active_context")
      require_path("budgets.active_context.unit")
      require_path("budgets.active_context.warn")
      require_path("budgets.active_context.block_auto")
      require_path("budgets.single_proposal")
      require_path("budgets.single_proposal.unit")
      require_path("budgets.single_proposal.warn")
      require_path("budgets.pending_proposals")
      require_path("budgets.pending_proposals.unit")
      require_path("budgets.pending_proposals.warn")
      require_path("budgets.pending_proposals.block_auto")
      require_path("privacy")
      require_path("privacy.raw_conversation_stored")
      require_path("privacy.full_logs_stored")
      require_path("privacy.secrets_stored")
      require_path("privacy.customer_data_stored")
      require_path("privacy.absolute_user_paths_stored")
    }

    function require_path(path) { required[path] = 1 }
    function trim(value) {
      sub(/^[ ]+/, "", value)
      sub(/[ ]+$/, "", value)
      return value
    }
    function fail(reason) {
      if (first_error == "") first_error = reason
      return 0
    }
    function strip_comment(value, i, character, quote, escaped) {
      quote = ""
      escaped = 0
      for (i = 1; i <= length(value); i++) {
        character = substr(value, i, 1)
        if (quote == dq) {
          if (escaped) escaped = 0
          else if (character == bs) escaped = 1
          else if (character == quote) quote = ""
        } else if (quote == sq) {
          if (character == quote && substr(value, i + 1, 1) == quote) i++
          else if (character == quote) quote = ""
        } else if (character == dq || character == sq) {
          quote = character
        } else if (character == "#" && (i == 1 || substr(value, i - 1, 1) ~ /[[:space:]]/)) {
          return trim(substr(value, 1, i - 1))
        }
      }
      return value
    }
    function hex_value(hex, i, character, value, digit) {
      value = 0
      for (i = 1; i <= length(hex); i++) {
        character = substr(hex, i, 1)
        if (character >= "0" && character <= "9") digit = character + 0
        else if (character >= "a" && character <= "f") digit = 10 + index("abcdef", character) - 1
        else if (character >= "A" && character <= "F") digit = 10 + index("ABCDEF", character) - 1
        else return -1
        value = value * 16 + digit
      }
      return value
    }
    function decode_double(raw, i, character, escaped, hex, code, result) {
      if (length(raw) < 2 || substr(raw, length(raw), 1) != dq) return fail("invalid-quoted-string")
      result = ""
      for (i = 2; i < length(raw); i++) {
        character = substr(raw, i, 1)
        if (character == dq) return fail("invalid-quoted-string")
        if (character != bs) {
          result = result character
          continue
        }
        i++
        if (i >= length(raw)) return fail("invalid-quoted-string")
        escaped = substr(raw, i, 1)
        if (escaped == dq || escaped == bs || escaped == "/") result = result escaped
        else if (escaped == "b") result = result sprintf("%c", 8)
        else if (escaped == "f") result = result sprintf("%c", 12)
        else if (escaped == "n") result = result sprintf("%c", 10)
        else if (escaped == "r") result = result sprintf("%c", 13)
        else if (escaped == "t") result = result sprintf("%c", 9)
        else if (escaped == "u") {
          hex = substr(raw, i + 1, 4)
          if (length(hex) != 4 || (code = hex_value(hex)) < 0 || code > 127) {
            return fail("invalid-quoted-string")
          }
          result = result sprintf("%c", code)
          i += 4
        } else return fail("invalid-quoted-string")
      }
      parsed_value = result
      return 1
    }
    function decode_single(raw, i, character, result) {
      if (length(raw) < 2 || substr(raw, length(raw), 1) != sq) return fail("invalid-quoted-string")
      result = ""
      for (i = 2; i < length(raw); i++) {
        character = substr(raw, i, 1)
        if (character == sq) {
          if (substr(raw, i + 1, 1) != sq || i + 1 >= length(raw)) {
            return fail("invalid-quoted-string")
          }
          result = result sq
          i++
        } else result = result character
      }
      parsed_value = result
      return 1
    }
    function parse_nonlist_scalar(raw) {
      raw = trim(raw)
      if (raw == "true" || raw == "false") {
        parsed_type = "boolean"
        parsed_value = raw
        return 1
      }
      if (raw == "null" || raw == "~") {
        parsed_type = "null"
        parsed_value = ""
        return 1
      }
      if (raw ~ /^-?(0|[1-9][0-9]*)$/) {
        parsed_type = "integer"
        parsed_value = raw + 0
        return 1
      }
      if (substr(raw, 1, 1) == dq) {
        if (!decode_double(raw)) return 0
        parsed_type = "string"
        return 1
      }
      if (substr(raw, 1, 1) == sq) {
        if (!decode_single(raw)) return 0
        parsed_type = "string"
        return 1
      }
      parsed_type = "string"
      parsed_value = raw
      return 1
    }
    function add_inline_part(part) {
      part = trim(part)
      if (part == "") return fail("empty-inline-list-item")
      if (!parse_nonlist_scalar(part)) return 0
      inline_count++
      inline_type[inline_count] = parsed_type
      inline_value[inline_count] = parsed_value
      return 1
    }
    function parse_inline_list(raw, inner, i, start, character, quote, escaped) {
      for (i in inline_type) delete inline_type[i]
      for (i in inline_value) delete inline_value[i]
      inline_count = 0
      if (substr(raw, length(raw), 1) != "]") return fail("unclosed-inline-list")
      inner = trim(substr(raw, 2, length(raw) - 2))
      if (inner == "") return 1
      quote = ""
      escaped = 0
      start = 1
      for (i = 1; i <= length(inner); i++) {
        character = substr(inner, i, 1)
        if (quote == dq) {
          if (escaped) escaped = 0
          else if (character == bs) escaped = 1
          else if (character == quote) quote = ""
        } else if (quote == sq) {
          if (character == quote && substr(inner, i + 1, 1) == quote) i++
          else if (character == quote) quote = ""
        } else if (character == dq || character == sq) {
          quote = character
        } else if (character == ",") {
          if (!add_inline_part(substr(inner, start, i - start))) return 0
          start = i + 1
        }
      }
      if (quote != "") return fail("unclosed-inline-list-quote")
      return add_inline_part(substr(inner, start))
    }
    function parse_scalar(raw) {
      raw = trim(raw)
      if (substr(raw, 1, 1) == "[") {
        if (!parse_inline_list(raw)) return 0
        parsed_type = "list"
        parsed_value = ""
        return 1
      }
      return parse_nonlist_scalar(raw)
    }
    function add_entry(path, entry_type, entry_value) {
      if (path in seen) return fail("duplicate-key")
      seen[path] = 1
      kind[path] = entry_type
      value[path] = entry_value
      return 1
    }
    function copy_inline_domains(i) {
      domain_count = inline_count
      for (i = 1; i <= inline_count; i++) {
        domain_type[i] = inline_type[i]
        domain_value[i] = inline_value[i]
      }
    }
    function check_scalar(path, expected_type, expected_value) {
      return kind[path] == expected_type && value[path] == expected_value
    }

    {
      raw = $0
      sub(/\r$/, "", raw)
      if (NR == 1) sub(/^\357\273\277/, "", raw)
      if (index(raw, "\t") > 0) fail("tabs-not-supported")
      cleaned = strip_comment(raw)
      if (trim(cleaned) == "") next
      indent = 0
      while (substr(cleaned, indent + 1, 1) == " ") indent++
      content = trim(substr(cleaned, indent + 1))

      if (indent == 0 && index(content, "schema_version:") == 1) {
        schema_count++
        schema_raw = trim(substr(content, length("schema_version:") + 1))
        if (parse_scalar(schema_raw)) {
          schema_type = parsed_type
          schema_value = parsed_value
        }
      }

      if (record_count == 0 && indent != 0) fail("document-not-at-indentation-zero")
      record_count++
      while (depth > 0 && indent <= stack_indent[depth]) depth--
      parent_path = depth > 0 ? stack_path[depth] : ""
      if (indent == 0 && parent_path != "") fail("unexpected-indentation")
      if (indent > 0 && parent_path == "") fail("unexpected-indentation")
      if (parent_path != "") {
        if (!(parent_path in child_indent)) child_indent[parent_path] = indent
        else if (child_indent[parent_path] != indent) fail("inconsistent-indentation")
      }

      if (content == "-" || index(content, "- ") == 1) {
        if (parent_path != "enabled_domains") {
          fail("unsupported-sequence")
          next
        }
        item = trim(substr(content, 2))
        if (item == "" || !parse_scalar(item) || parsed_type == "list") {
          fail("invalid-sequence-item")
          next
        }
        if (kind[parent_path] == "container") kind[parent_path] = "list"
        else if (kind[parent_path] != "list") fail("invalid-sequence-parent")
        domain_count++
        domain_type[domain_count] = parsed_type
        domain_value[domain_count] = parsed_value
        next
      }

      colon = index(content, ":")
      if (colon == 0) {
        fail("unsupported-yaml-syntax")
        next
      }
      key = substr(content, 1, colon - 1)
      remainder = substr(content, colon + 1)
      if (key !~ /^[A-Za-z_][A-Za-z0-9_-]*$/ ||
          (remainder != "" && substr(remainder, 1, 1) != " ")) {
        fail("unsupported-yaml-syntax")
        next
      }
      if (key == "__proto__" || key == "prototype" || key == "constructor") {
        fail("dangerous-key")
      }
      path = parent_path == "" ? key : parent_path "." key
      raw_value = trim(remainder)
      if (raw_value == "") {
        if (!add_entry(path, "container", "")) next
        depth++
        stack_path[depth] = path
        stack_indent[depth] = indent
      } else {
        if (!parse_scalar(raw_value)) next
        if (!add_entry(path, parsed_type, parsed_value)) next
        if (path == "enabled_domains" && parsed_type == "list") copy_inline_domains()
      }
    }

    END {
      if (schema_count == 0) {
        print "legacy:missing-schema-version"
        exit
      }
      if (schema_count > 1) {
        print "conflict:duplicate-schema-version"
        exit
      }
      if (schema_type != "integer") {
        print "invalid:schema-version-invalid"
        exit
      }
      if (schema_value == 0) {
        print "legacy:legacy-v0-is-read-only"
        exit
      }
      if (schema_value > 1) {
        print "future:" schema_value
        exit
      }
      if (schema_value != 1 || first_error != "") {
        print "invalid:" (first_error == "" ? "schema-version-invalid" : first_error)
        exit
      }

      for (path in seen) {
        if (!(path in required)) {
          print "invalid:unsupported-key"
          exit
        }
      }
      for (path in required) {
        if (!(path in seen)) {
          print "invalid:missing-required-key"
          exit
        }
      }
      if (kind["budgets"] != "container" ||
          kind["budgets.active_context"] != "container" ||
          kind["budgets.single_proposal"] != "container" ||
          kind["budgets.pending_proposals"] != "container" ||
          kind["privacy"] != "container") {
        print "invalid:mapping-required"
        exit
      }
      if (!check_scalar("schema_version", "integer", 1) ||
          !check_scalar("created_with_kit_version", "string", "0.2.0") ||
          !(kind["last_migrated_with_kit_version"] == "null" ||
            check_scalar("last_migrated_with_kit_version", "string", "0.2.0")) ||
          !(check_scalar("context_write_policy", "string", "propose") ||
            check_scalar("context_write_policy", "string", "auto"))) {
        print "invalid:config-header-invalid"
        exit
      }
      if (kind["enabled_domains"] != "list") {
        print "invalid:enabled-domains-invalid"
        exit
      }
      for (i = 1; i <= domain_count; i++) {
        if (domain_type[i] != "string" || domain_value[i] !~ /^[a-z0-9][a-z0-9-]*$/) {
          print "invalid:enabled-domain-invalid"
          exit
        }
        if (++domain_seen[domain_value[i]] > 1) {
          print "invalid:enabled-domain-duplicate"
          exit
        }
      }
      if (!check_scalar("budgets.active_context.unit", "string", "lines") ||
          !check_scalar("budgets.single_proposal.unit", "string", "lines") ||
          !check_scalar("budgets.pending_proposals.unit", "string", "count") ||
          kind["budgets.active_context.warn"] != "integer" || value["budgets.active_context.warn"] <= 0 ||
          kind["budgets.single_proposal.warn"] != "integer" || value["budgets.single_proposal.warn"] <= 0 ||
          kind["budgets.pending_proposals.warn"] != "integer" || value["budgets.pending_proposals.warn"] <= 0 ||
          kind["budgets.active_context.block_auto"] != "integer" ||
          value["budgets.active_context.block_auto"] <= value["budgets.active_context.warn"] ||
          kind["budgets.pending_proposals.block_auto"] != "integer" ||
          value["budgets.pending_proposals.block_auto"] <= value["budgets.pending_proposals.warn"]) {
        print "invalid:budget-invalid"
        exit
      }
      if (!check_scalar("privacy.raw_conversation_stored", "boolean", "false") ||
          !check_scalar("privacy.full_logs_stored", "boolean", "false") ||
          !check_scalar("privacy.secrets_stored", "boolean", "false") ||
          !check_scalar("privacy.customer_data_stored", "boolean", "false") ||
          !check_scalar("privacy.absolute_user_paths_stored", "boolean", "false")) {
        print "invalid:privacy-invalid"
        exit
      }
      print "valid"
    }
  ' "$1"
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
  CONFIG_CLASSIFICATION="$(inspect_v1_config "$LEGACY_CONFIG")"
  case "$CONFIG_CLASSIFICATION" in
    valid)
      ;;
    legacy:*)
      LEGACY_WORKSPACE=true
      add_action "MigrationRequired" "workspace-context" "" "$LEGACY_CONFIG" "legacy-v0-is-read-only"
      ;;
    future:*)
      LEGACY_WORKSPACE=true
      SCHEMA_VERSION="${CONFIG_CLASSIFICATION#future:}"
      add_action "UpgradeRequired" "workspace-context" "" "$LEGACY_CONFIG" "schema-version=$SCHEMA_VERSION;newer-bootstrap-required"
      ;;
    conflict:*)
      LEGACY_WORKSPACE=true
      add_action "Conflict" "workspace-context" "" "$LEGACY_CONFIG" "${CONFIG_CLASSIFICATION#conflict:}"
      ;;
    invalid:*|*)
      LEGACY_WORKSPACE=true
      add_action "InvalidConfig" "workspace-context" "" "$LEGACY_CONFIG" "schema-v1-envelope-invalid;${CONFIG_CLASSIFICATION#invalid:}"
      ;;
  esac
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
  if [[ "$state" == "Conflict" || "$state" == "InvalidConfig" || "$state" == "MigrationRequired" || "$state" == "UpgradeRequired" ]]; then
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
  echo "The approved plan is blocked by an invalid config, conflict, upgrade, or migration requirement." >&2
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

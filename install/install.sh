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
IS_UPDATE_MODE=false
if [[ "$MODE" == "update-dry-run" || "$MODE" == "update-apply" ]]; then
  IS_UPDATE_MODE=true
elif [[ "$MODE" != "dry-run" && "$MODE" != "apply" ]]; then
  echo "Supported modes: dry-run, apply, update-dry-run, update-apply" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
TEMPLATE_ROOT="$REPO_ROOT/templates/.agent-context"
SKILL_SOURCE_ROOT="$REPO_ROOT/skills/evolve"

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

if [[ "$IS_UPDATE_MODE" == true ]]; then
  WORKSPACE="$(absolute_input_path "$WORKSPACE")"
else
  WORKSPACE="$(cd "$WORKSPACE" && pwd -P)"
fi
TARGET_ROOT="$WORKSPACE/.agent-context"

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
    function valid_semver_identifiers(identifiers, reject_numeric_leading_zero, parts, count, i) {
      if (identifiers == "") return 0
      count = split(identifiers, parts, "[.]")
      for (i = 1; i <= count; i++) {
        if (parts[i] == "" || parts[i] !~ /^[0-9A-Za-z-]+$/) return 0
        if (reject_numeric_leading_zero && parts[i] ~ /^[0-9]+$/ &&
            length(parts[i]) > 1 && substr(parts[i], 1, 1) == "0") return 0
      }
      return 1
    }
    function is_semver(version, core, marker, metadata, parts, count, i) {
      core = version
      marker = index(core, "+")
      if (marker > 0) {
        metadata = substr(core, marker + 1)
        if (!valid_semver_identifiers(metadata, 0)) return 0
        core = substr(core, 1, marker - 1)
      }
      marker = index(core, "-")
      if (marker > 0) {
        metadata = substr(core, marker + 1)
        if (!valid_semver_identifiers(metadata, 1)) return 0
        core = substr(core, 1, marker - 1)
      }
      count = split(core, parts, "[.]")
      if (count != 3) return 0
      for (i = 1; i <= count; i++) {
        if (parts[i] !~ /^[0-9]+$/ ||
            (length(parts[i]) > 1 && substr(parts[i], 1, 1) == "0")) return 0
      }
      return 1
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
          kind["created_with_kit_version"] != "string" ||
          !is_semver(value["created_with_kit_version"]) ||
          !(kind["last_migrated_with_kit_version"] == "null" ||
            (kind["last_migrated_with_kit_version"] == "string" &&
             is_semver(value["last_migrated_with_kit_version"]))) ||
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

valid_semver_identifiers() {
  local value="$1"
  local reject_numeric_leading_zero="$2"
  local identifier
  local identifiers=()

  [[ -n "$value" && "$value" != .* && "$value" != *. && "$value" != *..* ]] || return 1
  IFS='.' read -r -a identifiers <<< "$value"
  for identifier in "${identifiers[@]}"; do
    [[ "$identifier" =~ ^[0-9A-Za-z-]+$ ]] || return 1
    if [[ "$reject_numeric_leading_zero" == true &&
      "$identifier" =~ ^[0-9]+$ && ${#identifier} -gt 1 && "$identifier" == 0* ]]; then
      return 1
    fi
  done
}

is_semver() {
  local version="$1"
  local without_build="$version"
  local build=""
  local core
  local prerelease=""
  local part
  local core_parts=()

  if [[ "$without_build" == *+* ]]; then
    build="${without_build#*+}"
    without_build="${without_build%%+*}"
    [[ "$build" != *+* ]] || return 1
    valid_semver_identifiers "$build" false || return 1
  fi
  if [[ "$without_build" == *-* ]]; then
    prerelease="${without_build#*-}"
    core="${without_build%%-*}"
    valid_semver_identifiers "$prerelease" true || return 1
  else
    core="$without_build"
  fi

  [[ "$core" != .* && "$core" != *. && "$core" != *..* ]] || return 1
  IFS='.' read -r -a core_parts <<< "$core"
  [[ ${#core_parts[@]} -eq 3 ]] || return 1
  for part in "${core_parts[@]}"; do
    [[ "$part" =~ ^[0-9]+$ ]] || return 1
    [[ ${#part} -eq 1 || "$part" != 0* ]] || return 1
  done
}

compare_numeric_semver_identifier() {
  local left="$1"
  local right="$2"
  local LC_ALL=C

  if [[ ${#left} -lt ${#right} ]]; then
    NUMERIC_SEMVER_COMPARISON=-1
  elif [[ ${#left} -gt ${#right} ]]; then
    NUMERIC_SEMVER_COMPARISON=1
  elif [[ "$left" == "$right" ]]; then
    NUMERIC_SEMVER_COMPARISON=0
  elif [[ "$left" < "$right" ]]; then
    NUMERIC_SEMVER_COMPARISON=-1
  else
    NUMERIC_SEMVER_COMPARISON=1
  fi
}

compare_semver() {
  local left_without_build="${1%%+*}"
  local right_without_build="${2%%+*}"
  local left_core="$left_without_build"
  local right_core="$right_without_build"
  local left_prerelease=""
  local right_prerelease=""
  local left_identifier
  local right_identifier
  local left_numeric
  local right_numeric
  local comparison
  local index
  local count
  local LC_ALL=C
  local left_core_parts=()
  local right_core_parts=()
  local left_prerelease_parts=()
  local right_prerelease_parts=()

  if [[ "$left_without_build" == *-* ]]; then
    left_core="${left_without_build%%-*}"
    left_prerelease="${left_without_build#*-}"
  fi
  if [[ "$right_without_build" == *-* ]]; then
    right_core="${right_without_build%%-*}"
    right_prerelease="${right_without_build#*-}"
  fi
  IFS='.' read -r -a left_core_parts <<< "$left_core"
  IFS='.' read -r -a right_core_parts <<< "$right_core"
  for index in 0 1 2; do
    compare_numeric_semver_identifier "${left_core_parts[$index]}" "${right_core_parts[$index]}"
    if [[ $NUMERIC_SEMVER_COMPARISON -ne 0 ]]; then
      SEMVER_COMPARISON=$NUMERIC_SEMVER_COMPARISON
      return
    fi
  done

  if [[ -z "$left_prerelease" && -z "$right_prerelease" ]]; then
    SEMVER_COMPARISON=0
    return
  elif [[ -z "$left_prerelease" ]]; then
    SEMVER_COMPARISON=1
    return
  elif [[ -z "$right_prerelease" ]]; then
    SEMVER_COMPARISON=-1
    return
  fi

  IFS='.' read -r -a left_prerelease_parts <<< "$left_prerelease"
  IFS='.' read -r -a right_prerelease_parts <<< "$right_prerelease"
  count=${#left_prerelease_parts[@]}
  if [[ ${#right_prerelease_parts[@]} -gt $count ]]; then
    count=${#right_prerelease_parts[@]}
  fi
  for ((index = 0; index < count; index++)); do
    if [[ $index -ge ${#left_prerelease_parts[@]} ]]; then
      SEMVER_COMPARISON=-1
      return
    elif [[ $index -ge ${#right_prerelease_parts[@]} ]]; then
      SEMVER_COMPARISON=1
      return
    fi
    left_identifier="${left_prerelease_parts[$index]}"
    right_identifier="${right_prerelease_parts[$index]}"
    if [[ "$left_identifier" == "$right_identifier" ]]; then
      continue
    fi
    left_numeric=false
    right_numeric=false
    [[ "$left_identifier" =~ ^[0-9]+$ ]] && left_numeric=true
    [[ "$right_identifier" =~ ^[0-9]+$ ]] && right_numeric=true
    if [[ "$left_numeric" == true && "$right_numeric" == true ]]; then
      compare_numeric_semver_identifier "$left_identifier" "$right_identifier"
      comparison=$NUMERIC_SEMVER_COMPARISON
    elif [[ "$left_numeric" == true ]]; then
      comparison=-1
    elif [[ "$right_numeric" == true ]]; then
      comparison=1
    elif [[ "$left_identifier" < "$right_identifier" ]]; then
      comparison=-1
    else
      comparison=1
    fi
    SEMVER_COMPARISON=$comparison
    return
  done
  SEMVER_COMPARISON=0
}

update_manifest_version() {
  local skill_root="$1"
  local manifest_path="$skill_root/manifest.json"
  local version

  if [[ ! -f "$manifest_path" ]]; then
    echo "Skill manifest is missing: $manifest_path" >&2
    return 1
  fi
  if ! version="$(parse_json_manifest_version "$manifest_path")"; then
    echo "Skill manifest is invalid JSON: $manifest_path" >&2
    return 1
  fi
  if ! is_semver "$version"; then
    echo "Skill manifest version is not valid SemVer: $manifest_path" >&2
    return 1
  fi
  printf '%s' "$version"
}

parse_json_manifest_version() {
  awk '
    function fail() { exit 2 }
    function skip_ws() {
      while (position <= length(document) && substr(document, position, 1) ~ /[ \t\r\n]/) position++
    }
    function hex_value(character, offset) {
      character = tolower(character)
      if (character >= "0" && character <= "9") return character + 0
      offset = index("abcdef", character)
      if (offset > 0) return offset + 9
      fail()
    }
    function decode_unicode(hex, value, index_) {
      value = 0
      for (index_ = 1; index_ <= 4; index_++) value = value * 16 + hex_value(substr(hex, index_, 1))
      if (value >= 32 && value <= 126) return sprintf("%c", value)
      return "?"
    }
    function parse_string(result, character, escape, hex) {
      if (substr(document, position, 1) != "\"") fail()
      position++
      result = ""
      parsed_string_had_escape = 0
      while (position <= length(document)) {
        character = substr(document, position, 1)
        if (character == "\"") {
          position++
          parsed_string = result
          return
        }
        if (character == "\\") {
          parsed_string_had_escape = 1
          position++
          if (position > length(document)) fail()
          escape = substr(document, position, 1)
          if (escape == "\"" || escape == "\\" || escape == "/") result = result escape
          else if (escape == "b") result = result sprintf("%c", 8)
          else if (escape == "f") result = result sprintf("%c", 12)
          else if (escape == "n") result = result "\n"
          else if (escape == "r") result = result "\r"
          else if (escape == "t") result = result "\t"
          else if (escape == "u") {
            hex = substr(document, position + 1, 4)
            if (length(hex) != 4 || hex !~ /^[0-9A-Fa-f]{4}$/) fail()
            result = result decode_unicode(hex)
            position += 4
          } else fail()
        } else {
          if (character ~ /[[:cntrl:]]/) fail()
          result = result character
        }
        position++
      }
      fail()
    }
    function parse_number(remaining) {
      remaining = substr(document, position)
      if (!match(remaining, /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/)) fail()
      position += RLENGTH
    }
    function parse_array(depth) {
      if (depth > 64) fail()
      position++
      skip_ws()
      if (substr(document, position, 1) == "]") { position++; return }
      while (1) {
        parse_value(depth + 1)
        skip_ws()
        if (substr(document, position, 1) == "]") { position++; return }
        if (substr(document, position, 1) != ",") fail()
        position++
        skip_ws()
      }
    }
    function parse_object(is_root, depth, key, key_had_escape, kind) {
      if (depth > 64) fail()
      if (substr(document, position, 1) != "{") fail()
      position++
      skip_ws()
      if (substr(document, position, 1) == "}") { position++; return }
      while (1) {
        parse_string()
        key = parsed_string
        key_had_escape = parsed_string_had_escape
        skip_ws()
        if (substr(document, position, 1) != ":") fail()
        position++
        skip_ws()
        kind = parse_value(depth + 1)
        if (is_root && key == "version") {
          version_count++
          if (key_had_escape || kind != "string" || parsed_string_had_escape) fail()
          manifest_version = parsed_string
        }
        skip_ws()
        if (substr(document, position, 1) == "}") { position++; return }
        if (substr(document, position, 1) != ",") fail()
        position++
        skip_ws()
      }
    }
    function parse_value(depth, character, remaining) {
      skip_ws()
      character = substr(document, position, 1)
      if (character == "\"") { parse_string(); return "string" }
      if (character == "{") { parse_object(0, depth); return "object" }
      if (character == "[") { parse_array(depth); return "array" }
      remaining = substr(document, position)
      if (substr(remaining, 1, 4) == "true") { position += 4; return "boolean" }
      if (substr(remaining, 1, 5) == "false") { position += 5; return "boolean" }
      if (substr(remaining, 1, 4) == "null") { position += 4; return "null" }
      parse_number()
      return "number"
    }
    { document = document (NR == 1 ? "" : "\n") $0 }
    END {
      position = 1
      skip_ws()
      parse_object(1, 0)
      skip_ws()
      if (position <= length(document) || version_count != 1) fail()
      print manifest_version
    }
  ' "$1"
}

tree_fingerprint() {
  local root="$1"
  local fingerprint_input
  local source
  local relative
  local result

  if [[ ! -d "$root" ]]; then
    echo "Tree root is not a directory: $root" >&2
    return 1
  fi
  fingerprint_input="$(mktemp "${TMPDIR:-/tmp}/agent-context-tree.XXXXXX")"
  while IFS= read -r -d '' source; do
    [[ "$source" == "$root" ]] && continue
    relative="${source#"$root"/}"
    printf 'D:%s:%s\n' "${#relative}" "$relative" >> "$fingerprint_input"
  done < <(find "$root" -type d -print0 | LC_ALL=C sort -z)
  while IFS= read -r -d '' source; do
    relative="${source#"$root"/}"
    printf 'F:%s:%s:%s\n' "${#relative}" "$relative" "$(sha256_file "$source")" >> "$fingerprint_input"
  done < <(find "$root" -type f -print0 | LC_ALL=C sort -z)
  result="$(sha256_stdin < "$fingerprint_input")"
  rm -f "$fingerprint_input"
  printf '%s' "$result"
}

copy_tree_snapshot() {
  local source_root="$1"
  local destination_root="$2"

  if [[ -e "$destination_root" || -L "$destination_root" ]]; then
    echo "Snapshot destination already exists: $destination_root" >&2
    return 1
  fi
  mkdir "$destination_root" || return 1
  cp -a "$source_root/." "$destination_root/"
}

if [[ "$IS_UPDATE_MODE" == true ]]; then
  if [[ -z "$SKILL_TARGET" ]]; then
    echo "update-dry-run/update-apply require --skill-target." >&2
    exit 1
  fi
  if [[ -n "$INSTRUCTION_TARGET" ]]; then
    echo "update-dry-run/update-apply only update --skill-target; do not pass --instruction-file." >&2
    exit 1
  fi
  if [[ ! -d "$SKILL_SOURCE_ROOT" ]]; then
    echo "Candidate release skill is missing: $SKILL_SOURCE_ROOT" >&2
    exit 1
  fi
  if [[ ! -d "$SKILL_TARGET" ]]; then
    echo "Installed skill target is missing: $SKILL_TARGET" >&2
    exit 1
  fi

  SOURCE_SYMLINK="$(first_symlink "$SKILL_SOURCE_ROOT")"
  TARGET_SYMLINK="$(first_symlink "$SKILL_TARGET")"
  if [[ -n "$SOURCE_SYMLINK" ]]; then
    add_action "Conflict" "skill-update" "$SOURCE_SYMLINK" "$SKILL_TARGET" "candidate-symlink-not-followed"
  elif [[ -n "$TARGET_SYMLINK" ]]; then
    add_action "Conflict" "skill-update" "$SKILL_SOURCE_ROOT" "$TARGET_SYMLINK" "target-symlink-not-followed"
  fi

  if ! SOURCE_VERSION="$(update_manifest_version "$SKILL_SOURCE_ROOT")"; then
    exit 1
  fi
  if ! TARGET_VERSION="$(update_manifest_version "$SKILL_TARGET")"; then
    exit 1
  fi
  SOURCE_TREE_HASH="$(tree_fingerprint "$SKILL_SOURCE_ROOT")"
  TARGET_TREE_HASH="$(tree_fingerprint "$SKILL_TARGET")"
  SKILL_NAME="$(basename "$SKILL_TARGET")"
  SKILL_PARENT="$(dirname "$SKILL_TARGET")"
  BACKUP_ROOT="$SKILL_PARENT/.agent-context-patch-backups"
  BACKUP_PATH="$BACKUP_ROOT/$SKILL_NAME-$TARGET_VERSION-before-$SOURCE_VERSION"
  BACKUP_ROOT_SYMLINK=""
  BACKUP_ROOT_INVALID=false
  if [[ -e "$BACKUP_ROOT" || -L "$BACKUP_ROOT" ]]; then
    BACKUP_ROOT_SYMLINK="$(first_symlink "$BACKUP_ROOT")"
    [[ ! -d "$BACKUP_ROOT" ]] && BACKUP_ROOT_INVALID=true
  fi

  if [[ -n "$BACKUP_ROOT_SYMLINK" ]]; then
    add_action "Conflict" "skill-update" "$SKILL_TARGET" "$BACKUP_ROOT_SYMLINK" "backup-root-symlink-not-followed"
  elif [[ "$BACKUP_ROOT_INVALID" == true ]]; then
    add_action "Conflict" "skill-update" "$SKILL_TARGET" "$BACKUP_ROOT" "backup-root-not-directory"
  fi

  if [[ -z "$SOURCE_SYMLINK" && -z "$TARGET_SYMLINK" && -z "$BACKUP_ROOT_SYMLINK" && "$BACKUP_ROOT_INVALID" == false ]]; then
    if [[ "$SOURCE_VERSION" == "$TARGET_VERSION" && "$SOURCE_TREE_HASH" == "$TARGET_TREE_HASH" ]]; then
      add_action "NoUpdate" "skill-update" "$SKILL_SOURCE_ROOT" "$SKILL_TARGET" "installed=$TARGET_VERSION;source=$SOURCE_VERSION;tree-sha256=$SOURCE_TREE_HASH"
    elif [[ "$SOURCE_VERSION" == "$TARGET_VERSION" ]]; then
      add_action "Conflict" "skill-update" "$SKILL_SOURCE_ROOT" "$SKILL_TARGET" "same-version-tree-differs;version=$SOURCE_VERSION;source-tree-sha256=$SOURCE_TREE_HASH;target-tree-sha256=$TARGET_TREE_HASH"
    else
      compare_semver "$SOURCE_VERSION" "$TARGET_VERSION"
      if [[ $SEMVER_COMPARISON -le 0 ]]; then
        add_action "DowngradeRequired" "skill-update" "$SKILL_SOURCE_ROOT" "$SKILL_TARGET" "installed=$TARGET_VERSION;source=$SOURCE_VERSION;newer-release-required"
      elif [[ -e "$BACKUP_PATH" || -L "$BACKUP_PATH" ]]; then
        add_action "Conflict" "skill-update" "$SKILL_SOURCE_ROOT" "$BACKUP_PATH" "backup-already-exists;installed=$TARGET_VERSION;source=$SOURCE_VERSION"
      else
        add_action "UpgradeSkill" "skill-update" "$SKILL_SOURCE_ROOT" "$SKILL_TARGET" "installed=$TARGET_VERSION;source=$SOURCE_VERSION;source-tree-sha256=$SOURCE_TREE_HASH;target-tree-sha256=$TARGET_TREE_HASH"
      fi
    fi
  fi

  UPDATE_PLAN_TMP="$(mktemp "${TMPDIR:-/tmp}/agent-context-update-plan.XXXXXX")"
  trap 'rm -f "$UPDATE_PLAN_TMP"' EXIT
  {
    printf 'operation=skill-update\n'
    printf 'source=%s\n' "$SKILL_SOURCE_ROOT"
    printf 'target=%s\n' "$SKILL_TARGET"
    printf 'backup=%s\n' "$BACKUP_PATH"
    printf 'sourceVersion=%s\n' "$SOURCE_VERSION"
    printf 'targetVersion=%s\n' "$TARGET_VERSION"
    printf 'sourceTreeHash=%s\n' "$SOURCE_TREE_HASH"
    printf 'targetTreeHash=%s\n' "$TARGET_TREE_HASH"
    for ((i = 0; i < ${#ACTION_STATES[@]}; i++)); do
      printf '%s|%s|%s|%s|%s\n' \
        "${ACTION_STATES[$i]}" \
        "${ACTION_KINDS[$i]}" \
        "${ACTION_SOURCES[$i]}" \
        "${ACTION_TARGETS[$i]}" \
        "${ACTION_DETAILS[$i]}"
    done | LC_ALL=C sort
  } > "$UPDATE_PLAN_TMP"
  UPDATE_PLAN_HASH="$(sha256_stdin < "$UPDATE_PLAN_TMP")"

  UPDATE_BLOCKED=false
  UPGRADE_ACTION=false
  for state in "${ACTION_STATES[@]}"; do
    if [[ "$state" == "Conflict" || "$state" == "DowngradeRequired" ]]; then
      UPDATE_BLOCKED=true
    elif [[ "$state" == "UpgradeSkill" ]]; then
      UPGRADE_ACTION=true
    fi
  done

  echo "Agent Context Patch Bootstrap"
  echo "Mode: $MODE"
  echo "Skill source: $SKILL_SOURCE_ROOT"
  echo "Skill target: $SKILL_TARGET"
  echo "Backup path: $BACKUP_PATH"
  echo
  echo "Plan:"
  for ((i = 0; i < ${#ACTION_STATES[@]}; i++)); do
    suffix=""
    [[ -n "${ACTION_DETAILS[$i]}" ]] && suffix=" (${ACTION_DETAILS[$i]})"
    echo "${ACTION_STATES[$i]}: ${ACTION_TARGETS[$i]}$suffix"
  done
  echo "Plan hash: $UPDATE_PLAN_HASH"
  if [[ "$UPDATE_BLOCKED" == true ]]; then
    echo "Plan status: blocked"
  else
    echo "Plan status: ready"
  fi

  if [[ "$MODE" == "update-dry-run" ]]; then
    echo "Dry run complete. No files were written."
    [[ "$UPDATE_BLOCKED" == true ]] && exit 2
    exit 0
  fi
  if [[ -z "$APPROVED_PLAN_HASH" ]]; then
    echo "update-apply requires --approved-plan-hash from the reviewed update-dry-run." >&2
    exit 1
  fi
  NORMALIZED_APPROVED_HASH="$(printf '%s' "$APPROVED_PLAN_HASH" | tr '[:upper:]' '[:lower:]')"
  if [[ "$NORMALIZED_APPROVED_HASH" != "$UPDATE_PLAN_HASH" ]]; then
    echo "Approved update plan hash does not match the current source and target trees. Re-run update-dry-run and review the new plan." >&2
    exit 1
  fi
  if [[ "$UPDATE_BLOCKED" == true ]]; then
    echo "The approved update plan is blocked by a conflict." >&2
    exit 2
  fi
  if [[ "$UPGRADE_ACTION" == false ]]; then
    echo
    echo "Update receipt:"
    echo "Status: no-update"
    echo "Plan hash: $UPDATE_PLAN_HASH"
    echo "Installed version: $TARGET_VERSION"
    echo "Previous version: $TARGET_VERSION"
    echo "Restart required: false"
    exit 0
  fi

  STAGE_PATH="$SKILL_PARENT/.agent-context-patch-stage-$RANDOM$RANDOM$$"
  ORIGINAL_MOVED=false
  CANDIDATE_ACTIVATED=false
  UPDATE_FAILURE=""
  CURRENT_BACKUP_ROOT_SYMLINK=""
  if [[ -e "$BACKUP_ROOT" || -L "$BACKUP_ROOT" ]]; then
    CURRENT_BACKUP_ROOT_SYMLINK="$(first_symlink "$BACKUP_ROOT")"
  fi
  if ! copy_tree_snapshot "$SKILL_SOURCE_ROOT" "$STAGE_PATH"; then
    UPDATE_FAILURE="Could not stage the candidate release."
  elif [[ "$(tree_fingerprint "$SKILL_SOURCE_ROOT")" != "$SOURCE_TREE_HASH" ]]; then
    UPDATE_FAILURE="Candidate release changed after planning."
  elif [[ "$(tree_fingerprint "$STAGE_PATH")" != "$SOURCE_TREE_HASH" ]]; then
    UPDATE_FAILURE="Staged skill does not match the planned candidate release."
  elif [[ -n "$CURRENT_BACKUP_ROOT_SYMLINK" ]]; then
    UPDATE_FAILURE="Skill backup root became a symlink after planning: $BACKUP_ROOT"
  elif [[ -e "$BACKUP_ROOT" && ! -d "$BACKUP_ROOT" ]]; then
    UPDATE_FAILURE="Skill backup root is not a directory: $BACKUP_ROOT"
  elif [[ -e "$BACKUP_PATH" || -L "$BACKUP_PATH" ]]; then
    UPDATE_FAILURE="Backup path appeared after planning: $BACKUP_PATH"
  elif ! mkdir -p "$BACKUP_ROOT"; then
    UPDATE_FAILURE="Could not create the skill backup directory."
  elif ! mv "$SKILL_TARGET" "$BACKUP_PATH"; then
    UPDATE_FAILURE="Could not move the installed skill to its backup."
  else
    ORIGINAL_MOVED=true
    if [[ "$(tree_fingerprint "$BACKUP_PATH")" != "$TARGET_TREE_HASH" ]]; then
      UPDATE_FAILURE="Backup does not match the planned installed skill."
    elif [[ "${ACP_BOOTSTRAP_TEST_FAULT:-}" == "after-skill-backup" ||
      "${ACP_BOOTSTRAP_TEST_FAULT:-}" == "during-skill-restore" ]]; then
      UPDATE_FAILURE="Injected verification failure after skill backup."
    elif [[ "${ACP_BOOTSTRAP_TEST_FAULT:-}" == "target-appeared-before-activation" ]]; then
      if mkdir "$SKILL_TARGET" && printf 'foreign target must survive\n' > "$SKILL_TARGET/foreign-target.txt"; then
        UPDATE_FAILURE="Injected unexpected skill target before activation."
      else
        UPDATE_FAILURE="Could not inject the unexpected skill target."
      fi
    elif ! mv "$STAGE_PATH" "$SKILL_TARGET"; then
      UPDATE_FAILURE="Could not activate the staged skill."
    else
      CANDIDATE_ACTIVATED=true
      if [[ "$(tree_fingerprint "$SKILL_TARGET")" != "$SOURCE_TREE_HASH" ]]; then
        UPDATE_FAILURE="Installed skill does not match the planned candidate release."
      fi
    fi
  fi

  if [[ -n "$UPDATE_FAILURE" ]]; then
    RESTORE_STATUS="not-needed"
    RESTORE_FAILURE=""
    if [[ "$ORIGINAL_MOVED" == true ]]; then
      RESTORE_STATUS="failed"
      if [[ "${ACP_BOOTSTRAP_TEST_FAULT:-}" == "during-skill-restore" ]]; then
        RESTORE_FAILURE="Injected failure during automatic restore."
      else
        if [[ -e "$SKILL_TARGET" || -L "$SKILL_TARGET" ]]; then
          if [[ "$CANDIDATE_ACTIVATED" != true ]]; then
            RESTORE_FAILURE="Unexpected skill target appeared before activation; it was preserved."
          elif [[ -n "$(first_symlink "$SKILL_TARGET")" ]]; then
            RESTORE_FAILURE="Activated skill target contains a symlink; it was preserved."
          elif [[ "$(tree_fingerprint "$SKILL_TARGET")" != "$SOURCE_TREE_HASH" ]]; then
            RESTORE_FAILURE="Activated skill target changed after activation; it was preserved."
          elif ! rm -rf -- "$SKILL_TARGET"; then
            RESTORE_FAILURE="Could not remove the failed replacement."
          fi
        fi
        if [[ -z "$RESTORE_FAILURE" ]]; then
          if [[ ! -d "$BACKUP_PATH" ]]; then
            RESTORE_FAILURE="Recovery copy is missing: $BACKUP_PATH"
          elif mv "$BACKUP_PATH" "$SKILL_TARGET"; then
            RESTORE_STATUS="restored"
          else
            RESTORE_FAILURE="Could not move the recovery copy back into place."
          fi
        fi
      fi
    fi
    if [[ -e "$STAGE_PATH" || -L "$STAGE_PATH" ]]; then
      rm -rf -- "$STAGE_PATH"
    fi
    if [[ "$RESTORE_STATUS" == "not-needed" ]]; then
      echo "Skill update failed before the installed skill was replaced: $UPDATE_FAILURE" >&2
    elif [[ "$RESTORE_STATUS" == "restored" ]]; then
      echo "Skill update failed and the previous installation was restored: $UPDATE_FAILURE" >&2
    else
      echo "Skill update failed; automatic restore also failed. Recovery copy: $BACKUP_PATH. Update failure: $UPDATE_FAILURE Restore failure: $RESTORE_FAILURE" >&2
    fi
    exit 1
  fi

  echo
  echo "Update receipt:"
  echo "Status: applied"
  echo "Plan hash: $UPDATE_PLAN_HASH"
  echo "Installed version: $SOURCE_VERSION"
  echo "Previous version: $TARGET_VERSION"
  echo "Backup path: $BACKUP_PATH"
  echo "Restart required: true"
  exit 0
fi

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

import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import { basename, join } from "node:path";

import {
  inspectV1ConfigDocument,
  parseYamlSubset,
} from "./config.mjs";
import {
  likelySecretToken,
  validateProposalFrontmatter,
} from "./proposal.mjs";

const SCHEMA_VERSION = 1;
const MAX_MARKER_BYTES = 4_096;
const MAX_CONTEXT_UNITS = 64;
const MAX_RULE_MARKER_CANDIDATES = 512;
const MAX_PROPOSAL_FRONTMATTER_BYTES = 65_536;
const PROPOSAL_FRONTMATTER_READ_CHUNK_BYTES = 1_024;
const MAX_PROPOSALS_SCANNED = 512;
const MAX_ATTENTION_ITEMS = 3;
const NONTERMINAL_PROPOSAL_STATUSES = new Set([
  "pending_current_fix",
  "proposed",
  "approved",
]);
const TERMINAL_PROPOSAL_STATUSES = new Set([
  "rejected",
  "applied",
  "superseded",
  "archived",
]);
const PROPOSAL_STATUSES = new Set([
  ...NONTERMINAL_PROPOSAL_STATUSES,
  ...TERMINAL_PROPOSAL_STATUSES,
]);
const PROPOSAL_SCOPES = new Set(["workspace", "user-global"]);
const TASK_KEYS = [
  "schemaVersion",
  "operations",
  "paths",
  "tools",
  "skills",
  "domains",
  "risk",
  "requestedPacks",
];
const MATCH_KEYS = [
  "operations",
  "pathPrefixes",
  "pathBasenames",
  "tools",
  "skills",
  "domains",
  "risks",
];
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const PROPOSAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SIGNAL_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,127}$/u;
const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._#-]{0,191}$/u;
const CONTEXT_OPEN_PATTERN = /<!-- acp-context: ([^\r\n]*?) -->/gu;
const CONTEXT_CLOSE_MARKER = "<!-- /acp-context -->";
const RULE_CANDIDATE_IGNORABLE_PATTERN =
  /(?:\p{Default_Ignorable_Code_Point}|\p{Cc})/gu;
const RULE_CANDIDATE_LEADING_CHARACTER_PATTERN =
  /(?:\s|\p{Default_Ignorable_Code_Point}|\p{Cc})/u;
const RULE_CANDIDATE_GAP_CHARACTER_PATTERN =
  /(?:\p{Default_Ignorable_Code_Point}|\p{Cc})/u;
const ASCII_IDENTIFIER_CONTINUATION_PATTERN = /[A-Za-z0-9_]/u;
const CANONICAL_RULE_ID_PATTERN =
  /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})#([1-9][0-9]*)$/u;
const LEGACY_RULE_ID_PATTERN =
  /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})-([1-9][0-9]*)$/u;
const CANONICAL_RULE_MARKER_PATTERN =
  /^<!-- acp-rule: ([A-Za-z0-9][A-Za-z0-9._#-]{0,191}); source: ([A-Za-z0-9][A-Za-z0-9._-]{0,127}); subsumes: ([A-Za-z0-9,#._-]+) -->$/u;
const LEGACY_RULE_MARKER_PATTERN =
  /^<!-- acp-rule: id=([A-Za-z0-9][A-Za-z0-9._#-]{0,191}) source=([A-Za-z0-9][A-Za-z0-9._-]{0,127}) subsumes=([A-Za-z0-9,#._-]+) -->$/u;

/**
 * Compile the current Schema 1 default read set into one task-scoped payload.
 *
 * The compiler is deliberately read-only and meaning-free. It matches only a
 * structured task signature against explicit, co-located Markdown metadata.
 * Invalid or incomplete routing metadata falls back to the complete legacy
 * read set instead of silently omitting context.
 */
export async function compileWorkspaceContext(arguments_ = {}) {
  return compileWorkspaceContextAttempt(arguments_, 0);
}

async function compileWorkspaceContextAttempt(
  { workspaceRoot, taskSignature } = {},
  attempt,
) {
  const task = inspectTaskSignature(taskSignature);
  if (!task.value) {
    return blockedResult("invalid_task_signature", task.failures);
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    return blockedResult("invalid_workspace_root", ["invalid_workspace_root"]);
  }

  try {
    const contextRoot = join(workspaceRoot, ".agent-context");
    const topologyProblem = await inspectContextRoot(contextRoot);
    if (topologyProblem) {
      return blockedResult(topologyProblem, [topologyProblem]);
    }

    const configRead = await readContextFile(
      contextRoot,
      ".agent-context/config.yml",
    );
    if (configRead.problem) {
      return blockedResult(configRead.problem, [configRead.problem]);
    }
    const config = inspectV1ConfigDocument(
      configRead.source,
      ".agent-context/config.yml",
    );
    if (config.failures.length > 0) {
      return blockedResult("invalid_workspace_config", [
        "invalid_workspace_config",
      ]);
    }

    const unknownDomain = task.value.domains.find(
      (domain) => !config.value.enabled_domains.includes(domain),
    );
    if (unknownDomain) {
      return blockedResult("task_domain_not_enabled", [
        "task_domain_not_enabled",
      ]);
    }
    const routingTask = task.value.domains.length > 0
      ? task.value
      : {
          ...task.value,
          domains: [...config.value.enabled_domains].sort(),
        };

    const activeRead = await readActiveDocuments(
      contextRoot,
      config.value,
      task.value.domains,
    );
    if (activeRead.problem) {
      return blockedResult(activeRead.problem, [activeRead.problem]);
    }
    const catalogRead = sameStringSet(
      task.value.domains.length > 0
        ? task.value.domains
        : config.value.enabled_domains,
      config.value.enabled_domains,
    )
      ? activeRead
      : await readActiveDocuments(contextRoot, config.value, []);
    if (catalogRead.problem) {
      return blockedResult(catalogRead.problem, [catalogRead.problem]);
    }

    const parsedDocuments = [];
    const allUnits = [];
    const allRules = [];
    const routingFailures = [];
    let remainingRuleMarkerCandidates = MAX_RULE_MARKER_CANDIDATES;
    for (const document of catalogRead.documents) {
      const inspected = inspectContextDocument(document.source, document.path);
      const ruleInspection = inspectRuleMarkers(
        document.source,
        remainingRuleMarkerCandidates,
      );
      remainingRuleMarkerCandidates -= ruleInspection.candidateCount;
      const rules = ruleInspection.rules.map((rule) => ({
        ...rule,
        path: document.path,
      }));
      parsedDocuments.push({ ...document, inspected, rules });
      allUnits.push(...inspected.units);
      allRules.push(...rules);
      routingFailures.push(...inspected.failures);
      routingFailures.push(...ruleInspection.failures);
    }
    const relevantPaths = new Set(
      activeRead.documents.map(({ path }) => path),
    );

    const duplicateIds = duplicateUnitIds(allUnits);
    if (duplicateIds.length > 0) routingFailures.push("duplicate_context_id");
    const duplicateRuleIds = duplicateRuleIdentities(allRules);
    if (duplicateRuleIds.length > 0) {
      routingFailures.push("duplicate_rule_identity");
    }
    if (routingFailures.includes("unsafe_context_metadata")) {
      return blockedResult("unsafe_context_metadata", [
        "unsafe_context_metadata",
      ]);
    }
    if (routingFailures.includes("rule_marker_too_large")) {
      return blockedResult("rule_marker_too_large", [
        "rule_marker_too_large",
      ]);
    }
    if (routingFailures.includes("rule_marker_inspection_incomplete")) {
      return blockedResult("rule_marker_inspection_incomplete", [
        "rule_marker_inspection_incomplete",
      ]);
    }
    if (allUnits.length > MAX_CONTEXT_UNITS) {
      routingFailures.push("context_catalog_limit_exceeded");
    }

    const hasRoutingMetadata = allUnits.length > 0;
    const packIds = new Set(
      allUnits.filter(({ metadata }) => metadata.kind === "pack").map(({ metadata }) => metadata.id),
    );
    const unknownRequestedPack = task.value.requestedPacks.some(
      (packId) => !packIds.has(packId),
    );
    if (unknownRequestedPack) routingFailures.push("unknown_requested_pack");

    const safetyPacks = allUnits.filter(
      ({ metadata, path }) =>
        metadata.kind === "pack" &&
        metadata.priority === "safety" &&
        relevantPaths.has(path),
    );
    if (task.value.risk === "high" && safetyPacks.length === 0) {
      routingFailures.push("high_risk_safety_pack_missing");
    }

    const selections = routingFailures.length === 0
      ? selectPacks(allUnits, routingTask, relevantPaths)
      : [];
    const selectedPackIds = selections.map(({ id }) => id).sort();
    const selectedSet = new Set(selectedPackIds);
    const expandedPaths = new Set(relevantPaths);
    for (const { metadata, path } of allUnits) {
      if (
        metadata.kind === "pack" &&
        task.value.requestedPacks.includes(metadata.id)
      ) {
        expandedPaths.add(path);
      }
    }
    const fullPaths = new Set(expandedPaths);
    if (unknownRequestedPack && task.value.requestedPacks.length > 0) {
      for (const { path } of catalogRead.documents) fullPaths.add(path);
    }

    const progressiveDocuments = parsedDocuments
      .map((document) => ({
        path: document.path,
        content: renderProgressiveDocument(
          document.inspected,
          selectedSet,
          expandedPaths.has(document.path),
        ),
      }))
      .filter(({ content }) => content.trim() !== "");
    const fullDocuments = catalogRead.documents
      .filter(({ path }) => fullPaths.has(path))
      .map(({ path, source }) => ({
        path,
        content: source,
      }));

    const knownContextTargets = new Set();
    for (const unit of allUnits) {
      const target = `context:${unit.metadata.id}`;
      knownContextTargets.add(target);
    }
    for (const rule of allRules) {
      knownContextTargets.add(`rule:${rule.canonicalId}`);
    }

    const includedContextTargets = new Set();
    for (const unit of allUnits) {
      if (
        (unit.metadata.kind === "core" && expandedPaths.has(unit.path)) ||
        selectedSet.has(unit.metadata.id) ||
        ((routingFailures.length > 0 || !hasRoutingMetadata) &&
          fullPaths.has(unit.path))
      ) {
        includedContextTargets.add(`context:${unit.metadata.id}`);
      }
    }
    const useFullDocuments = routingFailures.length > 0 || !hasRoutingMetadata;
    for (const document of parsedDocuments) {
      if (useFullDocuments) {
        if (fullPaths.has(document.path)) {
          for (const rule of document.rules) {
            includedContextTargets.add(`rule:${rule.canonicalId}`);
          }
        }
        continue;
      }
      for (const rule of includedRulesForProgressiveDocument(
        document,
        selectedSet,
        expandedPaths.has(document.path),
      )) {
        includedContextTargets.add(`rule:${rule.canonicalId}`);
      }
    }

    const attentionRead = await inspectProposalAttention({
      contextRoot,
      knownContextTargets,
      includedContextTargets,
    });
    const warnings = [
      ...activeRead.warnings,
      ...catalogRead.warnings,
      ...attentionRead.warnings,
      ...new Set(routingFailures),
    ].sort();

    const attentionOverflow = attentionRead.matches.length > MAX_ATTENTION_ITEMS;
    if (attentionOverflow) warnings.push("attention_limit_exceeded");
    if (attentionRead.unroutedCount > 0) {
      warnings.push("unrouted_nonterminal_proposal");
    }
    const highRiskDanglingAttention =
      task.value.risk === "high" && attentionRead.danglingCount > 0;
    const highRiskAttentionOverflow =
      task.value.risk === "high" && attentionOverflow;
    const highRiskUnroutedAttention =
      task.value.risk === "high" && attentionRead.unroutedCount > 0;
    const highRiskIncompleteAttention =
      task.value.risk === "high" && attentionRead.incomplete;

    const fallback =
      routingFailures.length > 0 ||
      !hasRoutingMetadata ||
      highRiskDanglingAttention ||
      highRiskAttentionOverflow ||
      highRiskUnroutedAttention ||
      highRiskIncompleteAttention;
    const catalog = fallback
      ? []
      : buildCatalog(allUnits, selectedSet, expandedPaths);
    const attention = attentionRead.matches.slice(0, MAX_ATTENTION_ITEMS);
    const visibleDocuments = fallback ? fullDocuments : progressiveDocuments;
    const visibleCatalog = fallback ? [] : catalog;
    const content = renderContextBundle({
      documents: visibleDocuments,
      catalog: visibleCatalog,
      attention,
      mode: fallback ? "legacy_full" : "progressive",
      attentionOverflow,
      unroutedAttention: highRiskUnroutedAttention,
      danglingAttention: attentionRead.danglingCount > 0,
      incompleteAttention: attentionRead.incomplete,
    });
    const fullContent = renderContextBundle({
      documents: fullDocuments,
      catalog: [],
      attention,
      mode: "legacy_full",
      attentionOverflow,
      unroutedAttention: highRiskUnroutedAttention,
      danglingAttention: attentionRead.danglingCount > 0,
      incompleteAttention: attentionRead.incomplete,
    });
    const fullContextBytes = Buffer.byteLength(fullContent, "utf8");
    const modelVisibleBytes = Buffer.byteLength(content, "utf8");
    const savedBytes = fullContextBytes - modelVisibleBytes;

    const stable = await activeSnapshotStable({
      contextRoot,
      configSource: configRead.source,
      config: config.value,
      taskDomains: task.value.domains,
      activeRead,
      catalogRead,
      knownContextTargets,
      includedContextTargets,
      attentionRead,
    });
    if (!stable) {
      if (attempt === 0) {
        return compileWorkspaceContextAttempt({ workspaceRoot, taskSignature }, 1);
      }
      return blockedResult("active_context_unstable", [
        "active_context_unstable",
      ]);
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      status: fallback ? "fallback" : "compiled",
      mode: fallback ? "legacy_full" : "progressive",
      reason: fallback
        ? fallbackReason({
            routingFailures,
            hasRoutingMetadata,
            highRiskDanglingAttention,
            highRiskAttentionOverflow,
            highRiskUnroutedAttention,
            highRiskIncompleteAttention,
          })
        : "task_context_compiled",
      content,
      catalog: visibleCatalog,
      selectedPackIds: fallback ? [] : selectedPackIds,
      selections: fallback ? [] : selections,
      attention,
      metrics: {
        fullContextBytes,
        modelVisibleBytes,
        savedBytes,
        reductionBasisPoints:
          fullContextBytes === 0
            ? 0
            : Math.trunc((savedBytes * 10_000) / fullContextBytes),
      },
      warnings: [...new Set(warnings)].sort(),
    };
  } catch {
    return blockedResult("context_compilation_failed", [
      "context_compilation_failed",
    ]);
  }
}

export function inspectTaskSignature(taskSignature) {
  const failures = [];
  const expect = (condition, reason) => {
    if (!condition) failures.push(reason);
  };
  expect(isRecord(taskSignature), "task_signature_not_object");
  if (!isRecord(taskSignature)) return { failures };
  expect(exactKeys(taskSignature, TASK_KEYS), "task_signature_invalid_keys");
  expect(taskSignature.schemaVersion === SCHEMA_VERSION, "task_signature_schema_mismatch");
  expect(["normal", "high"].includes(taskSignature.risk), "task_signature_invalid_risk");

  for (const key of ["operations", "tools", "skills"]) {
    expect(validSignalList(taskSignature[key]), `task_signature_invalid_${key}`);
  }
  expect(validIdentifierList(taskSignature.domains), "task_signature_invalid_domains");
  expect(validIdentifierList(taskSignature.requestedPacks), "task_signature_invalid_requested_packs");
  expect(
    Array.isArray(taskSignature.paths) &&
      taskSignature.paths.length <= 64 &&
      taskSignature.paths.every(safeTaskPath) &&
      new Set(taskSignature.paths).size === taskSignature.paths.length,
    "task_signature_invalid_paths",
  );

  if (failures.length > 0) return { failures: [...new Set(failures)].sort() };
  return {
    failures: [],
    value: {
      schemaVersion: SCHEMA_VERSION,
      operations: [...taskSignature.operations].sort(),
      paths: [...taskSignature.paths].sort(),
      tools: [...taskSignature.tools].sort(),
      skills: [...taskSignature.skills].sort(),
      domains: [...taskSignature.domains].sort(),
      risk: taskSignature.risk,
      requestedPacks: [...taskSignature.requestedPacks].sort(),
    },
  };
}

function inspectContextDocument(source, path) {
  const units = [];
  const segments = [];
  const failures = [];
  let cursor = 0;
  let match;
  CONTEXT_OPEN_PATTERN.lastIndex = 0;

  while ((match = CONTEXT_OPEN_PATTERN.exec(source)) !== null) {
    const legacy = source.slice(cursor, match.index);
    if (legacy.includes(CONTEXT_CLOSE_MARKER)) {
      failures.push("orphan_context_close_marker");
    }
    segments.push({
      kind: "legacy",
      content: legacy,
      start: cursor,
      end: match.index,
    });

    const metadataSource = match[1];
    if (Buffer.byteLength(metadataSource, "utf8") > MAX_MARKER_BYTES) {
      failures.push("context_marker_too_large");
    }
    const contentStart = match.index + match[0].length;
    const closeIndex = source.indexOf(CONTEXT_CLOSE_MARKER, contentStart);
    if (closeIndex === -1) {
      failures.push("unclosed_context_block");
      segments.push({
        kind: "legacy",
        content: source.slice(match.index),
        start: match.index,
        end: source.length,
      });
      cursor = source.length;
      break;
    }
    const body = source.slice(contentStart, closeIndex);
    if (body.includes("<!-- acp-context:")) {
      failures.push("nested_context_block");
    }
    CONTEXT_OPEN_PATTERN.lastIndex = closeIndex + CONTEXT_CLOSE_MARKER.length;

    const metadata = inspectContextMetadata(metadataSource);
    if (!metadata.value) {
      failures.push(...metadata.failures);
      segments.push({
        kind: "invalid",
        content: source.slice(match.index, closeIndex + CONTEXT_CLOSE_MARKER.length),
        start: match.index,
        end: closeIndex + CONTEXT_CLOSE_MARKER.length,
      });
    } else if (body.trim() === "") {
      failures.push("empty_context_block");
      segments.push({
        kind: "invalid",
        content: source.slice(match.index, closeIndex + CONTEXT_CLOSE_MARKER.length),
        start: match.index,
        end: closeIndex + CONTEXT_CLOSE_MARKER.length,
      });
    } else {
      const unit = {
        metadata: metadata.value,
        path,
        content: body,
        completeSource: source.slice(
          match.index,
          closeIndex + CONTEXT_CLOSE_MARKER.length,
        ),
      };
      units.push(unit);
      segments.push({
        kind: "unit",
        unit,
        start: match.index,
        end: closeIndex + CONTEXT_CLOSE_MARKER.length,
      });
    }
    cursor = closeIndex + CONTEXT_CLOSE_MARKER.length;
  }

  const tail = source.slice(cursor);
  if (tail.includes(CONTEXT_CLOSE_MARKER)) {
    failures.push("orphan_context_close_marker");
  }
  segments.push({
    kind: "legacy",
    content: tail,
    start: cursor,
    end: source.length,
  });
  return {
    units,
    segments,
    failures: [...new Set(failures)].sort(),
  };
}

function inspectContextMetadata(source) {
  if (hasSecret(source)) {
    return { failures: ["unsafe_context_metadata"] };
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return { failures: ["invalid_context_marker_json"] };
  }
  if (hasSecret(JSON.stringify(value))) {
    return { failures: ["unsafe_context_metadata"] };
  }
  if (!isRecord(value)) return { failures: ["invalid_context_marker_shape"] };
  if (value.kind === "core") {
    if (!exactKeys(value, ["schemaVersion", "id", "kind", "description"])) {
      return { failures: ["invalid_core_context_keys"] };
    }
    if (
      value.schemaVersion !== SCHEMA_VERSION ||
      typeof value.id !== "string" ||
      !IDENTIFIER_PATTERN.test(value.id) ||
      !safeDescription(value.description)
    ) {
      return { failures: ["invalid_core_context_metadata"] };
    }
    return {
      failures: [],
      value: {
        schemaVersion: SCHEMA_VERSION,
        id: value.id,
        kind: "core",
        description: value.description,
      },
    };
  }
  if (value.kind !== "pack") {
    return { failures: ["unknown_context_kind"] };
  }
  if (
    !exactKeys(value, [
      "schemaVersion",
      "id",
      "kind",
      "description",
      "priority",
      "match",
    ]) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.id !== "string" ||
    !IDENTIFIER_PATTERN.test(value.id) ||
    !safeDescription(value.description) ||
    !["normal", "safety"].includes(value.priority)
  ) {
    return { failures: ["invalid_pack_context_metadata"] };
  }
  const match = inspectMatch(value.match);
  if (!match.value) return match;
  return {
    failures: [],
    value: {
      schemaVersion: SCHEMA_VERSION,
      id: value.id,
      kind: "pack",
      description: value.description,
      priority: value.priority,
      match: match.value,
    },
  };
}

function inspectMatch(value) {
  if (!isRecord(value)) return { failures: ["invalid_context_match"] };
  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    keys.some((key) => !MATCH_KEYS.includes(key))
  ) {
    return { failures: ["invalid_context_match"] };
  }
  const normalized = {};
  for (const key of MATCH_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const items = value[key];
    let valid;
    if (key === "pathPrefixes") valid = validPathPatternList(items, false);
    else if (key === "pathBasenames") valid = validPathPatternList(items, true);
    else if (key === "domains") valid = validIdentifierList(items, { nonEmpty: true });
    else if (key === "risks") {
      valid =
        Array.isArray(items) &&
        items.length > 0 &&
        items.length <= 2 &&
        items.every((item) => ["normal", "high"].includes(item)) &&
        new Set(items).size === items.length;
    } else valid = validSignalList(items, { nonEmpty: true });
    if (!valid) return { failures: ["invalid_context_match"] };
    normalized[key] = (
      key === "pathPrefixes"
        ? items.map((item) => item.replace(/\/+$/u, ""))
        : [...items]
    ).sort();
  }
  return { failures: [], value: normalized };
}

function selectPacks(units, task, relevantPaths) {
  const selections = [];
  for (const { metadata, path } of units) {
    if (metadata.kind !== "pack") continue;
    const reasons = [];
    if (task.requestedPacks.includes(metadata.id)) reasons.push("explicit_request");
    if (
      task.risk === "high" &&
      metadata.priority === "safety" &&
      relevantPaths.has(path)
    ) {
      reasons.push("high_risk_safety");
    }
    const matched = relevantPaths.has(path)
      ? matchTask(metadata.match, task)
      : { matched: false, reasons: [] };
    if (matched.matched) reasons.push(...matched.reasons);
    if (reasons.length > 0) {
      selections.push({ id: metadata.id, reasons: [...new Set(reasons)].sort() });
    }
  }
  return selections.sort((left, right) => compareCodeUnits(left.id, right.id));
}

function matchTask(match, task) {
  const reasons = [];
  for (const key of MATCH_KEYS) {
    if (!Object.hasOwn(match, key)) continue;
    let matched = false;
    if (key === "pathPrefixes") {
      matched = task.paths.some((path) =>
        match.pathPrefixes.some(
          (prefix) => path === prefix || path.startsWith(`${prefix}/`),
        ),
      );
    } else if (key === "pathBasenames") {
      matched = task.paths.some((path) =>
        match.pathBasenames.includes(basename(path)),
      );
    } else if (key === "risks") {
      matched = match.risks.includes(task.risk);
    } else {
      matched = task[key].some((value) => match[key].includes(value));
    }
    if (!matched) return { matched: false, reasons: [] };
    reasons.push(`matched_${camelToSnake(key)}`);
  }
  return { matched: true, reasons };
}

function buildCatalog(units, selectedSet, relevantPaths) {
  return units
    .map(({ metadata, path }) =>
      metadata.kind === "core"
        ? {
            id: metadata.id,
            kind: "core",
            description: metadata.description,
            priority: "core",
            match: null,
            source: path,
            selected: relevantPaths.has(path),
          }
        : {
            id: metadata.id,
            kind: "pack",
            description: metadata.description,
            priority: metadata.priority,
            match: metadata.match,
            source: path,
            selected: selectedSet.has(metadata.id),
          },
    )
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}

function renderProgressiveDocument(inspected, selectedSet, includeLegacy) {
  return inspected.segments
    .map((segment) => {
      if (!progressiveSegmentIncluded(segment, selectedSet, includeLegacy)) {
        return "";
      }
      return segment.kind === "unit"
        ? segment.unit.completeSource
        : segment.content;
    })
    .join("");
}

function includedRulesForProgressiveDocument(
  document,
  selectedSet,
  includeLegacy,
) {
  const included = [];
  let segmentIndex = 0;
  for (const rule of document.rules) {
    while (
      segmentIndex < document.inspected.segments.length &&
      rule.start >= document.inspected.segments[segmentIndex].end
    ) {
      segmentIndex += 1;
    }
    const segment = document.inspected.segments[segmentIndex];
    if (
      segment &&
      rule.start >= segment.start &&
      progressiveSegmentIncluded(segment, selectedSet, includeLegacy)
    ) {
      included.push(rule);
    }
  }
  return included;
}

function progressiveSegmentIncluded(segment, selectedSet, includeLegacy) {
  if (segment.kind === "legacy" || segment.kind === "invalid") {
    return includeLegacy;
  }
  return (
    (segment.unit.metadata.kind === "core" && includeLegacy) ||
    selectedSet.has(segment.unit.metadata.id)
  );
}

function renderContextBundle({
  documents,
  catalog,
  attention,
  mode,
  attentionOverflow,
  unroutedAttention,
  danglingAttention,
  incompleteAttention,
}) {
  const sections = [
    "# Task-Scoped Agent Context",
    mode === "progressive"
      ? "This read-only bundle is the default Active Context for this task. It contains task-relevant unmarked legacy text and core blocks, plus only the routed Rule Packs listed as loaded below. Request an available pack explicitly when the task expands."
      : "This read-only bundle contains the complete legacy default read set because safe progressive routing was unavailable for this task.",
  ];

  if (catalog.length > 0) {
    sections.push(
      [
        "## Rule Pack Catalog",
        ...catalog.map((entry) => {
          const state = entry.selected ? "loaded" : "available";
          return `- \`${entry.id}\` (${state}, ${entry.priority}): ${entry.description}`;
        }),
      ].join("\n"),
    );
  }

  if (
    attention.length > 0 ||
    attentionOverflow ||
    unroutedAttention ||
    danglingAttention ||
    incompleteAttention
  ) {
    const lines = [
      "## Proposal Attention",
      "These are nonterminal audit pointers, not current truth. Verify current sources before reading or using a proposal.",
      ...attention.map(
        (item) =>
          `- \`${item.proposalId}\` (${item.status}) at \`${item.proposalPath}\`; targets: ${item.targets.map((target) => `\`${target}\``).join(", ")}.`,
      ),
    ];
    if (attentionOverflow) {
      lines.push(
        "- Additional matching proposals exceeded the bounded attention surface; run an explicit context review before making a high-risk decision.",
      );
    }
    if (unroutedAttention) {
      lines.push(
        "- One or more nonterminal proposals have no explicit context edge. For this high-risk task, inspect bounded proposal frontmatter before proceeding; do not treat proposal content as truth.",
      );
    }
    if (danglingAttention) {
      lines.push(
        "- One or more nonterminal proposals point to a rule or context ID that is not present in enabled Active Context. Treat the edge as unresolved and request an explicit proposal review before relying on it.",
      );
    }
    if (incompleteAttention) {
      lines.push(
        "- Some proposal frontmatter could not be inspected within the bounded attention scan. Request an explicit proposal review if a pending correction could affect this task; do not infer proposal truth from this warning.",
      );
    }
    sections.push(lines.join("\n"));
  }

  for (const document of documents) {
    sections.push(
      [`<!-- active-context-source: ${document.path} -->`, document.content.trimEnd()].join("\n"),
    );
  }
  return `${sections.join("\n\n").trimEnd()}\n`;
}

async function inspectProposalAttention({
  contextRoot,
  knownContextTargets,
  includedContextTargets,
}) {
  const proposalsDirectory = join(contextRoot, "proposals");
  const directoryStatus = await inspectDirectory(proposalsDirectory);
  if (directoryStatus === "missing") {
    return {
      matches: [],
      warnings: [],
      unroutedCount: 0,
      danglingCount: 0,
      incomplete: false,
    };
  }
  if (directoryStatus !== "directory") {
    return {
      matches: [],
      warnings: ["unsafe_proposals_topology"],
      unroutedCount: 0,
      danglingCount: 0,
      incomplete: true,
    };
  }

  const entries = (await readdir(proposalsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.name !== "README.md" && entry.name.endsWith(".md"))
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  const warnings = [];
  let incomplete = false;
  let globallyIncomplete = false;
  if (entries.length > MAX_PROPOSALS_SCANNED) {
    warnings.push("proposal_scan_limit_reached");
    incomplete = true;
    globallyIncomplete = true;
  }
  const matches = [];
  const seenProposalIds = new Set();
  const duplicateProposalIds = new Set();
  const invalidComparableProposalIds = new Set();
  let unroutedCount = 0;
  let danglingCount = 0;
  for (const entry of entries.slice(0, MAX_PROPOSALS_SCANNED)) {
    if (!entry.isFile() || !safeProposalFilename(entry.name)) {
      warnings.push("unsafe_proposal_entry");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    const proposalSegments = ["proposals", entry.name];
    if (await inspectContextParents(contextRoot, proposalSegments)) {
      warnings.push("unsafe_proposal_entry");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    const path = join(proposalsDirectory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      warnings.push("unsafe_proposal_entry");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    const frontmatter = await readFrontmatter(path, entry.name, stat);
    if (await inspectContextParents(contextRoot, proposalSegments)) {
      warnings.push("unsafe_proposal_entry");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    if (!frontmatter.value) {
      warnings.push(frontmatter.reason);
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    const data = frontmatter.value;
    if (data.schema_version !== SCHEMA_VERSION) {
      warnings.push("invalid_attention_proposal_schema");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    if (
      typeof data.id !== "string" ||
      !PROPOSAL_ID_PATTERN.test(data.id) ||
      hasSecret(data.id)
    ) {
      if (
        data.id === null ||
        ["number", "boolean"].includes(typeof data.id)
      ) {
        const comparableId = data.id === null
          ? "null"
          : typeof data.id === "boolean"
            ? String(data.id)
            : Number.isSafeInteger(data.id) &&
                data.id >= 0 &&
                !Object.is(data.id, -0)
              ? String(data.id)
              : undefined;
        if (comparableId && PROPOSAL_ID_PATTERN.test(comparableId)) {
          invalidComparableProposalIds.add(comparableId);
          if (seenProposalIds.has(comparableId)) {
            duplicateProposalIds.add(comparableId);
            warnings.push("duplicate_attention_proposal_id");
          }
        }
      }
      warnings.push("invalid_attention_proposal_id");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    if (invalidComparableProposalIds.has(data.id)) {
      duplicateProposalIds.add(data.id);
      warnings.push("duplicate_attention_proposal_id");
      incomplete = true;
    }
    if (seenProposalIds.has(data.id)) {
      duplicateProposalIds.add(data.id);
      warnings.push("duplicate_attention_proposal_id");
      incomplete = true;
    }
    seenProposalIds.add(data.id);
    if (!PROPOSAL_STATUSES.has(data.status)) {
      warnings.push("invalid_attention_proposal_status");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    if (!PROPOSAL_SCOPES.has(data.scope)) {
      warnings.push("invalid_attention_proposal_scope");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    if (!NONTERMINAL_PROPOSAL_STATUSES.has(data.status)) continue;
    if (data.scope !== "workspace") continue;
    const targets = data.attention_targets === undefined
      ? undefined
      : inspectAttentionTargets(data.attention_targets);
    if (data.attention_targets !== undefined && !targets) {
      warnings.push("invalid_attention_targets");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    if (validateProposalFrontmatter(data, `${entry.name} frontmatter`).length > 0) {
      warnings.push("invalid_attention_proposal_frontmatter");
      incomplete = true;
      globallyIncomplete = true;
      continue;
    }
    if (data.attention_targets === undefined) {
      unroutedCount += 1;
      continue;
    }
    const normalizedTargets = targets.map(normalizeAttentionTarget);
    const danglingTargets = targets.filter((_, index) =>
      !knownContextTargets.has(normalizedTargets[index]),
    );
    if (danglingTargets.length > 0) {
      warnings.push("dangling_attention_target");
      danglingCount += 1;
    }
    const knownTargetIdentities = normalizedTargets.filter(
      (target) => target !== undefined,
    );
    if (new Set(knownTargetIdentities).size !== knownTargetIdentities.length) {
      warnings.push("duplicate_attention_target_identity");
      incomplete = true;
      continue;
    }
    const relevantTargets = targets.filter((_, index) =>
      includedContextTargets.has(normalizedTargets[index]),
    );
    if (relevantTargets.length === 0) continue;
    matches.push({
      proposalId: data.id,
      proposalPath: `.agent-context/proposals/${entry.name}`,
      status: data.status,
      targets: relevantTargets.sort(),
      reason: "nonterminal_proposal_attention",
    });
  }
  return {
    matches: (globallyIncomplete ? [] : matches)
      .filter(
        ({ proposalId }) =>
          !duplicateProposalIds.has(proposalId) &&
          !invalidComparableProposalIds.has(proposalId),
      )
      .sort(compareAttention),
    warnings: [...new Set(warnings)].sort(),
    unroutedCount,
    danglingCount,
    incomplete,
  };
}

async function readActiveDocuments(contextRoot, config, taskDomains) {
  const activeDomains = [
    ...(taskDomains.length > 0 ? taskDomains : config.enabled_domains),
  ].sort();
  const paths = [
    ".agent-context/PROJECT_CONTEXT_INDEX.md",
    ".agent-context/PROJECT_PROFILE.md",
    ...activeDomains.map(
      (domain) => `.agent-context/checklists/${domain}.md`,
    ),
  ];
  const documents = [];
  const warnings = [];
  for (const path of paths) {
    const result = await readContextFile(contextRoot, path);
    if (result.problem) {
      if (path.includes("/checklists/") && result.problem === "active_context_file_missing") {
        return { problem: "enabled_checklist_missing", documents: [], warnings };
      }
      return { problem: result.problem, documents: [], warnings };
    }
    documents.push({ path, source: result.source });
  }
  return { documents, warnings };
}

async function activeSnapshotStable({
  contextRoot,
  configSource,
  config,
  taskDomains,
  activeRead,
  catalogRead,
  knownContextTargets,
  includedContextTargets,
  attentionRead,
}) {
  const nextConfig = await readContextFile(
    contextRoot,
    ".agent-context/config.yml",
  );
  if (nextConfig.problem || nextConfig.source !== configSource) return false;
  const nextActiveRead = await readActiveDocuments(
    contextRoot,
    config,
    taskDomains,
  );
  if (nextActiveRead.problem) return false;
  if (
    JSON.stringify(nextActiveRead.documents) !==
      JSON.stringify(activeRead.documents) ||
    JSON.stringify(nextActiveRead.warnings) !== JSON.stringify(activeRead.warnings)
  ) {
    return false;
  }
  const nextCatalogRead = await readActiveDocuments(contextRoot, config, []);
  if (nextCatalogRead.problem) return false;
  if (
    JSON.stringify(nextCatalogRead.documents) !==
      JSON.stringify(catalogRead.documents) ||
    JSON.stringify(nextCatalogRead.warnings) !==
      JSON.stringify(catalogRead.warnings)
  ) {
    return false;
  }
  const nextAttention = await inspectProposalAttention({
    contextRoot,
    knownContextTargets,
    includedContextTargets,
  });
  return (
    JSON.stringify(nextAttention.matches) ===
      JSON.stringify(attentionRead.matches) &&
    JSON.stringify(nextAttention.warnings) ===
      JSON.stringify(attentionRead.warnings) &&
    nextAttention.unroutedCount === attentionRead.unroutedCount &&
    nextAttention.danglingCount === attentionRead.danglingCount &&
    nextAttention.incomplete === attentionRead.incomplete
  );
}

async function readContextFile(contextRoot, relativePath) {
  const contextRelative = relativePath.replace(/^\.agent-context\//u, "");
  const segments = contextRelative.split("/");
  const parentProblem = await inspectContextParents(contextRoot, segments);
  if (parentProblem) return { problem: parentProblem };
  const path = join(contextRoot, ...segments);
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return { problem: "active_context_file_missing" };
    return { problem: "active_context_read_failed" };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { problem: "unsafe_context_topology" };
  }
  let handle;
  let bytes;
  try {
    handle = await open(path, "r");
    const openedStat = await handle.stat();
    if (!sameFileIdentity(stat, openedStat) || !openedStat.isFile()) {
      return { problem: "unsafe_context_topology" };
    }
    bytes = await handle.readFile();
    if (
      (await inspectContextParents(contextRoot, segments)) ||
      !(await pathStillMatchesFile(path, openedStat))
    ) {
      return { problem: "unsafe_context_topology" };
    }
  } catch {
    return { problem: "active_context_read_failed" };
  } finally {
    await handle?.close();
  }
  try {
    return { source: decodeUtf8(bytes) };
  } catch {
    return { problem: "invalid_active_context_encoding" };
  }
}

async function inspectContextParents(contextRoot, segments) {
  let current = contextRoot;
  const parents = [current];
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    parents.push(current);
  }
  for (const parent of parents) {
    try {
      const stat = await lstat(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        return "unsafe_context_topology";
      }
    } catch (error) {
      return error?.code === "ENOENT"
        ? "active_context_file_missing"
        : "active_context_read_failed";
    }
  }
  return undefined;
}

async function readFrontmatter(path, label, expectedStat) {
  let handle;
  try {
    handle = await open(path, "r");
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || !sameFileIdentity(expectedStat, openedStat)) {
      return { reason: "unsafe_proposal_entry" };
    }
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const openings = [
      Buffer.from("---\n", "utf8"),
      Buffer.from("---\r\n", "utf8"),
      Buffer.concat([bom, Buffer.from("---\n", "utf8")]),
      Buffer.concat([bom, Buffer.from("---\r\n", "utf8")]),
    ];
    const closings = [
      Buffer.from("\n---\n", "utf8"),
      Buffer.from("\r\n---\r\n", "utf8"),
    ];
    const chunks = [];
    let bytesReadTotal = 0;
    let openingLength;

    while (bytesReadTotal < MAX_PROPOSAL_FRONTMATTER_BYTES) {
      const readLength = Math.min(
        PROPOSAL_FRONTMATTER_READ_CHUNK_BYTES,
        MAX_PROPOSAL_FRONTMATTER_BYTES - bytesReadTotal,
      );
      const chunk = Buffer.alloc(readLength);
      const { bytesRead } = await handle.read(
        chunk,
        0,
        readLength,
        bytesReadTotal,
      );
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      bytesReadTotal += bytesRead;

      const prefix = Buffer.concat(chunks, bytesReadTotal);
      if (openingLength === undefined) {
        const opening = openings.find(
          (candidate) =>
            prefix.length >= candidate.length &&
            prefix.subarray(0, candidate.length).equals(candidate),
        );
        if (opening) openingLength = opening.length;
        else if (prefix.length >= Math.max(...openings.map(({ length }) => length))) {
          return { reason: "invalid_proposal_frontmatter" };
        } else {
          continue;
        }
      }
      const end = closings
        .map((closing) => prefix.indexOf(closing, openingLength))
        .filter((index) => index !== -1)
        .sort((left, right) => left - right)[0];
      if (end !== -1) {
        const source = decodeUtf8(
          prefix.subarray(openingLength, end),
        ).replaceAll("\r\n", "\n");
        if (!(await pathStillMatchesFile(path, openedStat))) {
          return { reason: "unsafe_proposal_entry" };
        }
        return {
          value: parseYamlSubset(source, `${label} frontmatter`),
        };
      }
    }
    return {
      reason:
        bytesReadTotal >= MAX_PROPOSAL_FRONTMATTER_BYTES
          ? "proposal_frontmatter_too_large"
          : "invalid_proposal_frontmatter",
    };
  } catch {
    return { reason: "invalid_proposal_frontmatter" };
  } finally {
    await handle?.close();
  }
}

async function pathStillMatchesFile(path, openedStat) {
  try {
    const currentStat = await lstat(path);
    return (
      !currentStat.isSymbolicLink() &&
      currentStat.isFile() &&
      sameFileIdentity(currentStat, openedStat)
    );
  } catch {
    return false;
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function inspectContextRoot(contextRoot) {
  try {
    const stat = await lstat(contextRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return "unsafe_context_topology";
    }
    return undefined;
  } catch (error) {
    return error?.code === "ENOENT"
      ? "workspace_context_missing"
      : "active_context_read_failed";
  }
}

async function inspectDirectory(path) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return "unsafe";
    return stat.isDirectory() ? "directory" : "other";
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "unsafe";
  }
}

function inspectAttentionTargets(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 16 ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  for (const target of value) {
    if (typeof target !== "string" || target.length > 220 || hasSecret(target)) {
      return undefined;
    }
    if (target.startsWith("context:")) {
      if (!IDENTIFIER_PATTERN.test(target.slice("context:".length))) return undefined;
    } else if (target.startsWith("rule:")) {
      if (normalizeAttentionTarget(target) === undefined) return undefined;
    } else {
      return undefined;
    }
  }
  return [...value].sort();
}

function normalizeAttentionTarget(target) {
  if (target.startsWith("context:")) return target;
  if (!target.startsWith("rule:")) return undefined;
  const identity = canonicalRuleIdentity(target.slice("rule:".length), {
    legacy: true,
  });
  return identity === undefined ? undefined : `rule:${identity}`;
}

function compareAttention(left, right) {
  const statusPriority = {
    pending_current_fix: 0,
    approved: 1,
    proposed: 2,
  };
  return (
    statusPriority[left.status] - statusPriority[right.status] ||
    compareCodeUnits(left.proposalId, right.proposalId)
  );
}

function duplicateUnitIds(units) {
  const seen = new Set();
  const duplicates = new Set();
  for (const { metadata } of units) {
    if (seen.has(metadata.id)) duplicates.add(metadata.id);
    seen.add(metadata.id);
  }
  return [...duplicates].sort();
}

function duplicateRuleIdentities(rules) {
  const seen = new Set();
  const duplicates = new Set();
  for (const { canonicalId } of rules) {
    if (seen.has(canonicalId)) duplicates.add(canonicalId);
    seen.add(canonicalId);
  }
  return [...duplicates].sort(compareCodeUnits);
}

function sameStringSet(left, right) {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function inspectRuleMarkers(source, maximumCandidates = MAX_RULE_MARKER_CANDIDATES) {
  const rules = [];
  const failures = [];
  const candidates = ruleMarkerCandidates(source, maximumCandidates);
  for (const candidate of candidates) {
    if (candidate.inspectionIncomplete) {
      failures.push("rule_marker_inspection_incomplete");
      continue;
    }
    const marker = candidate.source;
    if (hasSecret(marker) || hasSecret(candidate.normalizedSource)) {
      failures.push("unsafe_context_metadata");
      continue;
    }
    if (candidate.oversized || Buffer.byteLength(marker, "utf8") > MAX_MARKER_BYTES) {
      failures.push("rule_marker_too_large");
      continue;
    }
    if (!candidate.closed) {
      failures.push("unclosed_rule_marker");
      continue;
    }
    if (!candidate.standalone) {
      failures.push("invalid_rule_marker");
      continue;
    }

    const canonical = CANONICAL_RULE_MARKER_PATTERN.exec(marker);
    const legacy = canonical ? undefined : LEGACY_RULE_MARKER_PATTERN.exec(marker);
    const match = canonical ?? legacy;
    if (!match) {
      failures.push("invalid_rule_marker");
      continue;
    }

    const [id, sourceId, subsumes] = match.slice(1, 4);
    const delimiter = canonical ? "#" : "-";
    const prefix = `${sourceId}${delimiter}`;
    const ordinal = id.startsWith(prefix) ? id.slice(prefix.length) : "";
    if (!/^[1-9][0-9]*$/u.test(ordinal)) {
      failures.push("invalid_rule_marker");
      continue;
    }

    const canonicalId = `${sourceId}#${ordinal}`;
    const legacyId = `${sourceId}-${ordinal}`;
    if (
      !RULE_ID_PATTERN.test(canonicalId) ||
      !RULE_ID_PATTERN.test(legacyId) ||
      !validRuleSubsumes(subsumes, { legacy: Boolean(legacy) })
    ) {
      failures.push("invalid_rule_marker");
      continue;
    }
    rules.push({ canonicalId, start: candidate.start });
  }
  return {
    rules,
    failures: [...new Set(failures)].sort(),
    candidateCount: candidates.filter(
      ({ inspectionIncomplete }) => !inspectionIncomplete,
    ).length,
  };
}

function validRuleSubsumes(value, { legacy }) {
  if (value === "none") return true;
  const identities = value.split(",").map((ruleId) =>
    canonicalRuleIdentity(ruleId, { legacy }),
  );
  return (
    identities.every((identity) => identity !== undefined) &&
    new Set(identities).size === identities.length
  );
}

function canonicalRuleIdentity(value, { legacy }) {
  const canonical = CANONICAL_RULE_ID_PATTERN.exec(value);
  if (canonical) {
    const identity = `${canonical[1]}#${canonical[2]}`;
    return RULE_ID_PATTERN.test(identity) ? identity : undefined;
  }
  if (!legacy) return undefined;
  const historical = LEGACY_RULE_ID_PATTERN.exec(value);
  if (!historical) return undefined;
  const identity = `${historical[1]}#${historical[2]}`;
  return RULE_ID_PATTERN.test(identity) ? identity : undefined;
}

function ruleMarkerCandidates(source, maximumCandidates) {
  const candidates = [];
  let searchOffset = 0;
  while (searchOffset < source.length) {
    const commentStart = source.indexOf("<!--", searchOffset);
    if (commentStart === -1) break;
    searchOffset = commentStart + 4;
    if (!isRuleMarkerCandidateAt(source, commentStart + 4)) continue;
    if (candidates.length >= maximumCandidates) {
      candidates.push({ inspectionIncomplete: true });
      return candidates;
    }

    const boundedEnd = Math.min(
      source.length,
      commentStart + MAX_MARKER_BYTES + 3,
    );
    const boundedSource = source.slice(commentStart, boundedEnd);
    const boundedClose = boundedSource.indexOf("-->", 4);
    const closed = boundedClose !== -1;
    const oversized = !closed && boundedEnd < source.length;
    const commentEnd = closed
      ? commentStart + boundedClose + 3
      : boundedEnd;
    const commentSource = source.slice(commentStart, commentEnd);
    const normalizedSource = commentSource.replace(
      RULE_CANDIDATE_IGNORABLE_PATTERN,
      "",
    );
    if (oversized) {
      candidates.push({
        start: commentStart,
        source: commentSource,
        normalizedSource,
        closed: false,
        oversized: true,
        standalone: false,
      });
      return candidates;
    }
    const previousLineBreak = Math.max(
      source.lastIndexOf("\n", commentStart - 1),
      source.lastIndexOf("\r", commentStart - 1),
    );
    const nextLineBreaks = [
      source.indexOf("\n", commentEnd),
      source.indexOf("\r", commentEnd),
    ].filter((index) => index !== -1);
    const lineStart = previousLineBreak + 1;
    const lineEnd =
      nextLineBreaks.length === 0 ? source.length : Math.min(...nextLineBreaks);
    const line = source.slice(lineStart, lineEnd);
    candidates.push({
      start: commentStart,
      source: commentSource,
      normalizedSource,
      closed,
      oversized: false,
      standalone:
        closed && !/[\r\n]/u.test(commentSource) && line.trim() === commentSource,
    });
  }
  return candidates;
}

function isRuleMarkerCandidateAt(source, initialOffset) {
  let offset = consumeRuleCandidateCharacters(
    source,
    initialOffset,
    RULE_CANDIDATE_LEADING_CHARACTER_PATTERN,
  );
  for (const expected of "acp-rule") {
    offset = consumeRuleCandidateCharacters(
      source,
      offset,
      RULE_CANDIDATE_GAP_CHARACTER_PATTERN,
    );
    if (source[offset]?.toLowerCase() !== expected) return false;
    offset += 1;
  }
  offset = consumeRuleCandidateCharacters(
    source,
    offset,
    RULE_CANDIDATE_GAP_CHARACTER_PATTERN,
  );
  const next = codePointCharacterAt(source, offset);
  return next === undefined || !ASCII_IDENTIFIER_CONTINUATION_PATTERN.test(next);
}

function consumeRuleCandidateCharacters(source, initialOffset, pattern) {
  let offset = initialOffset;
  while (offset < source.length) {
    const character = codePointCharacterAt(source, offset);
    if (!pattern.test(character)) break;
    offset += character.length;
  }
  return offset;
}

function codePointCharacterAt(source, offset) {
  const codePoint = source.codePointAt(offset);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function fallbackReason({
  routingFailures,
  hasRoutingMetadata,
  highRiskDanglingAttention,
  highRiskAttentionOverflow,
  highRiskUnroutedAttention,
  highRiskIncompleteAttention,
}) {
  if (highRiskDanglingAttention) {
    return "high_risk_dangling_attention_target";
  }
  if (highRiskAttentionOverflow) return "high_risk_attention_overflow";
  if (highRiskUnroutedAttention) return "high_risk_unrouted_attention";
  if (highRiskIncompleteAttention) return "high_risk_attention_scan_incomplete";
  if (routingFailures.length > 0) return "invalid_routing_metadata";
  if (!hasRoutingMetadata) return "routing_metadata_absent";
  return "legacy_fallback_required";
}

function blockedResult(reason, warnings) {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "blocked",
    mode: "none",
    reason,
    content: "",
    catalog: [],
    selectedPackIds: [],
    selections: [],
    attention: [],
    metrics: {
      fullContextBytes: 0,
      modelVisibleBytes: 0,
      savedBytes: 0,
      reductionBasisPoints: 0,
    },
    warnings: [...new Set(warnings)].sort(),
  };
}

function exactKeys(value, expected) {
  return (
    isRecord(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function validSignalList(value, { nonEmpty = false } = {}) {
  return (
    Array.isArray(value) &&
    (!nonEmpty || value.length > 0) &&
    value.length <= 32 &&
    value.every(
      (item) => typeof item === "string" && SIGNAL_PATTERN.test(item) && !hasSecret(item),
    ) &&
    new Set(value).size === value.length
  );
}

function validIdentifierList(value, { nonEmpty = false } = {}) {
  return (
    Array.isArray(value) &&
    (!nonEmpty || value.length > 0) &&
    value.length <= 32 &&
    value.every(
      (item) => typeof item === "string" && IDENTIFIER_PATTERN.test(item) && !hasSecret(item),
    ) &&
    new Set(value).size === value.length
  );
}

function validPathPatternList(value, basenameOnly) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 32 &&
    value.every((item) =>
      basenameOnly
        ? typeof item === "string" &&
          !item.includes("/") &&
          safeTaskPath(item)
        : safePathPrefix(item),
    ) &&
    new Set(value).size === value.length
  );
}

function safePathPrefix(value) {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\/+$/u, "");
  return normalized !== "" && safeTaskPath(normalized);
}

function safeTaskPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/u.test(value) &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    /^[\p{L}\p{N}._/@+-]+$/u.test(value) &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    !hasSecret(value)
  );
}

function safeDescription(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !value.includes("<!--") &&
    !value.includes("-->") &&
    !hasSecret(value)
  );
}

function safeProposalFilename(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.md$/u.test(value) && !hasSecret(value);
}

function hasSecret(value) {
  return likelySecretToken(value);
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const DEFAULT_REPOSITORY = "Cherwayway/agent-context-patch";

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const repository = options.repo ?? DEFAULT_REPOSITORY;
validateRepositoryName(repository);
const input = options.input
  ? JSON.parse(readFileSync(resolve(options.input), "utf8"))
  : captureFromGitHub(repository);
const experiment = JSON.parse(
  readFileSync(resolve(options.experiment ?? "docs/launch/experiment.json"), "utf8"),
);
const evidence = options.evidence
  ? JSON.parse(readFileSync(resolve(options.evidence), "utf8"))
  : null;
const snapshot = buildSnapshot(input, experiment, evidence);
const outputPath = resolve(
  options.output ??
    join(
      ".artifacts",
      "discovery",
      `${snapshot.capturedAt.replaceAll(":", "-")}.json`,
    ),
);

writeJsonAtomically(outputPath, snapshot);
console.log(outputPath);

function captureFromGitHub(repo) {
  return {
    capturedAt: new Date().toISOString(),
    repo,
    views: runGh(["api", `repos/${repo}/traffic/views?per=day`]),
    clones: runGh(["api", `repos/${repo}/traffic/clones?per=day`]),
    referrers: runGh(["api", `repos/${repo}/traffic/popular/referrers`]),
    repository: runGh([
      "repo",
      "view",
      repo,
      "--json",
      "description,forkCount,homepageUrl,stargazerCount,watchers",
    ]),
  };
}

function buildSnapshot(input, experimentInput, evidenceInput) {
  requireObject(input, "snapshot input");
  requireObject(input.views, "views response");
  requireObject(input.clones, "clones response");
  requireObject(input.repository, "repository response");
  if (!Array.isArray(input.referrers)) {
    throw new Error("referrers response must be an array");
  }

  const capturedAt = new Date(input.capturedAt);
  if (Number.isNaN(capturedAt.valueOf())) {
    throw new Error("capturedAt must be an ISO timestamp");
  }
  validateRepositoryName(input.repo);

  const dailyViews = requireSeries(input.views.views, "views.views");
  const dailyClones = requireSeries(input.clones.clones, "clones.clones");
  const timestamps = [...dailyViews, ...dailyClones]
    .map(({ timestamp }) => timestamp)
    .sort();
  const windowStart = timestamps[0] ?? null;
  const windowEndExclusive = timestamps.length > 0
    ? new Date(Date.parse(timestamps.at(-1)) + 24 * 60 * 60 * 1000).toISOString()
    : null;

  const reportedUniqueVisitors = requireNonNegativeInteger(
    input.views.uniques,
    "views.uniques",
  );
  const experimentPlan = normalizeExperiment(experimentInput);
  const experimentEvidence = normalizeEvidence(
    evidenceInput,
    experimentPlan,
    reportedUniqueVisitors,
    { capturedAt, windowStart, windowEndExclusive },
  );

  return {
    schemaVersion: 1,
    capturedAt: capturedAt.toISOString(),
    repo: input.repo,
    window: {
      timezone: "UTC",
      start: windowStart,
      endExclusive: windowEndExclusive,
    },
    webTraffic: {
      views: requireNonNegativeInteger(input.views.count, "views.count"),
      reportedUniqueVisitors,
      referrers: input.referrers.map(normalizeReferrer),
    },
    repositorySignals: {
      stars: requireNonNegativeInteger(
        input.repository.stargazerCount,
        "repository.stargazerCount",
      ),
      forks: requireNonNegativeInteger(
        input.repository.forkCount,
        "repository.forkCount",
      ),
      watchers: requireNonNegativeInteger(
        input.repository.watchers?.totalCount,
        "repository.watchers.totalCount",
      ),
      description: input.repository.description ?? null,
      homepage: input.repository.homepageUrl || null,
    },
    diagnosticOnly: {
      clones: {
        count: requireNonNegativeInteger(input.clones.count, "clones.count"),
        reportedUniqueCloners: requireNonNegativeInteger(
          input.clones.uniques,
          "clones.uniques",
        ),
      },
    },
    daily: {
      views: dailyViews,
      clones: dailyClones,
    },
    experiment: {
      id: experimentPlan.id,
      targetKitVersion: experimentPlan.targetKitVersion,
      startsAt: experimentPlan.startsAt,
      endsAt: experimentPlan.endsAt,
      durationDays: experimentPlan.durationDays,
      channels: experimentPlan.channels,
      thresholds: experimentPlan.thresholds,
    },
    experimentEvidence,
    measurementPolicy: {
      clonesArePeople: false,
      primaryKpis: [
        "externalUniqueVisitors",
        "validActivations",
        "realEvolutions",
        "reuseEvidence",
      ],
      limitations: [
        "GitHub traffic is a rolling 14-day UTC window.",
        "GitHub does not expose visitor or cloner identities.",
        "CI, bots, IDEs, and Agents can create clone activity without a repository page visit.",
        "External classification requires known-team exclusions plus explicit user evidence.",
      ],
    },
  };
}

function normalizeExperiment(value) {
  requireObject(value, "experiment");
  if (value.schemaVersion !== 1) {
    throw new Error("experiment.schemaVersion must be 1");
  }
  requireNonEmptyString(value.id, "experiment.id");
  requireNonEmptyString(value.targetKitVersion, "experiment.targetKitVersion");
  requirePositiveInteger(value.durationDays, "experiment.durationDays");
  let startsAt = null;
  let endsAt = null;
  if (value.startsAt !== null) {
    startsAt = new Date(value.startsAt);
    if (Number.isNaN(startsAt.valueOf())) {
      throw new Error("experiment.startsAt must be null or an ISO timestamp");
    }
    endsAt = new Date(startsAt);
    endsAt.setUTCDate(endsAt.getUTCDate() + value.durationDays);
  }
  if (!Array.isArray(value.channels) || value.channels.length === 0) {
    throw new Error("experiment.channels must be a non-empty array");
  }
  const channelIds = new Set();
  const landingPaths = new Set();
  const channels = value.channels.map((channel, index) => {
    requireObject(channel, `experiment.channels[${index}]`);
    const id = requireNonEmptyString(channel.id, `experiment.channels[${index}].id`);
    const landingPath = requireNonEmptyString(
      channel.landingPath,
      `experiment.channels[${index}].landingPath`,
    );
    if (channelIds.has(id)) throw new Error(`duplicate experiment channel id: ${id}`);
    if (landingPaths.has(landingPath)) {
      throw new Error(`duplicate experiment landing path: ${landingPath}`);
    }
    channelIds.add(id);
    landingPaths.add(landingPath);
    return { id, landingPath };
  });
  requireObject(value.thresholds, "experiment.thresholds");
  const thresholds = {
    externalUniqueVisitors: requirePositiveInteger(
      value.thresholds.externalUniqueVisitors,
      "experiment.thresholds.externalUniqueVisitors",
    ),
    validActivations: requirePositiveInteger(
      value.thresholds.validActivations,
      "experiment.thresholds.validActivations",
    ),
    realEvolutions: requirePositiveInteger(
      value.thresholds.realEvolutions,
      "experiment.thresholds.realEvolutions",
    ),
    reuseEvidence: requirePositiveInteger(
      value.thresholds.reuseEvidence,
      "experiment.thresholds.reuseEvidence",
    ),
  };
  return {
    id: value.id,
    targetKitVersion: value.targetKitVersion,
    startsAt: startsAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    durationDays: value.durationDays,
    channels,
    thresholds,
    channelIds,
  };
}

function normalizeEvidence(value, experiment, reportedUniqueVisitors, measurementWindow) {
  if (value === null) {
    return {
      status: "not_provided",
      knownTeamCoverageComplete: false,
      records: [],
      metrics: emptyEvidenceMetrics(null),
      decision: "insufficient_evidence",
    };
  }
  requireObject(value, "evidence");
  if (value.schemaVersion !== 1) throw new Error("evidence.schemaVersion must be 1");
  if (typeof value.knownTeamCoverageComplete !== "boolean") {
    throw new Error("evidence.knownTeamCoverageComplete must be a boolean");
  }
  if (!Array.isArray(value.records)) throw new Error("evidence.records must be an array");

  const participantClasses = new Map();
  const recordIds = new Set();
  const records = value.records.map((record, index) => {
    const label = `evidence.records[${index}]`;
    requireObject(record, label);
    const id = requireOpaqueId(record.id, `${label}.id`);
    const participantId = requireOpaqueId(record.participantId, `${label}.participantId`);
    if (recordIds.has(id)) throw new Error(`duplicate evidence record id: ${id}`);
    recordIds.add(id);
    if (!['known_team', 'external'].includes(record.actorClass)) {
      throw new Error(`${label}.actorClass must be known_team or external`);
    }
    const previousClass = participantClasses.get(participantId);
    if (previousClass && previousClass !== record.actorClass) {
      throw new Error(`participant ${participantId} changes actorClass`);
    }
    participantClasses.set(participantId, record.actorClass);
    if (record.sourceChannel !== "unattributed" && !experiment.channelIds.has(record.sourceChannel)) {
      throw new Error(`${label}.sourceChannel is not declared by the experiment`);
    }
    if (!["user_confirmation", "public_integration", "issue_or_discussion"].includes(record.evidenceType)) {
      throw new Error(`${label}.evidenceType is unsupported`);
    }
    const occurredAt = new Date(record.occurredAt);
    if (Number.isNaN(occurredAt.valueOf())) {
      throw new Error(`${label}.occurredAt must be an ISO timestamp`);
    }
    if (
      measurementWindow.windowStart &&
      occurredAt < new Date(measurementWindow.windowStart)
    ) {
      throw new Error(`${label}.occurredAt precedes the GitHub measurement window`);
    }
    if (
      measurementWindow.windowEndExclusive &&
      occurredAt >= new Date(measurementWindow.windowEndExclusive)
    ) {
      throw new Error(`${label}.occurredAt is outside the GitHub measurement window`);
    }
    if (record.actorClass === "external") {
      if (experiment.startsAt === null) {
        throw new Error(`${label} cannot record external outcomes before the experiment starts`);
      }
      if (occurredAt < new Date(experiment.startsAt) || occurredAt >= new Date(experiment.endsAt)) {
        throw new Error(`${label}.occurredAt is outside the seven-day experiment interval`);
      }
    }
    requireObject(record.outcome, `${label}.outcome`);
    const outcome = {};
    for (const field of ["visited", "installed", "initVerified", "realEvolution", "reuseVerified"]) {
      if (typeof record.outcome[field] !== "boolean") {
        throw new Error(`${label}.outcome.${field} must be a boolean`);
      }
      outcome[field] = record.outcome[field];
    }
    if (outcome.installed && !outcome.visited) {
      throw new Error(`${label} cannot install without a recorded visit`);
    }
    if (outcome.initVerified && !outcome.installed) {
      throw new Error(`${label} cannot verify init without installation`);
    }
    if (outcome.realEvolution && !outcome.installed) {
      throw new Error(`${label} cannot evolve without installation`);
    }
    if (outcome.reuseVerified && !outcome.realEvolution) {
      throw new Error(`${label} cannot verify reuse without a real evolution`);
    }
    return {
      id,
      participantId,
      actorClass: record.actorClass,
      sourceChannel: record.sourceChannel,
      evidenceType: record.evidenceType,
      occurredAt: occurredAt.toISOString(),
      outcome,
    };
  });

  const knownTeamVisitors = uniqueParticipants(records, "known_team", "visited");
  const confirmedExternalVisitors = uniqueParticipants(records, "external", "visited");
  if (
    value.knownTeamCoverageComplete &&
    knownTeamVisitors + confirmedExternalVisitors > reportedUniqueVisitors
  ) {
    throw new Error(
      "confirmed visitors exceed GitHub reported uniques for the same measurement window",
    );
  }
  const githubAdjustedExternalUniqueVisitors = value.knownTeamCoverageComplete
    ? Math.max(0, reportedUniqueVisitors - knownTeamVisitors)
    : null;
  const metrics = {
    confirmedExternalVisitors,
    githubAdjustedExternalUniqueVisitors,
    validActivations: uniqueExternalParticipants(
      records,
      (outcome) => outcome.initVerified || outcome.realEvolution,
    ),
    realEvolutions: uniqueParticipants(records, "external", "realEvolution"),
    reuseEvidence: uniqueParticipants(records, "external", "reuseVerified"),
  };

  return {
    status: "provided",
    knownTeamCoverageComplete: value.knownTeamCoverageComplete,
    records,
    metrics,
    decision: decideExperiment(
      metrics,
      experiment.thresholds,
      measurementWindow.capturedAt,
      experiment.startsAt,
      experiment.endsAt,
    ),
  };
}

function uniqueParticipants(records, actorClass, outcomeField) {
  return new Set(
    records
      .filter((record) => record.actorClass === actorClass && record.outcome[outcomeField])
      .map((record) => record.participantId),
  ).size;
}

function uniqueExternalParticipants(records, hasOutcome) {
  return new Set(
    records
      .filter((record) => record.actorClass === "external" && hasOutcome(record.outcome))
      .map((record) => record.participantId),
  ).size;
}

function emptyEvidenceMetrics(githubAdjustedExternalUniqueVisitors) {
  return {
    confirmedExternalVisitors: 0,
    githubAdjustedExternalUniqueVisitors,
    validActivations: 0,
    realEvolutions: 0,
    reuseEvidence: 0,
  };
}

function decideExperiment(metrics, thresholds, capturedAt, startsAt, endsAt) {
  if (startsAt === null || endsAt === null || capturedAt < new Date(startsAt)) {
    return "not_started";
  }
  if (metrics.githubAdjustedExternalUniqueVisitors === null) return "insufficient_evidence";
  if (capturedAt < new Date(endsAt)) return "in_progress";
  if (metrics.githubAdjustedExternalUniqueVisitors < thresholds.externalUniqueVisitors) {
    return "acquisition_failed";
  }
  if (metrics.validActivations < thresholds.validActivations) return "conversion_failed";
  if (metrics.realEvolutions < thresholds.realEvolutions) return "activation_failed";
  if (metrics.reuseEvidence < thresholds.reuseEvidence) return "reuse_unproven";
  return "initial_product_signal";
}

function normalizeReferrer(value, index) {
  requireObject(value, `referrers[${index}]`);
  if (typeof value.referrer !== "string" || value.referrer.length === 0) {
    throw new Error(`referrers[${index}].referrer must be a non-empty string`);
  }
  return {
    referrer: value.referrer,
    count: requireNonNegativeInteger(value.count, `referrers[${index}].count`),
    uniques: requireNonNegativeInteger(
      value.uniques,
      `referrers[${index}].uniques`,
    ),
  };
}

function requireSeries(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => {
    requireObject(entry, `${label}[${index}]`);
    if (typeof entry.timestamp !== "string" || Number.isNaN(Date.parse(entry.timestamp))) {
      throw new Error(`${label}[${index}].timestamp must be an ISO timestamp`);
    }
    return {
      timestamp: entry.timestamp,
      count: requireNonNegativeInteger(entry.count, `${label}[${index}].count`),
      uniques: requireNonNegativeInteger(
        entry.uniques,
        `${label}[${index}].uniques`,
      ),
    };
  });
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireOpaqueId(value, label) {
  requireNonEmptyString(value, label);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value)) {
    throw new Error(`${label} must be an opaque lowercase identifier`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  requireNonNegativeInteger(value, label);
  if (value === 0) throw new Error(`${label} must be greater than zero`);
  return value;
}

function validateRepositoryName(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)
  ) {
    throw new Error("repo must use a safe owner/name format");
  }
}

function runGh(arguments_) {
  const result = spawnSync(process.platform === "win32" ? "gh.exe" : "gh", arguments_, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Unable to run gh: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `gh ${arguments_.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

function writeJsonAtomically(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (!["--repo", "--input", "--output", "--experiment", "--evidence"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  if (parsed.input && parsed.repo) {
    throw new Error("--input and --repo cannot be used together");
  }
  return parsed;
}

function printHelp() {
  console.log(`Capture a GitHub discoverability snapshot.

Usage:
  node scripts/capture-discovery-snapshot.mjs [--repo owner/name] [--evidence file] [--output path]
  node scripts/capture-discovery-snapshot.mjs --input raw.json [--evidence file] [--output path]

Live mode requires an authenticated gh CLI account with push access so GitHub
Traffic endpoints are available. The experiment plan defaults to
docs/launch/experiment.json. Evidence records use opaque participant IDs and
are optional. Snapshots are local artifacts by default.`);
}

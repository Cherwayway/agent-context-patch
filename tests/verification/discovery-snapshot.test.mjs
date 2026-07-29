import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("discovery snapshot preserves GitHub facts without treating clones as people", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-context-discovery-"));
  const outputPath = join(temporaryRoot, "snapshot.json");

  try {
    execFileSync(
      process.execPath,
      [
        "scripts/capture-discovery-snapshot.mjs",
        "--input",
        "tests/fixtures/discovery-snapshot-input.json",
        "--evidence",
        "docs/launch/evidence.example.json",
        "--output",
        outputPath,
      ],
      { cwd: repositoryRoot, stdio: "pipe" },
    );

    const snapshot = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.repo, "Cherwayway/agent-context-patch");
    assert.equal(snapshot.capturedAt, "2026-07-29T08:53:00.000Z");
    assert.deepEqual(snapshot.window, {
      timezone: "UTC",
      start: "2026-07-15T00:00:00Z",
      endExclusive: "2026-07-29T00:00:00.000Z",
    });
    assert.deepEqual(snapshot.webTraffic, {
      views: 37,
      reportedUniqueVisitors: 1,
      referrers: [{ referrer: "github.com", count: 10, uniques: 1 }],
    });
    assert.deepEqual(snapshot.diagnosticOnly.clones, {
      count: 83,
      reportedUniqueCloners: 36,
    });
    assert.equal(snapshot.measurementPolicy.clonesArePeople, false);
    assert.deepEqual(snapshot.measurementPolicy.primaryKpis, [
      "externalUniqueVisitors",
      "validActivations",
      "realEvolutions",
      "reuseEvidence",
    ]);
    assert.deepEqual(snapshot.experiment, {
      id: "discoverability-2026-07-29",
      targetKitVersion: "0.5.4",
      startsAt: "2026-07-29T16:36:11.000Z",
      endsAt: "2026-08-05T16:36:11.000Z",
      durationDays: 7,
      channels: [
        {
          id: "anthropic_marketplace",
          landingPath: "docs/why-agent-context-patch.md",
        },
        {
          id: "technical_community",
          landingPath: "docs/launch/terminal-demo.md",
        },
        { id: "direct_outreach", landingPath: "AGENT_INSTALL.md" },
      ],
      thresholds: {
        externalUniqueVisitors: 30,
        validActivations: 3,
        realEvolutions: 3,
        reuseEvidence: 1,
      },
    });
    assert.equal(snapshot.experimentEvidence.status, "provided");
    assert.equal(snapshot.experimentEvidence.records.length, 1);
    assert.deepEqual(snapshot.experimentEvidence.metrics, {
      confirmedExternalVisitors: 0,
      githubAdjustedExternalUniqueVisitors: 0,
      validActivations: 0,
      realEvolutions: 0,
      reuseEvidence: 0,
    });
    assert.equal(snapshot.experimentEvidence.decision, "not_started");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("discovery capture rejects a shell-shaped repository name before gh", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/capture-discovery-snapshot.mjs", "--repo", "owner/repo;whoami"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repo must use a safe owner\/name format/u);
});

test("discovery capture counts only evidenced external outcomes", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-context-evidence-"));
  const inputPath = join(temporaryRoot, "input.json");
  const evidencePath = join(temporaryRoot, "evidence.json");
  const experimentPath = join(temporaryRoot, "experiment.json");
  const outputPath = join(temporaryRoot, "snapshot.json");
  const input = JSON.parse(
    readFileSync(join(repositoryRoot, "tests/fixtures/discovery-snapshot-input.json"), "utf8"),
  );
  input.views.uniques = 31;
  const experiment = JSON.parse(
    readFileSync(join(repositoryRoot, "docs/launch/experiment.json"), "utf8"),
  );
  experiment.startsAt = "2026-07-21T00:00:00.000Z";
  const evidence = {
    schemaVersion: 1,
    knownTeamCoverageComplete: true,
    records: [
      evidenceRecord("team-visit", "team-01", "known_team", {
        visited: true,
        installed: false,
        initVerified: false,
        realEvolution: false,
        reuseVerified: false,
      }),
      evidenceRecord("partner-reuse", "partner-01", "external", {
        visited: true,
        installed: true,
        initVerified: true,
        realEvolution: true,
        reuseVerified: true,
      }),
      evidenceRecord("partner-after-failure", "partner-02", "external", {
        visited: true,
        installed: true,
        initVerified: false,
        realEvolution: true,
        reuseVerified: false,
      }),
    ],
  };
  writeFileSync(inputPath, JSON.stringify(input), "utf8");
  writeFileSync(evidencePath, JSON.stringify(evidence), "utf8");
  writeFileSync(experimentPath, JSON.stringify(experiment), "utf8");

  try {
    execFileSync(
      process.execPath,
      [
        "scripts/capture-discovery-snapshot.mjs",
        "--input",
        inputPath,
        "--evidence",
        evidencePath,
        "--experiment",
        experimentPath,
        "--output",
        outputPath,
      ],
      { cwd: repositoryRoot, stdio: "pipe" },
    );
    const snapshot = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.deepEqual(snapshot.experimentEvidence.metrics, {
      confirmedExternalVisitors: 2,
      githubAdjustedExternalUniqueVisitors: 30,
      validActivations: 2,
      realEvolutions: 2,
      reuseEvidence: 1,
    });
    assert.equal(snapshot.experimentEvidence.decision, "conversion_failed");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("discovery capture rejects evidence outside traffic and experiment boundaries", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-context-boundaries-"));
  const inputPath = join(temporaryRoot, "input.json");
  const experimentPath = join(temporaryRoot, "experiment.json");
  const evidencePath = join(temporaryRoot, "evidence.json");
  const outputPath = join(temporaryRoot, "snapshot.json");
  const input = JSON.parse(
    readFileSync(join(repositoryRoot, "tests/fixtures/discovery-snapshot-input.json"), "utf8"),
  );
  const experiment = JSON.parse(
    readFileSync(join(repositoryRoot, "docs/launch/experiment.json"), "utf8"),
  );
  experiment.startsAt = "2026-07-21T00:00:00.000Z";
  writeFileSync(inputPath, JSON.stringify(input), "utf8");
  writeFileSync(experimentPath, JSON.stringify(experiment), "utf8");

  try {
    for (const scenario of [
      {
        actorClass: "known_team",
        occurredAt: "2026-07-14T23:59:59.999Z",
        expected: /precedes the GitHub measurement window/u,
      },
      {
        actorClass: "known_team",
        occurredAt: "2026-07-29T00:00:00.000Z",
        expected: /outside the GitHub measurement window/u,
      },
      {
        actorClass: "external",
        occurredAt: "2026-07-20T23:59:59.999Z",
        expected: /outside the seven-day experiment interval/u,
      },
      {
        actorClass: "external",
        occurredAt: "2026-07-28T00:00:00.000Z",
        expected: /outside the seven-day experiment interval/u,
      },
    ]) {
      const evidence = {
        schemaVersion: 1,
        knownTeamCoverageComplete: true,
        records: [
          {
            ...evidenceRecord("boundary", "participant-01", scenario.actorClass, {
              visited: true,
              installed: false,
              initVerified: false,
              realEvolution: false,
              reuseVerified: false,
            }),
            occurredAt: scenario.occurredAt,
          },
        ],
      };
      writeFileSync(evidencePath, JSON.stringify(evidence), "utf8");
      const result = spawnSync(
        process.execPath,
        [
          "scripts/capture-discovery-snapshot.mjs",
          "--input",
          inputPath,
          "--experiment",
          experimentPath,
          "--evidence",
          evidencePath,
          "--output",
          outputPath,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function evidenceRecord(id, participantId, actorClass, outcome) {
  return {
    id,
    participantId,
    actorClass,
    sourceChannel: "direct_outreach",
    evidenceType: "user_confirmation",
    occurredAt: "2026-07-25T12:00:00.000Z",
    outcome,
  };
}

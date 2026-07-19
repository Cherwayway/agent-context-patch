import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { basename } from "node:path";

import { sha256Text } from "./index.mjs";
import { validateProposalDocument } from "./proposal.mjs";

const WRITE_ATTEMPTS = 2;

export function createProposalStore({ replaceFile = rename } = {}) {
  if (typeof replaceFile !== "function") {
    throw new TypeError("proposal-store replaceFile adapter must be a function");
  }
  return {
    readProposalUtf8,
    writeProposalCas,
  };

  async function writeProposalCas({ proposalPath, expectedHash, source }) {
    if (validateProposalDocument(source, basename(proposalPath)).length > 0) {
      return { problem: "invalid_audit_write" };
    }

    let result;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      result = await writeProposalOnce({ proposalPath, expectedHash, source });
      if (!result.problem || result.problem !== "audit_write_failed") return result;
    }
    return result;
  }

  async function writeProposalOnce({ proposalPath, expectedHash, source }) {
    const desiredHash = sha256Text(source);
    const current = await readProposalUtf8(proposalPath);
    if (current.problem) return current;
    const currentHash = sha256Text(current.source);
    if (currentHash === desiredHash) return {};
    if (currentHash !== expectedHash) {
      return { problem: "proposal_source_changed" };
    }

    const temporaryPath = `${proposalPath}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(source, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;

      const latest = await readProposalUtf8(proposalPath);
      if (latest.problem) {
        await rm(temporaryPath, { force: true });
        return latest;
      }
      const latestHash = sha256Text(latest.source);
      if (latestHash === desiredHash) {
        await rm(temporaryPath, { force: true });
        return {};
      }
      if (latestHash !== expectedHash) {
        await rm(temporaryPath, { force: true });
        return { problem: "proposal_source_changed" };
      }
      await replaceFile(temporaryPath, proposalPath);
      return {};
    } catch {
      await handle?.close().catch(() => {});
      await rm(temporaryPath, { force: true }).catch(() => {});
      return { problem: "audit_write_failed" };
    }
  }
}

export async function readProposalUtf8(path) {
  try {
    const fileStat = await lstat(path);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return { problem: "unsafe_proposal_path" };
    }
    const bytes = await readFile(path);
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) {
      return { problem: "invalid_proposal_encoding" };
    }
    return { source };
  } catch {
    return { problem: "filesystem_error" };
  }
}

export const { writeProposalCas } = createProposalStore();

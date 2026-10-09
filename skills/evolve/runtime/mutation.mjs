import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { CONTEXT_DIR, loadWorkspace } from "./workspace.mjs";

/** All mutation commands acquire the same lock BEFORE reading their inputs. */
export async function withMutation(workspaceRoot, options, action) {
  const contextRoot = join(resolve(workspaceRoot), CONTEXT_DIR);
  const lockPath = join(contextRoot, ".lock");
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") return { status: "blocked", reason: "workspace_locked" };
    if (error.code === "ENOENT") return { status: "failed", reason: "workspace_invalid", details: ["context directory missing"] };
    throw error;
  }
  let retainLock = false;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const workspace = await loadWorkspace(workspaceRoot, options);
    if (workspace.status !== "ok") return { status: "failed", reason: "workspace_invalid", details: workspace.failures };
    const result = await action(workspace);
    retainLock = result.reason === "rollback_failed";
    return result;
  } catch (error) {
    return { status: "failed", reason: "mutation_failed", details: [String(error.message ?? error)] };
  } finally {
    await handle.close();
    // An incomplete rollback needs operator recovery; never unlock it as if clean.
    if (!retainLock) await unlink(lockPath);
  }
}

export async function readMaybe(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

export async function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

/** Preflight every target; rollback includes audits and the instruction block. */
export async function commitFiles(workspace, changes, { write = atomicWrite } = {}) {
  const backups = [];
  const touched = [];
  try {
    for (const change of changes) {
      const path = join(workspace.workspaceRoot, change.target);
      backups.push({ path, content: await readMaybe(path), after: change.after });
    }
    for (const backup of backups) {
      touched.push(backup);
      if (backup.after === null) await unlink(backup.path);
      else await write(backup.path, backup.after);
    }
    return { status: "ok" };
  } catch (error) {
    const failed = [];
    for (const backup of touched.reverse()) {
      try {
        if (backup.content === undefined) await rm(backup.path, { force: true });
        else await write(backup.path, backup.content);
      } catch { failed.push(relative(workspace.workspaceRoot, backup.path)); }
    }
    return { status: "failed", reason: failed.length ? "rollback_failed" : "commit_failed", details: [String(error.message ?? error)], rollback: { complete: failed.length === 0, failed } };
  }
}

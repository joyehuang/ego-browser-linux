import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_MS = 30000;
const SPIN_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) {
  Atomics.wait(SPIN_ARRAY, 0, 0, Math.max(1, ms));
}

function sleepAsync(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isLockStale(lockPath, staleMs) {
  try {
    const info = JSON.parse(readFileSync(lockPath, "utf8"));
    if (typeof info?.createdAt === "number" && Date.now() - info.createdAt > staleMs) {
      return true;
    }
    if (typeof info?.pid === "number" && !isProcessAlive(info.pid)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function tryAcquireLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
    const payload = JSON.stringify({ pid: process.pid, createdAt: Date.now() });
    writeFileSync(fd, payload, "utf8");
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }
}

function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // already removed
  }
}

export function withFileLockSync(
  lockPath,
  fn,
  { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (!tryAcquireLock(lockPath)) {
    if (isLockStale(lockPath, staleMs)) {
      releaseLock(lockPath);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for lock: ${lockPath}`);
    }
    sleepSync(15);
  }
  try {
    return fn();
  } finally {
    releaseLock(lockPath);
  }
}

export async function withFileLock(
  lockPath,
  fn,
  { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (!tryAcquireLock(lockPath)) {
    if (isLockStale(lockPath, staleMs)) {
      releaseLock(lockPath);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for lock: ${lockPath}`);
    }
    await sleepAsync(15);
  }
  try {
    return await fn();
  } finally {
    releaseLock(lockPath);
  }
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_DIR } from "./paths.mjs";

export const BUILTIN_PROFILES = Object.freeze([
  Object.freeze({
    id: "Default",
    name: "Default (Persistent)",
    isDefault: true,
    kind: "persistent",
    description: "Persistent Chrome disk profile with shared logins and storage.",
  }),
  Object.freeze({
    id: "isolated",
    name: "Isolated (Clean / No Login)",
    isDefault: false,
    kind: "isolated",
    description: "Clean ephemeral BrowserContext with zero cookies or logins.",
  }),
  Object.freeze({
    id: "isolated-seeded",
    name: "Isolated (Seeded Logins)",
    isDefault: false,
    kind: "isolated-seeded",
    description: "Ephemeral BrowserContext seeded with a cookie copy of Default.",
  }),
]);

export function customProfilesPath() {
  return process.env.EGO_LINUX_PROFILES_FILE || join(CONFIG_DIR, "profiles.json");
}

function loadCustomProfiles() {
  try {
    const raw = JSON.parse(readFileSync(customProfilesPath(), "utf8"));
    const entries = Array.isArray(raw?.profiles) ? raw.profiles : Array.isArray(raw) ? raw : [];
    const seen = new Set(BUILTIN_PROFILES.map((p) => p.id));
    const custom = [];
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || !entry.id.trim()) continue;
      const id = entry.id.trim();
      if (seen.has(id) || id.toLowerCase() === "default") continue;
      seen.add(id);
      const kind = entry.kind === "isolated-seeded" ? "isolated-seeded" : "isolated";
      custom.push({
        id,
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
        isDefault: false,
        kind,
        ...(typeof entry.description === "string" && entry.description.trim()
          ? { description: entry.description.trim() }
          : {}),
      });
    }
    return custom;
  } catch {
    return [];
  }
}

export function allProfiles() {
  return [...BUILTIN_PROFILES, ...loadCustomProfiles()];
}

export function listProfiles() {
  return {
    profiles: allProfiles().map(({ id, name, isDefault }) => ({
      id,
      name,
      isDefault,
    })),
  };
}

export function resolveProfile(profileId) {
  const list = allProfiles();
  if (profileId === undefined || profileId === "" || profileId === "default") {
    return list.find((p) => p.isDefault) || BUILTIN_PROFILES[0];
  }
  if (typeof profileId !== "string") return null;
  return list.find((p) => p.id === profileId) || null;
}

export function describeProfile(profileId) {
  return resolveProfile(profileId) || BUILTIN_PROFILES[0];
}

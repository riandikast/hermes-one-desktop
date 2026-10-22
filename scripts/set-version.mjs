#!/usr/bin/env node
// Rewrite package.json's "version" field in place, and mirror it into
// package-lock.json when present. Used by the beta-release workflow to stamp a
// `-beta.N` prerelease version before building, and by the custom-release
// workflow to write the released version back to the branch so Settings →
// About & Updates (which reads app.getVersion()) matches the latest release.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/set-version.mjs <version>");
  process.exit(1);
}

// Guard against a malformed value corrupting package.json. Accepts semver with
// an optional prerelease/build suffix, e.g. 0.7.4 or 0.7.4-beta.3.
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Refusing to set an invalid version: "${version}"`);
  process.exit(1);
}

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Keep the lockfile's own version fields in step, otherwise the tree reports a
// package version the lock disagrees with.
const lockPath = new URL("../package-lock.json", import.meta.url);
if (existsSync(lockPath)) {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    let changed = false;
    if (lock.version !== version) {
      lock.version = version;
      changed = true;
    }
    if (lock.packages?.[""] && lock.packages[""].version !== version) {
      lock.packages[""].version = version;
      changed = true;
    }
    if (changed) writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  } catch (err) {
    console.error(`Could not update package-lock.json: ${err}`);
  }
}

console.log(`Set package.json version to ${version}`);

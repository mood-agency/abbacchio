#!/usr/bin/env node

/**
 * Version bumping utility for the Abbacchio monorepo.
 *
 * Usage:
 *   node scripts/bump-version.js patch     # 0.1.3 → 0.1.4
 *   node scripts/bump-version.js minor     # 0.1.3 → 0.2.0
 *   node scripts/bump-version.js major     # 0.1.3 → 1.0.0
 *   node scripts/bump-version.js 0.2.0     # Set specific version
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const VERSION_FILES = [
  { path: "package.json", type: "json", field: "version" },
  { path: "packages/transport/package.json", type: "json", field: "version" },
  {
    path: "packages/browser-transport/package.json",
    type: "json",
    field: "version",
  },
  { path: "packages/api/package.json", type: "json", field: "version" },
  { path: "packages/dashboard/package.json", type: "json", field: "version" },
  { path: "packages/tui/package.json", type: "json", field: "version" },
  {
    path: "packages/desktop/src-tauri/tauri.conf.json",
    type: "json",
    field: "version",
  },
  { path: "python/pyproject.toml", type: "toml", field: "version" },
];

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function bumpVersion(current, type) {
  const v = parseVersion(current);
  switch (type) {
    case "major":
      return `${v.major + 1}.0.0`;
    case "minor":
      return `${v.major}.${v.minor + 1}.0`;
    case "patch":
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    default:
      // Assume it's a specific version
      parseVersion(type); // Validate format
      return type;
  }
}

function getCurrentVersion() {
  const packageJson = JSON.parse(
    readFileSync(join(rootDir, "package.json"), "utf8")
  );
  return packageJson.version;
}

function updateJsonFile(filePath, newVersion) {
  const fullPath = join(rootDir, filePath);
  const content = JSON.parse(readFileSync(fullPath, "utf8"));
  content.version = newVersion;
  writeFileSync(fullPath, JSON.stringify(content, null, 2) + "\n");
}

function updateTomlFile(filePath, newVersion) {
  const fullPath = join(rootDir, filePath);
  let content = readFileSync(fullPath, "utf8");
  content = content.replace(
    /^version\s*=\s*"[^"]*"/m,
    `version = "${newVersion}"`
  );
  writeFileSync(fullPath, content);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Abbacchio Version Bump Utility

Usage:
  node scripts/bump-version.js <type|version>

Arguments:
  patch     Bump patch version (0.1.3 → 0.1.4)
  minor     Bump minor version (0.1.3 → 0.2.0)
  major     Bump major version (0.1.3 → 1.0.0)
  <x.y.z>   Set specific version

Examples:
  node scripts/bump-version.js patch
  node scripts/bump-version.js 0.2.0
`);
    process.exit(0);
  }

  const bumpType = args[0];
  const currentVersion = getCurrentVersion();
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`\nVersion bump: ${currentVersion} → ${newVersion}\n`);
  console.log("Updating files:");

  for (const file of VERSION_FILES) {
    try {
      if (file.type === "json") {
        updateJsonFile(file.path, newVersion);
      } else if (file.type === "toml") {
        updateTomlFile(file.path, newVersion);
      }
      console.log(`  ✓ ${file.path}`);
    } catch (error) {
      console.log(`  ✗ ${file.path} - ${error.message}`);
    }
  }

  console.log(`
Done! Don't forget to:
  1. Update CHANGELOG.md if it exists
  2. Commit the version bump: git commit -am "chore: bump version to ${newVersion}"
  3. Create a git tag: git tag v${newVersion}
`);
}

main();

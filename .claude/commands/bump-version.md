# Bump Version

Synchronize and bump versions across all packages in the monorepo.

## Version Files

Update the version in ALL of these files:

### JavaScript/TypeScript packages (package.json)
1. `package.json` (root)
2. `packages/transport/package.json`
3. `packages/browser-transport/package.json`
4. `packages/api/package.json`
5. `packages/dashboard/package.json`
6. `packages/tui/package.json`

### Tauri desktop app
7. `packages/desktop/src-tauri/tauri.conf.json`

### Python package
8. `python/pyproject.toml`

## Instructions

1. Ask the user what type of bump they want:
   - **patch** (0.1.0 → 0.1.1) - Bug fixes, minor changes
   - **minor** (0.1.0 → 0.2.0) - New features, backwards compatible
   - **major** (0.1.0 → 1.0.0) - Breaking changes

2. Or ask if they want to set a specific version (e.g., "0.2.0")

3. Read the current version from `package.json` (root) as the source of truth

4. Update ALL version files listed above to the new version

5. Show a summary of changes:
   ```
   Version bump: 0.1.0 → 0.1.1

   Updated files:
   ✓ package.json
   ✓ packages/transport/package.json
   ✓ packages/browser-transport/package.json
   ✓ packages/api/package.json
   ✓ packages/dashboard/package.json
   ✓ packages/tui/package.json
   ✓ packages/desktop/src-tauri/tauri.conf.json
   ✓ python/pyproject.toml
   ```

6. Ask if the user wants to commit the version bump

## Version Format

All packages use semantic versioning: `MAJOR.MINOR.PATCH`

## Notes

- The root `package.json` is the source of truth for the current version
- All packages should have the same version number
- After bumping, remind the user to update CHANGELOG.md if it exists
- Do NOT automatically commit - ask the user first

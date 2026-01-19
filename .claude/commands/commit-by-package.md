# Commit by Package

Analyze all staged and unstaged changes in the repository and create separate commits organized by project area.

## Package Categories

Organize commits into these categories (in this order):

1. **dashboard** - Changes in `packages/dashboard/`
   - Prefix: `feat(dashboard):`, `fix(dashboard):`, `refactor(dashboard):`, etc.

2. **transport** - Node.js transport package:
   - `packages/transport/`
   - Prefix: `feat(transport):`, `fix(transport):`, etc.

3. **browser-transport** - Browser transport package:
   - `packages/browser-transport/`
   - Prefix: `feat(browser-transport):`, `fix(browser-transport):`, etc.

4. **api** - API server package:
   - `packages/api/`
   - Prefix: `feat(api):`, `fix(api):`, etc.

5. **cli** - CLI package:
   - `packages/cli/`
   - Prefix: `feat(cli):`, `fix(cli):`, etc.

6. **python** - Changes in Python packages:
   - `packages/python-transport/`
   - `scripts/python/`
   - Prefix: `feat(python):`, `fix(python):`, etc.

7. **tauri** - Changes in Tauri desktop app:
   - `packages/desktop/`
   - Prefix: `feat(desktop):`, `fix(desktop):`, `chore(desktop):`, etc.

8. **tui** - Changes in Terminal UI:
   - `packages/tui/`
   - `crates/`
   - Prefix: `feat(tui):`, `fix(tui):`, etc.

9. **docs** - Documentation changes:
   - `docs/`
   - `*.md` files in root (except CHANGELOG)
   - Prefix: `docs:`

10. **ci** - CI/CD and GitHub workflows:
    - `.github/`
    - Prefix: `ci:`

11. **config** - Configuration and tooling:
    - Root config files (`package.json`, `pnpm-lock.yaml`, `tsconfig.json`, etc.)
    - `.claude/`, `.vscode/`
    - Prefix: `chore:`

12. **scripts** - Utility scripts:
    - `scripts/` (except python)
    - Prefix: `feat:`, `fix:`, `chore:`

## Instructions

1. Run `git status` to see all changes (staged, unstaged, and untracked)
2. Run `git diff` to understand the nature of changes
3. Group changes by category above
4. For each category with changes:
   - Stage only the files for that category
   - Create a commit with appropriate prefix and descriptive message
   - The commit message should explain WHAT changed and WHY
5. Skip categories with no changes
6. Show a summary at the end with all commits created

## Commit Message Format

```
<type>(<scope>): <short description>

<optional body explaining what and why>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Example Output

After running, show a table like:

| # | Commit | Scope | Description |
|---|--------|-------|-------------|
| 1 | abc123 | dashboard | Add dark mode toggle |
| 2 | def456 | packages | Bump transport to 0.2.0 |
| 3 | ghi789 | tui | Fix scroll behavior |

## Notes

- Do NOT commit files that look like secrets (`.env`, credentials, etc.)
- Do NOT commit `__pycache__/`, `node_modules/`, `dist/`, `target/` directories
- Ask the user before committing if unsure about a file
- If a change spans multiple categories, prefer the most specific one

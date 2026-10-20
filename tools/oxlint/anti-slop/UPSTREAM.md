# Anti-slop plugin provenance

Vendored Oxlint plugin that enforces anti-"slop" code conventions. This repository
owns this copy: rules, configuration, and any local deviations live here.

## Source

- Upstream project: [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) (GitHub).
- Installed via the `install-anti-slop` skill (`skills/install-anti-slop/SKILL.md`).
- Recoverable snapshot identifier: skills-lock `computedHash`
  `1b9b5d3c0d9e0ef8dd7631f4d637e66b62a73e34dceaf4ae07c0d3de376fd7d7`
  (see `skills-lock.json` → `skills.install-anti-slop`). The skill bundles the plugin
  as pristine assets; an exact upstream git commit for the plugin source is **not**
  recorded in those assets and is therefore unknown here.
- Installed: 2026-10-20.

## Installed paths

- Entry point: `tools/oxlint/anti-slop/index.ts` (generic plugin, registered in `.oxlintrc.json`).
- Rules: `tools/oxlint/anti-slop/rules/`.
- Shared helpers: `tools/oxlint/anti-slop/shared/`.
- Opt-in Effect plugin: `tools/oxlint/anti-slop/effect/` — **not registered** (the repo has
  no direct `effect` dependency).
- Vendored dependency: `tools/oxlint/anti-slop/vendor/eslint-stylistic/` — ESLint Stylistic
  `padding-line-between-statements`, commit `435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08`, MIT.
  See that directory's `LICENSE` and `UPSTREAM.md`.

## Intentional deviations

- None to the vendored rule source. The copy is verbatim from the skill assets.
- Configuration lives in the repository root `.oxlintrc.json`: all generic rules plus the
  native `oxc/no-accumulating-spread` companion are enabled at `error`. The Effect rules
  are intentionally omitted.

## Updating

Re-run the `install-anti-slop` skill's update procedure
(`skills/install-anti-slop/references/update.md`). Preserve this record, the vendored
`eslint-stylistic/LICENSE`, and the root `.oxlintrc.json` rule selection.

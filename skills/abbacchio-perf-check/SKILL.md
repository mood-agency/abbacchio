---
name: abbacchio-perf-check
description: Check a code change for performance regressions with `abbacchio bench` before reporting the work as done. Use after changing code on a hot path (request handlers, parsers, queries, loops over data, serialization, caching, dependencies), when the user asks whether a change is slower or faster, or when a CI `perf` job fails. The project must emit OpenTelemetry spans (OTLP/HTTP JSON) from a repeatable workload command.
---

# Performance check with `abbacchio bench`

`abbacchio bench` runs one command against a **baseline** (a git ref, checked out in a temporary worktree, so the working tree is never touched) and against the **working tree**. It does this in interleaved rounds, collects the spans the program exports, and reports per span whether the change is a regression, an improvement or noise. It exits non-zero on a regression, so its result can be trusted mechanically.

## 1. Find the workload command

You need a command that exercises the code you changed and exits when it's done. Look, in this order:

1. A script already meant for it: `package.json` scripts named `bench`, `perf` or `load-test`, a `bench/` or `perf/` directory, or a `perf` job in `.github/workflows/*`. CI's command is the reference.
2. The project's docs (README, CLAUDE.md, `docs/`), for a load test or benchmark.
3. Otherwise, write a small one, outside the repository or under `bench/` (see step 2). Keep it deterministic: fixed inputs, a fixed amount of work, no network beyond the program itself.

If the workload script is new, it doesn't exist in the baseline commit. Pass it by **absolute path** from the working tree (`--run "bun $PWD/bench/load.ts"`). The baseline then runs the same script against its own code (the current directory).

## 2. Make sure the program emits spans

`bench` compares spans (and optional metrics) that the program exports over OTLP. It sets these variables for the command:

- `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`
- `OTEL_RESOURCE_ATTRIBUTES=…,service.version=<baseline-sha|candidate-sha>`
- `ABBACCHIO_URL`

What picks them up:
- **OpenTelemetry SDKs** (any language) and `@abbacchio/transport` (Node) read them automatically.
- **With `@abbacchio/transport`**, wrap the operation you care about: `await traceWithMemory(client, 'parse order', () => parseOrder(input))`. It uses a nanosecond monotonic clock, so sub-millisecond operations are fine.
- **A standalone workload script** can time each request itself and POST spans to `$OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces`. `packages/api/bench/load.ts` in the Abbacchio repository is a complete example.

Name spans after **what** is measured (`POST /orders`, `parse order`), never after a run or a timestamp, or nothing will match between builds.

**Size spans so they can be measured.** A span of a few microseconds is mostly timer and tracing overhead, and stays noisy however many rounds you run. If the operation is that fast, time a batch per span (for example, 100 calls per `traceWithMemory`), so each span lasts at least ~0.1 ms. If you can't change the workload, say so in the report (see step 4).

A workload is not a correctness test. Still run the project's tests (step 5) after any change.

## 3. Run it

```bash
bunx @abbacchio/api bench --baseline HEAD --run "<workload command>"
# with dependencies to install in each checkout:
bunx @abbacchio/api bench --baseline HEAD --setup "bun install --frozen-lockfile" --run "<workload command>"
```

- `--baseline HEAD` compares your uncommitted changes with the last commit. On a branch, compare with where it started instead: `--baseline origin/main`.
- `--setup` is only needed when the workload needs installed dependencies (`npm ci`, `pip install -e .`, ...). It runs once per checkout, and the baseline worktree starts without `node_modules` or a virtualenv. Leave it out otherwise.
- `bunx @abbacchio/api bench --help` lists every option.
- Keep the default `--runs 3`. Use `--runs 5` when the noise column is high.
- Add `--json` when you need to read the numbers programmatically, or `--format markdown` for a table to paste into a PR.
- Don't run other CPU-heavy work (test suites, builds) while it runs. It skews the measurement.

## 4. Read the result

| Exit code | Meaning | What to do |
|---|---|---|
| `0` | No regression | Report it, with the table. But check the `noise` column first (below) |
| `1` | At least one span regressed beyond the threshold **and** the measured noise | Investigate (step 5). Don't report the task as done without saying so |
| `2` | The command or setup failed, or bad arguments | Fix the command; the stderr shows the cause |
| `3` | Not enough data (no spans received, or too few samples) | The program isn't exporting spans, or not to `$OTEL_EXPORTER_OTLP_ENDPOINT`; fix step 2 |

The `noise` column is how much the same build varied between its own rounds. A change smaller than that is reported as `no change` even above `--threshold`. So **when a span's noise is larger than `--threshold` (default 10%), its `no change` proves nothing**: a regression up to the size of the noise would read the same. `bench` marks these spans `no change (noisy)` and counts them as inconclusive, but the exit code is still 0.

For a span you changed that comes out noisy:
1. Make each span cover more work (step 2). This is the fix that works. Extra rounds help only a little, and they don't help at all for microsecond spans.
2. If you can't, measure in-process as a cross-check (the old and new function on the same inputs, timed over many repetitions), and report both results.
3. Report it as **inconclusive**, with the noise figure. Never report it as "no regression".

## 5. When there is a regression

1. **Confirm it.** Run again with `--runs 5 --span "<name>"`. A real regression reproduces with a similar size, and noise doesn't.
2. **Find the cause in your diff**, not in the benchmark. Look at what the change does per item (an extra copy or allocation per record, a query inside a loop, serialization, a lost cache, a new dependency).
3. **Fix it, and keep the behaviour.** Run the project's tests. If they don't cover the change, compare the old and new code on the same generated inputs: the outputs must match. Checking this often shows what the code really does. For example, a "restriction" that can never fail can be removed outright.
4. **Re-run `bench`** after each fix. If it still regresses, go back to step 2: there is more cost to find.
5. **Know when to stop.** Stop when `bench` reports `no change` with noise below the threshold. Also stop when what remains is the inherent cost of the new behaviour (work the old code didn't do at all). In that case, say so explicitly to the user with the numbers (before, after, noise) and let them decide. Never lower `--threshold`, delete spans or shrink the workload to make the check pass.

## Report to the user

Include, briefly:
- the command you ran;
- the verdict per relevant span: baseline → candidate, the change and the noise;
- what you did about any regression.

If the result was exit 3, or if the spans you changed were inconclusive (noise above the threshold), say so plainly instead of claiming there's no regression. Mention any behaviour you found while checking, such as a condition that is always true, so the user can confirm it was intended.

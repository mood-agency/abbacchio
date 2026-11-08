# Comparing Versions (Performance Regression Checks)

Abbacchio can compare a span or metric between two runs, typically a **baseline** version and a **candidate** version, and tell you whether the candidate regressed. It is built for the loop an agent or CI job runs in a sandbox:

1. Start Abbacchio.
2. Run the program at the baseline commit with load or benchmark traffic.
3. Change the code and run the same load again.
4. Ask Abbacchio whether latency (or any other metric) got worse.

## 1. Tag telemetry with its version

Set the standard OpenTelemetry resource attribute `service.version` (a semver, a git SHA, anything unique per build). Abbacchio copies it onto every log, metric data point and span it stores, so each run can be selected later.

```bash
OTEL_SERVICE_NAME=shop \
OTEL_RESOURCE_ATTRIBUTES="service.version=$(git rev-parse --short HEAD)" \
node app.js
```

`@abbacchio/transport` (Node) reads `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_EXPORTER_OTLP_HEADERS` too, so the same variables work without code changes. Explicit options such as `resourceAttributes: { 'service.version': '...' }` take precedence. `traceWithMemory` measures durations with a monotonic nanosecond clock. The browser transport can't read environment variables, so pass `resourceAttributes` there.

These resource attributes are kept. Point-level attributes with the same key win.

| Attribute | Use |
|-----------|-----|
| `service.version` | Version used by `/api/compare` and `/api/versions` |
| `service.namespace` | Grouping |
| `deployment.environment`, `deployment.environment.name` | Environment |
| `vcs.ref.head.name`, `vcs.ref.head.revision` | Branch and commit |

Other resource attributes (`host.*`, `process.*`, `telemetry.sdk.*`) are dropped to keep rows small. `service.name` becomes the channel, as before.

If you can't set resource attributes, use one channel per run instead (`shop@baseline`, `shop@candidate`) and compare with `baselineChannel` and `candidateChannel`.

## 2. See which versions are stored

```bash
curl 'http://localhost:4000/api/versions?channel=shop'
```

```json
{
  "versions": [
    { "channel": "shop", "version": "b41c2e9", "spans": 1000, "metricPoints": 12, "logs": 40, "firstSeen": 1794110521059, "lastSeen": 1794110522158 },
    { "channel": "shop", "version": "a17f003", "spans": 1000, "metricPoints": 12, "logs": 38, "firstSeen": 1794110410974, "lastSeen": 1794110412073 }
  ]
}
```

## 3. Compare

```bash
curl 'http://localhost:4000/api/compare?source=span&name=checkout&channel=shop&baselineVersion=a17f003&candidateVersion=b41c2e9'
```

| Param | Default | Meaning |
|-------|---------|---------|
| `source` | *(required)* | `span`: durations of spans named `name`. `metric`: data points of the metric `name` |
| `name` | *(required)* | Exact span or metric name |
| `channel` | | Channel for both runs |
| `baselineVersion` / `candidateVersion` | | `service.version` of each run |
| `baselineChannel` / `candidateChannel` | | Per-run channel (overrides `channel`) |
| `baselineSince` / `baselineUntil` / `candidateSince` / `candidateUntil` | | Epoch-ms time bounds per run |
| `stat` | `p95` | Statistic the verdict is based on: `mean`, `p50`, `p90`, `p95`, `p99` or `max` |
| `threshold` | `10` | Percent change that counts as a real difference (performance data is noisy) |
| `direction` | `lower` | `lower` is better (latency, memory) or `higher` is better (throughput) |
| `minSamples` | `5` | Minimum observations per run before a verdict is given |

Response (abridged):

```json
{
  "verdict": "regression",
  "summary": "checkout p95: 109 ms → 139 ms (+27.5%) — regression (threshold ±10%, lower is better).",
  "baseline":  { "selector": { "channel": "shop", "version": "a17f003" }, "stats": { "count": 100, "mean": 104.5, "p50": 105, "p95": 109, "p99": 109, "errorRate": 0, "unit": "ms" } },
  "candidate": { "selector": { "channel": "shop", "version": "b41c2e9" }, "stats": { "count": 100, "mean": 134.8, "p50": 135, "p95": 139, "p99": 139, "errorRate": 0, "unit": "ms" } },
  "deltas": { "p95": { "baseline": 109, "candidate": 139, "absolute": 30, "percent": 27.5 }, "...": {} },
  "notes": []
}
```

`verdict` is one of `regression`, `improvement`, `no_change` or `insufficient_data`. `notes` lists caveats, such as a rise in span error rate, truncated runs or estimated percentiles.

### How values are computed

- **Spans**: one observation per span, plus the fraction of spans with status `ERROR`. The duration is computed from the nanosecond OTLP timestamps and stored as fractional milliseconds, so sub-millisecond operations compare correctly. Spans stored before this change fall back to whole-millisecond `end - start`.
- **Gauge / Sum metrics**: one observation per data point.
- **Histogram metrics**: points are merged. The mean is exact (Σsum / Σcount). Percentiles are estimated from the bucket boundaries, so pick bucket bounds that bracket the latencies you care about.
- Each run reads at most the 200,000 most recent observations.

## One command: `abbacchio bench`

`abbacchio bench` does the whole loop, and its exit code makes it usable from CI or an agent:

1. It starts a private, in-memory Abbacchio.
2. It runs your command against the baseline (a git ref, checked out in a temporary `git worktree`; your working tree is never touched) and against your working tree, alternating them in rounds (baseline, candidate, candidate, baseline, ...).
3. It compares every span and prints a verdict that accounts for run-to-run noise.

```bash
# Working tree vs HEAD (the default baseline)
bunx @abbacchio/api bench --run "bun run load-test"

# vs another ref, installing dependencies in each checkout, 5 rounds per build
bunx @abbacchio/api bench --baseline origin/main --setup "bun install" --runs 5 --run "bun run load-test"
```

```
Comparing baseline-cb73cd8 → candidate-cb73cd8-dirty (p95, threshold ±10%, 3 round(s))

  name       baseline   candidate   change    noise   verdict      samples
  checkout   10.2 ms    30.2 ms     +196.1%   ±2.0%   REGRESSION   n=60/60

1 regression(s), 0 improvement(s), 0 unchanged, 0 without enough data
```

### Noise

Performance numbers move between runs of the *same* code, by tens of percent on shared machines such as CI runners and sandboxes. A fixed threshold alone produces false regressions, so `bench` does two things about it:

- **It interleaves rounds.** Each build runs `--runs` times (default 3) in an alternating order, so slow drift on the machine (thermal throttling, caches, background load) affects both builds equally.
- **It measures the noise.** For each span, the `noise` column is the largest spread of the chosen stat between rounds of the same build, as a share of its median. A change no larger than that is reported as `no change (within run-to-run noise)`, whatever `--threshold` says.

A span is a `regression` only when the change exceeds both the threshold and the measured noise. The reverse case matters too. When a span's noise is larger than the threshold, its `no change` can't rule out a regression of that size, so it is shown as `no change (noisy)` and counted as **inconclusive** (`inconclusive` in the JSON). The exit code stays 0, but don't read it as a pass for that span. If a span is often reported as noisy, give it more work per run (longer runs, more requests) or use more rounds. With `--runs 1` the noise is unknown and the report says so.

| Exit code | Meaning |
|-----------|---------|
| `0` | No regression |
| `1` | At least one span or metric regressed beyond the threshold |
| `2` | Usage error, or the command or setup failed |
| `3` | Not enough telemetry to decide (nothing received, or fewer than `--min-samples`) |

The command runs with `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `ABBACCHIO_URL` and `OTEL_RESOURCE_ATTRIBUTES=…,service.version=<baseline-sha|candidate-sha>` set. `@abbacchio/transport` and OpenTelemetry SDKs pick these up automatically. Runs are told apart by time window, so a program that hard-codes its own `service.version` still compares correctly. The command's stdout goes to stderr, so `--json` output stays clean.

| Option | Default | Meaning |
|--------|---------|---------|
| `--run <cmd>` | *(required)* | Command that exercises the program |
| `--baseline <ref>` | `HEAD` | Git ref for the baseline. `none` runs only the working tree |
| `--against <file>` | | Compare with stats saved earlier with `--save` instead of running a baseline |
| `--save <file>` | | Save the working tree's stats, e.g. on `main`, for a later `--against` |
| `--setup <cmd>` | | Run once in each checkout first (the baseline worktree starts without `node_modules`) |
| `--runs <n>` | `3` | Rounds: run each build n times, interleaved, to measure run-to-run noise |
| `--span <name>` | all spans | Only compare these spans (repeatable) |
| `--metric <name>` | | Also compare this metric (repeatable). `--direction` applies to metrics |
| `--stat`, `--threshold`, `--min-samples` | `p95`, `10`, `5` | As for `/api/compare` |
| `--settle <ms>` | `1500` | Wait after the last run so batched exporters can flush |
| `--format <f>` | `text` | `text`, `json` or `markdown` (a table for `$GITHUB_STEP_SUMMARY` or a PR comment). `--json` is short for `--format json` |

### In CI

This repository's own CI runs a `perf` job on every pull request. It benchmarks the API (`packages/api/bench/load.ts`: OTLP and `/api/logs` ingestion, plus queries over a fixed dataset) against the base branch:

```yaml
perf:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  permissions:
    contents: read                # it runs the PR's code
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0            # the baseline commit is checked out in a worktree
        persist-credentials: false
    - uses: oven-sh/setup-bun@v2
    - run: bun install --frozen-lockfile
    - env:
        BASE_SHA: ${{ github.event.pull_request.base.sha }}   # what the merge commit is built on
      run: |
        set +e
        bun packages/api/src/cli.ts bench \
          --baseline "$BASE_SHA" \
          --setup "bun install --frozen-lockfile" \
          --run "bun $GITHUB_WORKSPACE/packages/api/bench/load.ts" \
          --format markdown > perf.md
        code=$?
        cat perf.md >> "$GITHUB_STEP_SUMMARY"
        case $code in
          0) ;;                                                     # no regression
          3) echo "::warning title=Performance::Not enough data" ;;  # warn only
          *) exit "$code" ;;                                        # 1 regression, 2 error
        esac
```

The baseline is the PR's recorded base commit, not `origin/<base>`, so the comparison matches the merge commit being tested even if the base branch moves while the job runs. See `.github/workflows/ci.yml` for the full job, which also prints the table to the log and names regressed workloads in the annotation.

The load script is passed by absolute path from the candidate checkout, so the baseline doesn't need to contain it. It starts the API server of whichever checkout it runs in. The job fails on a regression and names the regressed workloads in an error annotation. The table goes to the job log and the job summary. On GitHub runners the measured run-to-run noise is about ±0.3–6%, so a 10% threshold is meaningful there. "Not enough data" only warns. If a regression is intentional (the cost of a feature), say so in the PR; once it merges, the base branch is the new baseline.

### Keeping a baseline across sandboxes

When the baseline can't be rebuilt in the same sandbox, save its stats once and compare against the file later, for example from a CI artifact:

```bash
# on main
abbacchio bench --baseline none --run "bun run load-test" --save perf-baseline.json
# on a branch, possibly another machine
abbacchio bench --against perf-baseline.json --run "bun run load-test"
```

Comparing across machines adds hardware noise, so consider a larger `--threshold`. Same-sandbox `--baseline` is the more reliable option.

## Workflow in a sandbox (manual)

Running the baseline and the candidate **in the same sandbox, one after the other**, is the simplest and fairest option. It's the same machine, so there's no cross-environment noise, and nothing has to survive the sandbox.

```bash
# Abbacchio: one command, no Docker or clone needed (requires Bun).
# Anonymous access, no rate limit, SQL endpoint on, database wiped on start.
bunx @abbacchio/api sandbox --env-file .abbacchio.env &
source .abbacchio.env       # ABBACCHIO_URL, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL

# Baseline
git stash && export OTEL_RESOURCE_ATTRIBUTES="service.version=baseline"
./run-load-test.sh        # your program + traffic, exporting OTLP to http://localhost:4000

# Candidate
git stash pop && export OTEL_RESOURCE_ATTRIBUTES="service.version=candidate"
./run-load-test.sh

curl -s 'http://localhost:4000/api/compare?source=span&name=checkout&baselineVersion=baseline&candidateVersion=candidate' | jq .summary
```

`abbacchio sandbox` options:

| Option | Default | Meaning |
|--------|---------|---------|
| `-p, --port <n>` | `$PORT` or `4000` | Port to listen on |
| `--db <path>` | `<tmpdir>/abbacchio-sandbox-<port>.db` | SQLite file. `:memory:` keeps everything in RAM, but then the MCP server can't read it |
| `--keep` | off | Keep data between restarts |
| `--env-file <path>` | | Write `export ...` lines for the program under test |
| `-q, --quiet` | off | Only print errors |

Environment variables you set yourself take precedence over the sandbox defaults, so `API_KEY=... abbacchio sandbox` still requires a key. A `SQLITE_PATH` inherited from your shell is used, but it is never wiped. Pass `--db` to get a throwaway file.

To point the MCP server at the sandbox, use `SQLITE_PATH` (the `Database:` line printed at startup) and `ABBACCHIO_URL`.

To keep a baseline across sandboxes, use `abbacchio bench --save` / `--against` (above), or point `--db` at a persistent volume with `--keep`.

## From Claude Code (MCP)

The MCP server exposes `list_versions` and `compare_runs`. They call the HTTP API, so set `ABBACCHIO_URL` (default `http://localhost:4000`) and `ABBACCHIO_API_KEY` if the server requires a key. See [Claude Code](claude-code.md).

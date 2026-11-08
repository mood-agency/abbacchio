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

## Workflow in a sandbox

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

Environment variables you set yourself take precedence over the sandbox defaults, so `API_KEY=... abbacchio sandbox` still requires a key.

To point the MCP server at the sandbox, use `SQLITE_PATH` (the `Database:` line printed at startup) and `ABBACCHIO_URL`.

To keep a baseline across sandboxes, save the `stats` of a compare response (or the raw rows) as a CI artifact, or point `SQLITE_PATH` at a persistent volume and drop `SQLITE_EPHEMERAL`.

## From Claude Code (MCP)

The MCP server exposes `list_versions` and `compare_runs`. They call the HTTP API, so set `ABBACCHIO_URL` (default `http://localhost:4000`) and `ABBACCHIO_API_KEY` if the server requires a key. See [Claude Code](claude-code.md).

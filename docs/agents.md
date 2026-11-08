# Performance Checks by Coding Agents

This guide sets up a project so that a coding agent (Claude Code, or any agent that can run shell commands) can check its own changes for performance regressions in a sandbox, before it reports the work as done:

1. The agent clones the repo.
2. It changes code.
3. It runs `abbacchio bench`.
4. It reads a verdict it can trust.

Nothing to deploy: `bench` starts its own throwaway, in-memory Abbacchio and needs only [Bun](https://bun.sh).

## What the project needs

### 1. Spans from the code you care about

`bench` compares the spans a program exports over OTLP/HTTP JSON. Any OpenTelemetry SDK works, and so does `@abbacchio/transport` for Node:

```ts
import { createClient, traceWithMemory } from '@abbacchio/transport';

// Endpoint, service name and version come from the OTEL_* variables that bench sets.
const client = createClient({ serviceName: 'orders' });

await traceWithMemory(client, 'price order', () => priceOrder(order));
await client.close(); // flush before the process exits
```

### 2. A repeatable workload command

This is a script that exercises those code paths a fixed number of times and exits. Keep it deterministic: fixed inputs, no external services, and enough work per run that each span gets a few hundred samples. For a server, start it from the current directory and send it requests. [`packages/api/bench/load.ts`](../packages/api/bench/load.ts) is a complete example: it starts the API of whichever checkout it runs in, drives fixed workloads, and exports one span per request.

Check it once by hand:

```bash
bunx abbacchio bench --baseline none --run "bun bench/load.ts"
```

A table of spans with counts means everything is wired up. "No telemetry received" (exit code 3) means the program isn't exporting to `$OTEL_EXPORTER_OTLP_ENDPOINT`.

### 3. Tell agents about it

**Copy the skill.** Put [`skills/abbacchio-perf-check/SKILL.md`](../skills/abbacchio-perf-check/SKILL.md) in the project as `.claude/skills/abbacchio-perf-check/SKILL.md`. Claude Code then loads it on its own whenever a change touches performance-sensitive code. The skill covers finding the workload, running `bench`, reading the noise column, and what to do about a regression.

**Add a line to the project's `CLAUDE.md`** (or `AGENTS.md`) so the workload is never guessed:

```md
## Performance
After changing request handling, parsing or queries, run the perf check and include its table in your report:
`bunx abbacchio bench --baseline HEAD --setup "bun install --frozen-lockfile" --run "bun $PWD/bench/load.ts"`
Exit 1 means a regression: investigate it before calling the task done.
```

### 4. The same check in CI (optional, recommended)

So that nothing depends on the agent remembering:

```yaml
perf:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  permissions:
    contents: read                 # it runs the PR's code
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0             # the baseline commit is checked out in a worktree
        persist-credentials: false
    - uses: oven-sh/setup-bun@v2
    - run: bun install --frozen-lockfile
    - env:
        BASE_SHA: ${{ github.event.pull_request.base.sha }}
      run: |
        set +e
        bunx abbacchio bench \
          --baseline "$BASE_SHA" \
          --setup "bun install --frozen-lockfile" \
          --run "bun $GITHUB_WORKSPACE/bench/load.ts" \
          --format markdown | tee -a "$GITHUB_STEP_SUMMARY"
        code=${PIPESTATUS[0]}
        [ "$code" = 3 ] && { echo "::warning::Not enough perf data"; exit 0; }
        exit "$code"
```

In this repository's own job, GitHub runners measured about ±0.3–6% run-to-run noise, so the default 10% threshold is meaningful there. See [Comparing Versions](performance-comparison.md#in-ci).

## What the agent sees

```
Comparing baseline-3f2a1c9 → candidate-3f2a1c9-dirty (p95, threshold ±10%, 3 round(s))

  name          baseline   candidate   change   noise   verdict      samples
  price order   0.412 ms   0.698 ms    +69.4%   ±4.1%   REGRESSION   n=600/600
  load cart     1.20 ms    1.18 ms     -1.7%    ±3.0%   no change    n=600/600
```

- **The exit code is the verdict:** `0` ok, `1` regression, `2` the command failed, `3` not enough data.
- **The `noise` column is how much the same build varied between rounds.** Changes inside it are reported as `no change`, so an agent doesn't chase noise.
- **`no change (noisy)` means inconclusive.** The noise is above the threshold, so a regression of that size wouldn't show. The usual cause is spans that are too short (a few microseconds): time a batch of calls per span.

## Investigating further

To look at individual traces, not just aggregates, keep a long-running instance:

```bash
bunx abbacchio sandbox --env-file .abbacchio.env & source .abbacchio.env
```

Then point the [MCP server](claude-code.md) at it (`SQLITE_PATH` from the sandbox banner, `ABBACCHIO_URL`). The agent can then use `search_spans`, `get_trace` and `compare_runs` against the same data.

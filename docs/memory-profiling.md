# Browser memory profiling

`@abbacchio/browser-transport` includes an opt-in memory profiler for
investigating memory growth in long-running browser sessions. It periodically
records JavaScript heap, DOM, and application-specific counters in a bounded
in-memory buffer that can be exported as JSON Lines (JSONL).

The profiler is local-only: it does not render a UI or send samples to an
Abbacchio server.

## Install

```bash
npm install @abbacchio/browser-transport
```

Install the profiler once during application startup:

```typescript
import { installMemoryProfiler } from '@abbacchio/browser-transport'

const memoryProfiler = installMemoryProfiler()
```

Installation exposes `globalThis.__abbacchioMemory` for use from browser
DevTools, but does not start a timer. This makes it practical to include the
profiler only in development builds:

```typescript
if (import.meta.env.DEV) {
  void import('@abbacchio/browser-transport').then(
    ({ installMemoryProfiler }) => {
      installMemoryProfiler({ hot: import.meta.hot })
    },
  )
}
```

Passing `import.meta.hot` disposes the previous profiler during hot module
replacement, preventing duplicate sampling timers.

## Run a profiling session

A useful investigation has three phases: establish an idle baseline, perform a
repeatable action, and observe whether memory returns toward the baseline.

In browser DevTools:

```javascript
// Sample every 30 seconds and retain at most 1,440 samples (12 hours).
__abbacchioMemory.start({
  intervalMs: 30_000,
  maxSamples: 1_440,
  label: 'baseline-idle',
})

// Before and after a repeatable workflow:
__abbacchioMemory.mark('open-and-close-editor:start')
// Perform the workflow several times.
__abbacchioMemory.mark('open-and-close-editor:end')

// Add an immediate sample at any point.
__abbacchioMemory.sample('after-recovery')

// Inspect the current session.
__abbacchioMemory.status()
__abbacchioMemory.getSamples()

// Stop sampling and export one JSON object per line.
__abbacchioMemory.stop()
__abbacchioMemory.download()
```

`start()` records an initial sample immediately. Starting again stops the
existing timer and clears prior samples by default. Use `reset: false` to keep
the retained samples:

```javascript
__abbacchioMemory.start({ reset: false, label: 'second-phase' })
```

The sampling interval is clamped to a minimum of one second. Buffer capacity is
clamped between 1 and 10,000 samples; when full, the oldest samples are
discarded.

## Add application-specific counters

Heap growth is easier to understand when samples include resources owned by the
application. Use `domSelectors` for DOM counts and `collectValues` for other
serializable values:

```typescript
installMemoryProfiler({
  domSelectors: {
    virtualRows: '[data-virtual-row-key]',
    editors: '.monaco-editor',
    dialogs: '[role="dialog"]',
  },
  collectValues: () => ({
    route: window.location.pathname,
    openDocuments: workspace.openDocuments.length,
    subscriptions: diagnostics.activeSubscriptions,
    framesReceived: diagnostics.framesReceived,
  }),
})
```

Selector counts are stored in `sample.dom`. Values returned by `collectValues`
are copied into `sample.values` and must be JSON-serializable. Keep the
collector inexpensive because it runs on every periodic and manual sample.
Avoid placing secrets or personal data in samples that may be shared.

## Understand a sample

Each JSONL line has this shape:

```json
{
  "schemaVersion": 2,
  "sessionId": "6f2b1c34-8f4e-4f1a-9d0b-2c7a5e8d1b30",
  "sequence": 12,
  "timestamp": "2026-07-24T18:00:00.000Z",
  "elapsedMs": 360000,
  "kind": "sample",
  "label": "after-recovery",
  "heap": {
    "usedBytes": 73400320,
    "totalBytes": 104857600,
    "limitBytes": 4294705152
  },
  "dom": {
    "elements": 1840,
    "canvases": 2,
    "images": 14,
    "editors": 1
  },
  "values": {
    "openDocuments": 1,
    "subscriptions": 8
  }
}
```

| Field | Meaning |
| --- | --- |
| `sessionId` | Identifier shared by every sample of one run; the grouping key for persisted runs |
| `sequence` | Monotonically increasing sample number for the retained session |
| `elapsedMs` | Time since the session began |
| `kind` | `sample` for measurements or `mark` for named checkpoints |
| `label` | Optional phase or checkpoint name |
| `heap.usedBytes` | Currently used JavaScript heap, when the browser exposes it |
| `heap.totalBytes` | JavaScript heap currently allocated by the runtime |
| `heap.limitBytes` | Approximate JavaScript heap limit |
| `dom` | Built-in element, canvas, and image counts plus configured selectors |
| `values` | Application-specific values returned by `collectValues` |

`performance.memory`, which supplies the heap fields, is primarily available in
Chromium-based browsers. Unsupported browsers record `null` for those fields;
DOM and custom counters are still collected.

## Interpret the results

Do not treat one high heap reading as a leak. Garbage collection timing,
temporary allocations, caches, and DevTools itself can move the heap between
samples. Look for repeatable trends across several action and recovery cycles:

- `heap.usedBytes` repeatedly settles at a higher post-recovery baseline.
- DOM counters continue increasing after views, dialogs, or editors are closed.
- Application counters such as listeners, subscriptions, workers, or open
  documents grow with every cycle and do not return.
- Growth in a custom counter lines up with the marked interaction that caused
  it.

Once a trend is reproducible, use the browser's heap snapshot or allocation
profiler to identify the retaining object graph. Abbacchio's samples provide the
timeline and the application context; the browser profiler provides object-level
retainer details.

For cleaner comparisons, use the same browser build, page state, workflow, and
sampling interval for each run. Let the application idle after each action so
that recovery samples are comparable.

## Persist a run for later querying

The retained history is bounded and lives only in the page: a reload, a crash, or
closing the tab loses whatever was not downloaded. To keep a run, forward each
sample to Abbacchio as metrics with `onSample` and `toMemoryProfilerMetrics`.
Samples are then stored in the `metrics` table and outlive the session.

```typescript
import {
  createClient,
  installMemoryProfiler,
  toMemoryProfilerMetrics,
} from '@abbacchio/browser-transport'

const client = createClient({
  endpoint: 'http://localhost:4000',
  serviceName: 'checkout-web',
})

installMemoryProfiler({
  onSample: (sample) => {
    for (const point of toMemoryProfilerMetrics(sample, { prefix: 'client.memory' })) {
      client.addMetric({
        name: point.name,
        value: point.value,
        type: 'gauge',
        attributes: point.attributes,
      })
    }
  },
})
```

The client batches points and flushes on `beforeunload` and `pagehide`, so a
closing tab still delivers its last samples. A sink that throws never interrupts
sampling and never discards the local history.

### How a sample becomes metrics

`toMemoryProfilerMetrics` flattens one sample into gauge points named
`<prefix>.<path>`, lowercasing and snake-casing each key:

| Sample field | Metric name |
| --- | --- |
| `heap.usedBytes` | `<prefix>.heap.used_bytes` |
| `dom.editors` | `<prefix>.dom.editors` |
| `values.browserPanel.totals.framesReceived` | `<prefix>.browser_panel.totals.frames_received` |

Conversion rules:

- `null` heap readings are omitted rather than sent as zero.
- Booleans become `1` and `0`.
- Arrays are omitted, because per-entry names would grow metric cardinality
  without bound. Use the JSONL export for per-entry detail.

Every point carries the attributes `sessionId`, `kind`, and `sequence`, plus
`label` when the sample has one. `sessionId` is the grouping key: it identifies
one run, so concurrent tabs and successive runs stay separate. Read it up front
with `status().sessionId`.

### Query a stored run

`GET /api/metrics` returns the recent in-memory buffer only. For history, query
the database through `POST /api/sql`, which is disabled in production unless
`ENABLE_SQL_ENDPOINT=true` is set.

List the runs that reported heap samples:

```bash
curl -s localhost:4000/api/sql -H 'content-type: application/json' -d '{
  "sql": "SELECT json_extract(attributes, '\''$.sessionId'\'') AS session_id,
                 COUNT(*) AS points,
                 datetime(MIN(time_unix_nano) / 1000000000, '\''unixepoch'\'') AS started,
                 datetime(MAX(time_unix_nano) / 1000000000, '\''unixepoch'\'') AS ended
          FROM metrics
          WHERE name = '\''client.memory.heap.used_bytes'\''
          GROUP BY session_id
          ORDER BY MIN(time_unix_nano) DESC"
}'
```

Then read one run's heap trend, oldest first:

```sql
SELECT datetime(time_unix_nano / 1000000000, 'unixepoch') AS at,
       json_extract(attributes, '$.label') AS label,
       value / 1048576.0 AS used_mb
FROM metrics
WHERE name = 'client.memory.heap.used_bytes'
  AND json_extract(attributes, '$.sessionId') = '<session-id>'
ORDER BY time_unix_nano;
```

Comparing the growth of a DOM or application counter against the heap over the
same run isolates which counter moves with it:

```sql
SELECT name, MIN(value) AS first, MAX(value) AS peak, MAX(value) - MIN(value) AS growth
FROM metrics
WHERE name LIKE 'client.memory.%'
  AND json_extract(attributes, '$.sessionId') = '<session-id>'
GROUP BY name
HAVING growth > 0
ORDER BY growth DESC;
```

Marks are stored alongside samples with `kind = 'mark'`, so phase boundaries can
be recovered from the same table:

```sql
SELECT datetime(time_unix_nano / 1000000000, 'unixepoch') AS at,
       json_extract(attributes, '$.label') AS label
FROM metrics
WHERE name = 'client.memory.heap.used_bytes'
  AND json_extract(attributes, '$.kind') = 'mark'
  AND json_extract(attributes, '$.sessionId') = '<session-id>'
ORDER BY time_unix_nano;
```

## Work with the JSONL export

The default filename is
`abbacchio-memory-<timestamp>.jsonl`. Set a project-specific prefix or filename
when needed:

```typescript
installMemoryProfiler({ filenamePrefix: 'checkout-memory' })
```

```javascript
__abbacchioMemory.download('checkout-baseline.jsonl')
```

Because each line is a complete JSON object, tools such as `jq` can select a
compact time series:

```bash
jq -c \
  '{sequence, elapsedMs, kind, label, usedBytes: .heap.usedBytes, elements: .dom.elements, values}' \
  checkout-baseline.jsonl
```

## API summary

| Method | Purpose |
| --- | --- |
| `start(options?)` | Start periodic sampling and return status |
| `stop()` | Stop periodic sampling without clearing retained samples |
| `sample(label?)` | Record and return an immediate measurement |
| `mark(label)` | Record a named checkpoint |
| `status()` | Return the run's `sessionId` plus timer and buffer status |
| `getSamples()` | Return defensive copies of retained samples |
| `clear()` | Clear retained samples and reset sequence numbers |
| `download(filename?)` | Download retained samples as JSONL |
| `dispose()` | Stop, clear, and remove the installed global API |

The global name and installation message can also be customized:

```typescript
installMemoryProfiler({
  globalName: '__checkoutMemory',
  filenamePrefix: 'checkout-memory',
  readyMessage: '[checkout] Memory profiler ready',
})
```

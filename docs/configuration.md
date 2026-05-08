# Configuration

## Environment Variables

| Variable          | Default | Description                     |
| ----------------- | ------- | ------------------------------- |
| `PORT`            | `4000`  | Server port                     |
| `LOG_BUFFER_SIZE` | `1000`  | Max logs in memory              |
| `API_KEY`         | -       | Optional API key for authentication |
| `CORS_ORIGIN`     | `*`     | CORS allowed origins            |
| `SQLITE_PATH`     | `./data/logs.db` | Path to the SQLite database. Use `:memory:` for an in-memory ephemeral database. |
| `SQLITE_MAX_LOGS` | `100000`| Maximum number of logs to keep in the database (older logs are automatically pruned). |
| `SQLITE_TTL_MS`   | `0`     | Time-to-live for logs in milliseconds. If > 0, logs older than this are pruned. |
| `SQLITE_EPHEMERAL`| `false` | If `true`, deletes the SQLite database file on startup. |

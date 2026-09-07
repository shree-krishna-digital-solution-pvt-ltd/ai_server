import Database from "better-sqlite3";
import { dirname } from "node:path";
import { config } from "./config.ts";

export interface LogRecord {
  id?: number;
  timestamp: string;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  client_request: string; // JSON string
  transformed_payload?: string | null; // JSON string
  destination_response?: string | null; // JSON string
  error?: string | null;
}

export interface GetLogsOptions {
  limit?: number;
  offset?: number;
  search?: string;
  method?: string;
  status?: number;
}

let dbInstance: ReturnType<typeof Database> | null = null;

export function getDatabase(customPath?: string): ReturnType<typeof Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const path = customPath || config.dbPath;

  if (path !== ":memory:") {
    try {
      const dir = dirname(path);
      Deno.mkdirSync(dir, { recursive: true });
    } catch {
      // Directory might already exist
    }
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      client_request TEXT NOT NULL,
      transformed_payload TEXT,
      destination_response TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_path ON logs(path);
    CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status_code);
  `);

  dbInstance = db;
  return dbInstance;
}

export function setDatabase(db: ReturnType<typeof Database>): void {
  dbInstance = db;
}

export function insertLog(log: LogRecord): LogRecord {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO logs (
      timestamp, method, path, status_code, latency_ms,
      client_request, transformed_payload, destination_response, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    log.timestamp,
    log.method,
    log.path,
    log.status_code,
    log.latency_ms,
    log.client_request,
    log.transformed_payload ?? null,
    log.destination_response ?? null,
    log.error ?? null,
  );

  return {
    ...log,
    id: Number(result.lastInsertRowid),
  };
}

export function getLogs(options: GetLogsOptions = {}): {
  logs: LogRecord[];
  total: number;
} {
  const db = getDatabase();
  const { limit = 50, offset = 0, search, method, status } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (method) {
    conditions.push("method = ?");
    params.push(method.toUpperCase());
  }

  if (status) {
    conditions.push("status_code = ?");
    params.push(status);
  }

  if (search) {
    conditions.push(
      "(path LIKE ? OR client_request LIKE ? OR transformed_payload LIKE ? OR error LIKE ?)",
    );
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM logs ${whereClause}`)
    .get(...params) as { count: number };
  const total = countRow ? countRow.count : 0;

  const logs = db
    .prepare(
      `
    SELECT * FROM logs
    ${whereClause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limit, offset) as LogRecord[];

  return { logs, total };
}

export function getLogById(id: number): LogRecord | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM logs WHERE id = ?").get(id);
  return (row as LogRecord) || null;
}

export function clearLogs(): void {
  const db = getDatabase();
  db.exec("DELETE FROM logs; VACUUM;");
}

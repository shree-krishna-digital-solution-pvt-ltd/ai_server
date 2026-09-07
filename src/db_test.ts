import { assertEquals, assertExists } from "@std/assert";
import Database from "better-sqlite3";
import {
  clearLogs,
  getLogById,
  getLogs,
  insertLog,
  setDatabase,
} from "./db.ts";

Deno.test("db operations", () => {
  // Use in-memory DB for tests
  const memDb = new Database(":memory:");
  memDb.exec(`
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
  `);
  setDatabase(memDb);

  // Test insert
  const inserted = insertLog({
    timestamp: new Date().toISOString(),
    method: "POST",
    path: "/z-image-turbo",
    status_code: 200,
    latency_ms: 1500,
    client_request: JSON.stringify({
      prompt: "Test prompt",
      width: 1024,
      height: 1024,
    }),
    transformed_payload: JSON.stringify({
      prompt: { "57:27": { inputs: { text: "Test prompt" } } },
    }),
    destination_response: JSON.stringify({ prompt_id: "xyz" }),
  });

  assertExists(inserted.id);
  assertEquals(inserted.method, "POST");

  // Test getLogById
  const fetched = getLogById(inserted.id);
  assertExists(fetched);
  assertEquals(fetched.path, "/z-image-turbo");

  // Test getLogs
  const result = getLogs({ limit: 10 });
  assertEquals(result.total, 1);
  assertEquals(result.logs.length, 1);

  // Test search filter
  const searchResult = getLogs({ search: "Test prompt" });
  assertEquals(searchResult.total, 1);

  const emptySearch = getLogs({ search: "nonexistent" });
  assertEquals(emptySearch.total, 0);

  // Test clearLogs
  clearLogs();
  const afterClear = getLogs();
  assertEquals(afterClear.total, 0);
});

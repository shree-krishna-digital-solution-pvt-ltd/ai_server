import { assertEquals, assertExists } from "@std/assert";
import Database from "better-sqlite3";
import { app } from "./src/app.ts";
import { config } from "./src/config.ts";
import { clearLogs, getLogs, setDatabase } from "./src/db.ts";

function getAuthHeader(): string {
  const token = btoa(`${config.adminUsername}:${config.adminPassword}`);
  return `Basic ${token}`;
}

Deno.test("Integration: Root redirect and Auth", async () => {
  // Set memory DB for tests
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
  clearLogs();

  // Test root redirect
  const rootRes = await app.request("/");
  assertEquals(rootRes.status, 302);
  assertEquals(rootRes.headers.get("location"), "/_dashboard");

  // Test dashboard without auth -> 401
  const unauthRes = await app.request("/_dashboard");
  assertEquals(unauthRes.status, 401);

  // Test dashboard with auth -> 200 OK and Set-Cookie
  const authRes = await app.request("/_dashboard", {
    headers: { Authorization: getAuthHeader() },
  });
  assertEquals(authRes.status, 200);
  const setCookie = authRes.headers.get("set-cookie");
  assertExists(setCookie);
  assertEquals(setCookie.includes("admin_session="), true);
  const html = await authRes.text();
  assertEquals(html.includes("AI Transformation Server"), true);

  // Test logs API with cookie
  const logsCookieRes = await app.request("/_api/logs", {
    headers: { Cookie: setCookie },
  });
  assertEquals(logsCookieRes.status, 200);
  const logsCookieData = await logsCookieRes.json();
  assertEquals(Array.isArray(logsCookieData.logs), true);

  // Test logs API with basic auth header
  const logsRes = await app.request("/_api/logs", {
    headers: { Authorization: getAuthHeader() },
  });
  assertEquals(logsRes.status, 200);
  const logsData = await logsRes.json();
  assertEquals(Array.isArray(logsData.logs), true);
});

Deno.test("Integration: /z-image-turbo validation error logging", async () => {
  clearLogs();

  // Test malformed request (missing prompt)
  const badRes = await app.request("/z-image-turbo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ width: 1024 }),
  });
  assertEquals(badRes.status, 400);

  // Verify error is recorded in SQLite log
  const { logs } = getLogs();
  assertEquals(logs.length, 1);
  assertEquals(logs[0].status_code, 400);
  assertEquals(logs[0].path, "/z-image-turbo");
  assertExists(logs[0].error);
});

Deno.test(
  "Integration: Full /z-image-turbo mock ComfyUI proxy flow",
  async () => {
    clearLogs();

    const mockImageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
    let mockPromptReceived: Record<string, unknown> | null = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(urlStr);

      if (url.pathname === "/prompt") {
        if (init?.body && typeof init.body === "string") {
          mockPromptReceived = JSON.parse(init.body);
        }
        return Response.json({
          prompt_id: "test-prompt-123",
          number: 1,
          node_errors: {},
        });
      }

      if (url.pathname === "/history/test-prompt-123") {
        return Response.json({
          "test-prompt-123": {
            status: { completed: true },
            outputs: {
              "9": {
                images: [
                  { filename: "output_001.png", subfolder: "", type: "output" },
                ],
              },
            },
          },
        });
      }

      if (url.pathname === "/view") {
        return new Response(mockImageBytes, {
          headers: { "Content-Type": "image/png" },
        });
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    try {
      const res = await app.request("/z-image-turbo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Sunset over futuristic city",
          width: 1024,
          height: 768,
        }),
      });

      assertEquals(res.status, 200);
      assertEquals(res.headers.get("Content-Type"), "image/png");
      const receivedBytes = new Uint8Array(await res.arrayBuffer());
      assertEquals(receivedBytes, mockImageBytes);

      // Verify mock prompt payload
      assertExists(mockPromptReceived);

      // Verify SQLite 3-way log record
      const { logs } = getLogs();
      assertEquals(logs.length, 1);
      const log = logs[0];
      assertEquals(log.status_code, 200);
      assertEquals(log.path, "/z-image-turbo");

      // 1. Client request
      const clientReq = JSON.parse(log.client_request);
      assertEquals(clientReq.prompt, "Sunset over futuristic city");

      // 2. Transformed ComfyUI payload
      assertExists(log.transformed_payload);
      const transformed = JSON.parse(log.transformed_payload);
      assertEquals(
        transformed["57:27"].inputs.text,
        "Sunset over futuristic city",
      );
      assertEquals(transformed["57:13"].inputs.width, 1024);
      assertEquals(transformed["57:13"].inputs.height, 768);

      // 3. Destination response
      assertExists(log.destination_response);
      const destRes = JSON.parse(log.destination_response);
      assertEquals(destRes.prompt_id, "test-prompt-123");
      assertEquals(destRes.filename, "output_001.png");

      // Test Replay API
      const replayRes = await app.request(`/_api/replay/${log.id}`, {
        method: "POST",
        headers: { Authorization: getAuthHeader() },
      });
      assertEquals(replayRes.status, 200);

      const afterReplay = getLogs();
      assertEquals(afterReplay.total, 2);

      // Test Clear Logs API
      const clearRes = await app.request("/_api/logs", {
        method: "DELETE",
        headers: { Authorization: getAuthHeader() },
      });
      assertEquals(clearRes.status, 200);
      assertEquals(getLogs().total, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

Deno.test("Integration: /flux validation error logging", async () => {
  clearLogs();

  // Test missing images
  const formData = new FormData();
  formData.append("prompt", "Some edit prompt");
  const badRes = await app.request("/flux", {
    method: "POST",
    body: formData,
  });
  assertEquals(badRes.status, 400);

  const { logs } = getLogs();
  assertEquals(logs.length, 1);
  assertEquals(logs[0].status_code, 400);
  assertEquals(logs[0].path, "/flux");
  assertExists(logs[0].error);
});

Deno.test("Integration: Full /flux 2-image upload and execution flow", async () => {
  clearLogs();

  const mockImageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const uploadedFilenames: string[] = [];
  let mockPromptReceived: Record<string, unknown> | null = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(urlStr);

    // 1. Mock /upload/image
    if (url.pathname === "/upload/image") {
      const uploadName = `uploaded_${uploadedFilenames.length + 1}.png`;
      uploadedFilenames.push(uploadName);
      return Response.json({
        name: uploadName,
        subfolder: "",
        type: "input",
      });
    }

    // 2. Mock /prompt
    if (url.pathname === "/prompt") {
      if (init?.body && typeof init.body === "string") {
        mockPromptReceived = JSON.parse(init.body);
      }
      return Response.json({
        prompt_id: "flux-prompt-456",
        number: 2,
        node_errors: {},
      });
    }

    // 3. Mock /history
    if (url.pathname === "/history/flux-prompt-456") {
      return Response.json({
        "flux-prompt-456": {
          status: { completed: true },
          outputs: {
            "94": {
              images: [
                { filename: "flux_output.png", subfolder: "", type: "output" },
              ],
            },
          },
        },
      });
    }

    // 4. Mock /view
    if (url.pathname === "/view") {
      return new Response(mockImageBytes, {
        headers: { "Content-Type": "image/png" },
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const formData = new FormData();
    const blob1 = new Blob(["fake-image-1"], { type: "image/png" });
    const blob2 = new Blob(["fake-image-2"], { type: "image/png" });
    formData.append("image1", blob1, "portrait.png");
    formData.append("image2", blob2, "sunglasses.png");
    formData.append("prompt", "Wear stylish sunglasses");

    const res = await app.request("/flux", {
      method: "POST",
      body: formData,
    });

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "image/png");
    const receivedBytes = new Uint8Array(await res.arrayBuffer());
    assertEquals(receivedBytes, mockImageBytes);

    // Verify 2 images were uploaded
    assertEquals(uploadedFilenames.length, 2);

    // Verify prompt workflow structure
    assertExists(mockPromptReceived);
    const promptObj = (mockPromptReceived as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt;
    assertEquals(promptObj["76"].inputs.image, "uploaded_1.png");
    assertEquals(promptObj["81"].inputs.image, "uploaded_2.png");
    assertEquals(promptObj["92:113"].inputs.text, "Wear stylish sunglasses");

    // Verify SQLite 3-way log record
    const { logs } = getLogs();
    assertEquals(logs.length, 1);
    const log = logs[0];
    assertEquals(log.status_code, 200);
    assertEquals(log.path, "/flux");

    const clientReq = JSON.parse(log.client_request);
    assertEquals(clientReq.prompt, "Wear stylish sunglasses");
    assertEquals(clientReq.image1, "portrait.png");
    assertEquals(clientReq.image2, "sunglasses.png");

    const transformed = JSON.parse(log.transformed_payload!);
    assertEquals(transformed["76"].inputs.image, "uploaded_1.png");
    assertEquals(transformed["81"].inputs.image, "uploaded_2.png");

    const destRes = JSON.parse(log.destination_response!);
    assertEquals(destRes.prompt_id, "flux-prompt-456");
    assertEquals(destRes.filename, "flux_output.png");

    // Test Replay for Flux
    const replayRes = await app.request(`/_api/replay/${log.id}`, {
      method: "POST",
      headers: { Authorization: getAuthHeader() },
    });
    assertEquals(replayRes.status, 200);

    const afterReplay = getLogs();
    assertEquals(afterReplay.total, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


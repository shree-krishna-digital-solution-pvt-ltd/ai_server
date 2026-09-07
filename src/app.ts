import { Hono } from "@hono/hono";
import { streamSSE } from "@hono/hono/streaming";
import { config } from "./config.ts";
import { clearLogs, getLogById, getLogs, insertLog } from "./db.ts";
import { logEvents } from "./events.ts";
import { renderDashboardHtml } from "./dashboard.ts";
import { executeComfyUIWorkflowSync, uploadImageToComfyUI } from "./comfyui.ts";
import { transformZImageTurbo, type ZImageTurboInput } from "./transformer.ts";

import type { Context, Next } from "@hono/hono";

export const app = new Hono();

// Auth helper verifying Basic Auth header, cookie, or token
export function verifyCredentials(c: Context): boolean {
  const currentUsername =
    Deno.env.get("ADMIN_USERNAME") || config.adminUsername;
  const currentPassword =
    Deno.env.get("ADMIN_PASSWORD") || config.adminPassword;
  const expectedSession = btoa(`${currentUsername}:${currentPassword}`);

  // 1. Check Authorization: Basic header
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Basic ")) {
    try {
      const base64 = authHeader.slice(6).trim();
      const decoded = atob(base64);
      const colonIndex = decoded.indexOf(":");
      if (colonIndex !== -1) {
        const u = decoded.slice(0, colonIndex);
        const p = decoded.slice(colonIndex + 1);
        if (u === currentUsername && p === currentPassword) {
          return true;
        }
      }
    } catch {
      // ignore base64 decode failure
    }
  }

  // 2. Check admin_session cookie
  const cookieHeader = c.req.header("Cookie") || "";
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  if (match && match[1] === expectedSession) {
    return true;
  }

  // 3. Check query token (useful for EventSource / SSE)
  const queryToken = c.req.query("token");
  if (queryToken && queryToken === expectedSession) {
    return true;
  }

  return false;
}

// Auth middleware for admin dashboard and internal APIs
const authMiddleware = async (c: Context, next: Next) => {
  if (verifyCredentials(c)) {
    return await next();
  }

  c.header("WWW-Authenticate", 'Basic realm="AI Server Admin"');
  return c.text("Unauthorized", 401);
};

// Root route: redirect to dashboard
app.get("/", (c) => {
  return c.redirect("/_dashboard");
});

// Dashboard UI
app.get("/_dashboard", authMiddleware, (c) => {
  const currentUsername =
    Deno.env.get("ADMIN_USERNAME") || config.adminUsername;
  const currentPassword =
    Deno.env.get("ADMIN_PASSWORD") || config.adminPassword;
  const sessionToken = btoa(`${currentUsername}:${currentPassword}`);

  // Set session cookie so browser fetch and EventSource work seamlessly
  c.header("Set-Cookie", `admin_session=${sessionToken}; Path=/; SameSite=Lax`);
  const html = renderDashboardHtml(config.destinationServerUrl);
  return c.html(html);
});

// Internal API: Get logs
app.get("/_api/logs", authMiddleware, (c) => {
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const search = c.req.query("search") || undefined;
  const method = c.req.query("method") || undefined;
  const statusStr = c.req.query("status");
  const status = statusStr ? parseInt(statusStr, 10) : undefined;

  const result = getLogs({ limit, offset, search, method, status });
  return c.json(result);
});

// Internal API: Real-time SSE logs stream
app.get("/_api/events", authMiddleware, (c) => {
  return streamSSE(c, async (stream) => {
    const unsubscribe = logEvents.subscribe(async (logData) => {
      await stream.writeSSE({
        data: JSON.stringify(logData),
        event: "message",
      });
    });

    // Keep connection alive with periodic pings
    const interval = setInterval(async () => {
      try {
        await stream.writeSSE({ event: "ping", data: "" });
      } catch {
        clearInterval(interval);
      }
    }, 15000);

    stream.onAbort(() => {
      clearInterval(interval);
      unsubscribe();
    });

    // Wait until abort
    while (!stream.aborted) {
      await stream.sleep(1000);
    }
  });
});

// Internal API: Clear logs
app.delete("/_api/logs", authMiddleware, (c) => {
  clearLogs();
  return c.json({ success: true });
});

// Internal API: Replay a logged request
app.post("/_api/replay/:id", authMiddleware, async (c) => {
  const paramId = c.req.param("id");
  const id = parseInt(paramId || "0", 10);
  const logRecord = getLogById(id);

  if (!logRecord) {
    return c.json({ error: "Log record not found" }, 404);
  }

  let clientPayload: Record<string, unknown> = {};
  try {
    clientPayload = JSON.parse(logRecord.client_request);
  } catch {
    return c.json({ error: "Invalid client request JSON stored in log" }, 400);
  }

  // If path is /z-image-turbo, replay via internal logic
  if (logRecord.path === "/z-image-turbo") {
    try {
      const { workflowJson, rawJsonString } = transformZImageTurbo(
        clientPayload as unknown as ZImageTurboInput,
      );
      const execution = await executeComfyUIWorkflowSync(
        config.destinationServerUrl,
        workflowJson,
      );

      const newLog = insertLog({
        timestamp: new Date().toISOString(),
        method: "POST",
        path: "/z-image-turbo",
        status_code: 200,
        latency_ms: execution.durationMs,
        client_request: JSON.stringify(clientPayload),
        transformed_payload: rawJsonString,
        destination_response: JSON.stringify({
          prompt_id: execution.promptId,
          filename: execution.filename,
          subfolder: execution.subfolder,
        }),
      });

      logEvents.publish(newLog);

      return c.json({
        message: "Replay successful",
        newLogId: newLog.id,
        promptId: execution.promptId,
      });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Replay execution failed: ${errMessage}` }, 500);
    }
  }

  return c.json(
    { error: `Replay not supported for path ${logRecord.path}` },
    400,
  );
});

// Primary Endpoint: /z-image-turbo (Accepts JSON, executes ComfyUI, streams raw image binary)
app.post("/z-image-turbo", async (c) => {
  const start = Date.now();
  let clientPayload: ZImageTurboInput = { prompt: "" };
  let rawBodyText = "";

  try {
    rawBodyText = await c.req.text();
    clientPayload = JSON.parse(rawBodyText || "{}");
  } catch {
    const latency = Date.now() - start;
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/z-image-turbo",
      status_code: 400,
      latency_ms: latency,
      client_request: rawBodyText || "{}",
      error: "Malformed JSON payload",
    });
    logEvents.publish(log);
    return c.json({ error: "Invalid JSON in request body" }, 400);
  }

  if (!clientPayload.prompt || typeof clientPayload.prompt !== "string") {
    const latency = Date.now() - start;
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/z-image-turbo",
      status_code: 400,
      latency_ms: latency,
      client_request: JSON.stringify(clientPayload),
      error: "Missing required 'prompt' string field in request body",
    });
    logEvents.publish(log);
    return c.json(
      { error: "Missing required 'prompt' field in request body" },
      400,
    );
  }

  let transformed: ReturnType<typeof transformZImageTurbo>;
  try {
    transformed = transformZImageTurbo(clientPayload);
  } catch (err) {
    const latency = Date.now() - start;
    const errMessage = err instanceof Error ? err.message : String(err);
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/z-image-turbo",
      status_code: 500,
      latency_ms: latency,
      client_request: JSON.stringify(clientPayload),
      error: `Template transformation failed: ${errMessage}`,
    });
    logEvents.publish(log);
    return c.json({ error: `Transformation failed: ${errMessage}` }, 500);
  }

  try {
    const execution = await executeComfyUIWorkflowSync(
      config.destinationServerUrl,
      transformed.workflowJson,
    );

    const latency = Date.now() - start;
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/z-image-turbo",
      status_code: 200,
      latency_ms: latency,
      client_request: JSON.stringify(clientPayload),
      transformed_payload: transformed.rawJsonString,
      destination_response: JSON.stringify({
        prompt_id: execution.promptId,
        filename: execution.filename,
        subfolder: execution.subfolder,
        content_type: execution.contentType,
        image_bytes: execution.imageBytes.byteLength,
      }),
    });
    logEvents.publish(log);

    return new Response(execution.imageBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": execution.contentType || "image/png",
        "Content-Disposition": `inline; filename="${execution.filename}"`,
        "X-ComfyUI-Prompt-Id": execution.promptId,
        "X-Latency-Ms": String(latency),
      },
    });
  } catch (err) {
    const latency = Date.now() - start;
    const errMessage = err instanceof Error ? err.message : String(err);
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/z-image-turbo",
      status_code: 500,
      latency_ms: latency,
      client_request: JSON.stringify(clientPayload),
      transformed_payload: transformed.rawJsonString,
      error: `ComfyUI execution error: ${errMessage}`,
    });
    logEvents.publish(log);
    return c.json({ error: `ComfyUI execution error: ${errMessage}` }, 500);
  }
});

// Flux Route (Accepts multipart images, forwards to ComfyUI /upload/image)
app.post("/flux", async (c) => {
  const start = Date.now();
  try {
    const body = await c.req.parseBody();
    const uploadedImages: string[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value instanceof File) {
        const fileBytes = new Uint8Array(await value.arrayBuffer());
        const uploadRes = await uploadImageToComfyUI(
          config.destinationServerUrl,
          fileBytes,
          value.name || `${key}.png`,
        );
        uploadedImages.push(uploadRes.name);
      }
    }

    const latency = Date.now() - start;
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/flux",
      status_code: 200,
      latency_ms: latency,
      client_request: JSON.stringify({
        uploadedImagesCount: uploadedImages.length,
      }),
      destination_response: JSON.stringify({ uploadedImages }),
    });
    logEvents.publish(log);

    return c.json({
      message:
        "Flux route placeholder: images uploaded to destination server successfully",
      uploaded: uploadedImages,
    });
  } catch (err) {
    const latency = Date.now() - start;
    const errMessage = err instanceof Error ? err.message : String(err);
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/flux",
      status_code: 500,
      latency_ms: latency,
      client_request: "multipart/form-data",
      error: errMessage,
    });
    logEvents.publish(log);
    return c.json({ error: errMessage }, 500);
  }
});

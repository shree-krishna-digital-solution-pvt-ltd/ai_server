import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { streamSSE } from "@hono/hono/streaming";
import { config } from "./config.ts";
import { clearLogs, getLogById, getLogs, insertLog } from "./db.ts";
import { logEvents } from "./events.ts";
import { renderDashboardHtml } from "./dashboard.ts";
import { executeComfyUIWorkflowSync, uploadImageToComfyUI } from "./comfyui.ts";
import {
  transformFluxImageEdit,
  transformZImageTurbo,
  type FluxImageEditInput,
  type ZImageTurboInput,
} from "./transformer.ts";

import type { Context, Next } from "@hono/hono";

export const app = new Hono();

// Enable CORS for any origin
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
    exposeHeaders: [
      "Content-Length",
      "Content-Disposition",
      "X-ComfyUI-Prompt-Id",
      "X-Latency-Ms",
    ],
  }),
);

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

  // If path is /flux, replay via internal logic
  if (logRecord.path === "/flux") {
    try {
      const image1Name = (clientPayload.uploaded as string[])?.[0] || (clientPayload.image1 as string) || "";
      const image2Name = (clientPayload.uploaded as string[])?.[1] || (clientPayload.image2 as string) || "";
      const prompt = (clientPayload.prompt as string) || "";
      const seed = typeof clientPayload.seed === "number" ? clientPayload.seed : undefined;

      if (!image1Name || !image2Name || !prompt) {
        return c.json({ error: "Missing image references or prompt in stored flux log" }, 400);
      }

      const { workflowJson, rawJsonString } = transformFluxImageEdit({
        image1: image1Name,
        image2: image2Name,
        prompt,
        seed,
      });

      const execution = await executeComfyUIWorkflowSync(
        config.destinationServerUrl,
        workflowJson,
      );

      const newLog = insertLog({
        timestamp: new Date().toISOString(),
        method: "POST",
        path: "/flux",
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

// Flux Route: Accepts multipart 2 images + prompt, uploads to ComfyUI, executes Flux workflow, returns image binary
app.post("/flux", async (c) => {
  const start = Date.now();
  let body: Record<string, unknown> = {};

  try {
    body = await c.req.parseBody();
  } catch (err) {
    const latency = Date.now() - start;
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/flux",
      status_code: 400,
      latency_ms: latency,
      client_request: "multipart/form-data (parse error)",
      error: `Failed to parse form-data: ${err}`,
    });
    logEvents.publish(log);
    return c.json({ error: "Invalid multipart form data" }, 400);
  }

  // Extract images
  let file1: File | null = null;
  let file2: File | null = null;

  if (body["image1"] instanceof File) file1 = body["image1"];
  else if (body["image_1"] instanceof File) file1 = body["image_1"];
  else if (body["image"] instanceof File) file1 = body["image"];

  if (body["image2"] instanceof File) file2 = body["image2"];
  else if (body["image_2"] instanceof File) file2 = body["image_2"];

  // If named differently, search for any two file fields
  if (!file1 || !file2) {
    const files: File[] = [];
    for (const val of Object.values(body)) {
      if (val instanceof File) files.push(val);
    }
    if (files.length >= 2) {
      file1 = files[0];
      file2 = files[1];
    }
  }

  const prompt = typeof body["prompt"] === "string" ? body["prompt"] : typeof body["text"] === "string" ? body["text"] : "";
  const seedNum = typeof body["seed"] === "string" ? parseInt(body["seed"], 10) : typeof body["seed"] === "number" ? body["seed"] : undefined;

  if (!file1 || !file2) {
    const latency = Date.now() - start;
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/flux",
      status_code: 400,
      latency_ms: latency,
      client_request: JSON.stringify({ prompt, filesReceived: file1 ? 1 : 0 }),
      error: "The /flux endpoint requires 2 image files (e.g. image1 and image2)",
    });
    logEvents.publish(log);
    return c.json(
      { error: "The /flux endpoint requires 2 image files (image1 and image2)" },
      400,
    );
  }

  if (!prompt) {
    const latency = Date.now() - start;
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/flux",
      status_code: 400,
      latency_ms: latency,
      client_request: JSON.stringify({ image1: file1.name, image2: file2.name }),
      error: "Missing required 'prompt' field in form data",
    });
    logEvents.publish(log);
    return c.json({ error: "Missing required 'prompt' field in form data" }, 400);
  }

  // 1. Upload both images to ComfyUI /upload/image
  let upload1: Awaited<ReturnType<typeof uploadImageToComfyUI>>;
  let upload2: Awaited<ReturnType<typeof uploadImageToComfyUI>>;

  try {
    const fileBytes1 = new Uint8Array(await file1.arrayBuffer());
    upload1 = await uploadImageToComfyUI(
      config.destinationServerUrl,
      fileBytes1,
      file1.name || "reference_image1.png",
    );

    const fileBytes2 = new Uint8Array(await file2.arrayBuffer());
    upload2 = await uploadImageToComfyUI(
      config.destinationServerUrl,
      fileBytes2,
      file2.name || "reference_image2.png",
    );
  } catch (err) {
    const latency = Date.now() - start;
    const errMessage = err instanceof Error ? err.message : String(err);
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/flux",
      status_code: 500,
      latency_ms: latency,
      client_request: JSON.stringify({
        prompt,
        image1: file1.name,
        image2: file2.name,
      }),
      error: `Failed to upload images to ComfyUI: ${errMessage}`,
    });
    logEvents.publish(log);
    return c.json({ error: `Image upload failed: ${errMessage}` }, 500);
  }

  // 2. Transform Flux workflow template
  let transformed: ReturnType<typeof transformFluxImageEdit>;
  try {
    transformed = transformFluxImageEdit({
      image1: upload1.name,
      image2: upload2.name,
      prompt,
      seed: seedNum,
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
      client_request: JSON.stringify({
        prompt,
        image1: file1.name,
        image2: file2.name,
        uploaded: [upload1.name, upload2.name],
      }),
      error: `Flux template transformation error: ${errMessage}`,
    });
    logEvents.publish(log);
    return c.json({ error: `Transformation error: ${errMessage}` }, 500);
  }

  // 3. Execute ComfyUI workflow synchronously
  try {
    const execution = await executeComfyUIWorkflowSync(
      config.destinationServerUrl,
      transformed.workflowJson,
    );

    const latency = Date.now() - start;
    const log = insertLog({
      timestamp: new Date().toISOString(),
      method: "POST",
      path: "/flux",
      status_code: 200,
      latency_ms: latency,
      client_request: JSON.stringify({
        prompt,
        image1: file1.name,
        image2: file2.name,
        uploaded: [upload1.name, upload2.name],
        seed: transformed.seed,
      }),
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
      path: "/flux",
      status_code: 500,
      latency_ms: latency,
      client_request: JSON.stringify({
        prompt,
        image1: file1.name,
        image2: file2.name,
        uploaded: [upload1.name, upload2.name],
      }),
      transformed_payload: transformed.rawJsonString,
      error: `ComfyUI execution error: ${errMessage}`,
    });
    logEvents.publish(log);
    return c.json({ error: `ComfyUI execution error: ${errMessage}` }, 500);
  }
});

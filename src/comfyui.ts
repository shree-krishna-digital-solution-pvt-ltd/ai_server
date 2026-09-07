// ComfyUI integration: prompt execution, WebSocket tracking, image retrieval, and upload

export interface ExecutionResult {
  imageBytes: Uint8Array;
  contentType: string;
  filename: string;
  subfolder: string;
  promptId: string;
  durationMs: number;
}

export interface UploadResult {
  name: string;
  subfolder: string;
  type: string;
}

/**
 * Generate a random UUID-like client ID for ComfyUI.
 */
export function generateClientId(): string {
  return crypto.randomUUID();
}

/**
 * Convert an HTTP base URL to a WebSocket URL.
 */
export function toWsUrl(httpUrl: string, clientId: string): string {
  const url = new URL(httpUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const basePath = url.pathname.replace(/\/$/, "");
  return `${protocol}//${url.host}${basePath}/ws?clientId=${clientId}`;
}

/**
 * Upload an image file to ComfyUI's /upload/image endpoint.
 */
export async function uploadImageToComfyUI(
  baseUrl: string,
  fileBytes: Uint8Array,
  filename: string,
  subfolder = "",
): Promise<UploadResult> {
  const formData = new FormData();
  const blob = new Blob([fileBytes.buffer as ArrayBuffer], { type: "image/png" });
  formData.append("image", blob, filename);
  formData.append("overwrite", "true");
  if (subfolder) {
    formData.append("subfolder", subfolder);
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/upload/image`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ComfyUI upload failed (${res.status}): ${errText}`);
  }

  return (await res.json()) as UploadResult;
}

/**
 * Poll ComfyUI /history endpoint until prompt_id output is available.
 */
export async function pollPromptHistory(
  baseUrl: string,
  promptId: string,
  maxWaitMs = 180000,
  pollIntervalMs = 500,
): Promise<{ filename: string; subfolder: string; type: string }> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/history/${promptId}`);
      if (res.ok) {
        const history = await res.json();
        const promptData = history[promptId];
        if (promptData && promptData.outputs) {
          // Check status / outputs
          for (const nodeId of Object.keys(promptData.outputs)) {
            const nodeOutput = promptData.outputs[nodeId];
            if (nodeOutput && Array.isArray(nodeOutput.images) && nodeOutput.images.length > 0) {
              const img = nodeOutput.images[0];
              return {
                filename: img.filename,
                subfolder: img.subfolder || "",
                type: img.type || "output",
              };
            }
          }
        }
      }
    } catch {
      // Continue polling on transient connection hiccups
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timeout waiting for ComfyUI prompt ${promptId} to complete`);
}

/**
 * Await prompt completion using WebSocket with automatic fallback to polling.
 */
export async function waitForPromptCompletion(
  baseUrl: string,
  clientId: string,
  promptId: string,
  timeoutMs = 180000,
): Promise<{ filename: string; subfolder: string; type: string }> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const wsUrl = toWsUrl(baseUrl, clientId);
    let ws: WebSocket | null = null;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        if (ws) {
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
        // Attempt final history check before failing
        pollPromptHistory(baseUrl, promptId, 5000)
          .then(resolve)
          .catch(() => reject(new Error(`Timed out waiting for prompt execution: ${promptId}`)));
      }
    }, timeoutMs);

    try {
      ws = new WebSocket(wsUrl);

      ws.onmessage = async (event) => {
        if (finished) return;
        try {
          if (typeof event.data === "string") {
            const msg = JSON.parse(event.data);
            if (msg.type === "executing" && msg.data?.node === null && msg.data?.prompt_id === promptId) {
              finished = true;
              clearTimeout(timer);
              try {
                ws?.close();
              } catch {
                // ignore
              }
              const img = await pollPromptHistory(baseUrl, promptId, 10000);
              resolve(img);
            } else if (msg.type === "execution_error" && msg.data?.prompt_id === promptId) {
              finished = true;
              clearTimeout(timer);
              try {
                ws?.close();
              } catch {
                // ignore
              }
              reject(new Error(`ComfyUI execution error: ${JSON.stringify(msg.data)}`));
            }
          }
        } catch (err) {
          console.error("Error parsing ComfyUI WS message:", err);
        }
      };

      ws.onerror = () => {
        // Fallback to polling if WebSocket fails
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          pollPromptHistory(baseUrl, promptId, timeoutMs)
            .then(resolve)
            .catch(reject);
        }
      };
    } catch {
      // If WebSocket connection throws immediately, fallback to polling
      pollPromptHistory(baseUrl, promptId, timeoutMs)
        .then(resolve)
        .catch(reject);
    }
  });
}

/**
 * Fetch raw image binary from ComfyUI /view endpoint.
 */
export async function fetchComfyUIImage(
  baseUrl: string,
  filename: string,
  subfolder = "",
  type = "output",
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const params = new URLSearchParams({ filename, subfolder, type });
  const viewUrl = `${baseUrl.replace(/\/$/, "")}/view?${params.toString()}`;

  const res = await fetch(viewUrl);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to download image from ComfyUI (${res.status}): ${err}`);
  }

  const contentType = res.headers.get("content-type") || "image/png";
  const arrayBuffer = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(arrayBuffer),
    contentType,
  };
}

/**
 * Submit workflow to ComfyUI, await execution, and return image bytes.
 */
export async function executeComfyUIWorkflowSync(
  baseUrl: string,
  workflowJson: Record<string, unknown>,
  timeoutMs = 180000,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const clientId = generateClientId();

  // 1. Submit prompt
  const promptRes = await fetch(`${baseUrl.replace(/\/$/, "")}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflowJson,
      client_id: clientId,
    }),
  });

  if (!promptRes.ok) {
    const errText = await promptRes.text();
    throw new Error(`ComfyUI /prompt request failed (${promptRes.status}): ${errText}`);
  }

  const promptResponseJson = await promptRes.json();
  const promptId = promptResponseJson.prompt_id;

  if (!promptId) {
    throw new Error(
      `ComfyUI response missing prompt_id: ${JSON.stringify(promptResponseJson)}`,
    );
  }

  if (promptResponseJson.node_errors && Object.keys(promptResponseJson.node_errors).length > 0) {
    throw new Error(
      `ComfyUI node validation errors: ${JSON.stringify(promptResponseJson.node_errors)}`,
    );
  }

  // 2. Wait for completion
  const imageInfo = await waitForPromptCompletion(baseUrl, clientId, promptId, timeoutMs);

  // 3. Download image
  const { bytes, contentType } = await fetchComfyUIImage(
    baseUrl,
    imageInfo.filename,
    imageInfo.subfolder,
    imageInfo.type,
  );

  const durationMs = Date.now() - startTime;

  return {
    imageBytes: bytes,
    contentType,
    filename: imageInfo.filename,
    subfolder: imageInfo.subfolder,
    promptId,
    durationMs,
  };
}

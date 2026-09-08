# ComfyUI Transformation Server & Dashboard

A Hono-based HTTP proxy server that receives client image generation requests, transforms them into parameterized ComfyUI workflow payloads (such as `z-image-turbo`), forwards them to a remote ComfyUI destination server, awaits the generated image output, and returns raw binary image streams to clients while recording full request/response logs in an embedded SQLite database with a password-protected Bootstrap dashboard for real-time monitoring.

## Language

### Core Components

**Transformation Server**:
The local Hono HTTP server that intercepts incoming image generation requests, applies workflow transformations, logs the transactions, and forwards requests to the Destination Server.
_Avoid_: Gateway, middleman, backend daemon

**Destination Server**:
The remote ComfyUI server instance (configured via base URL / domain in `.env`) that executes generation workflows (`/prompt`, `/ws`, `/view`, `/history`) and accepts image uploads (`/upload/image`).
_Avoid_: Upstream host, origin server, worker node

**Workflow Template**:
A base ComfyUI node graph JSON structure (e.g., `image_z_image_turbo.json`) containing parameterized node inputs (prompt text, seed, dimensions, sampler settings).
_Avoid_: Pipeline config, prompt script, graph definition

**API Call Log**:
A persistent SQLite record containing incoming client request data, the transformed ComfyUI payload, destination server execution details/responses, total latency, and status codes.
_Avoid_: Audit trail, access log, request history

**Dashboard**:
The password-protected Bootstrap web interface served at `/_dashboard` for viewing, searching, and streaming live API Call Logs.
_Avoid_: Admin console, viewer

### Routes & Endpoints

**`z-image-turbo` Route**:
The endpoint (`/z-image-turbo`) accepting `{ prompt, width, height }`, parameterizing the `z-image-turbo` workflow template, submitting to ComfyUI, awaiting completion, and returning raw binary image data (`image/png`).

**`flux` Route**:
The endpoint (`/flux`) accepting 2 image files (`image1`, `image2`) and a `prompt` via multipart form-data, uploading the images to ComfyUI (`/upload/image`), parameterizing the `flux_image_edit.json` workflow template, awaiting execution, and returning the edited image binary (`image/png`).

### Operations & Behaviors

**Synchronous ComfyUI Execution**:
Submitting a prompt workflow to ComfyUI with a unique `client_id`, awaiting output completion via WebSocket/History API, and streaming the generated image binary directly to the client.
_Avoid_: Async queue polling, fire-and-forget

**3-Way Payload Logging**:
Persisting the exact incoming client request, the transformed ComfyUI prompt JSON, and the final response payload into SQLite for complete traceability.
_Avoid_: Standard access logging

// Bootstrap 5 Dashboard HTML Generator

export function renderDashboardHtml(destinationUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-bs-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Server — API Call Logs</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <style>
    :root {
      --bg-surface: #1e1e2d;
      --bg-surface-secondary: #27293d;
      --border-color: #343a40;
    }
    body {
      background-color: #12121a;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #e2e8f0;
    }
    .navbar-custom {
      background-color: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
    }
    .card-custom {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 0.75rem;
    }
    .table-custom {
      --bs-table-bg: transparent;
      --bs-table-hover-bg: rgba(255, 255, 255, 0.04);
      vertical-align: middle;
    }
    .table-custom th {
      border-bottom: 2px solid var(--border-color);
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    .badge-method {
      font-weight: 700;
      font-size: 0.75rem;
      padding: 0.35rem 0.6rem;
      border-radius: 0.375rem;
    }
    .method-POST { background-color: #3b82f6; color: #fff; }
    .method-GET { background-color: #10b981; color: #fff; }
    .method-DELETE { background-color: #ef4444; color: #fff; }
    .method-PUT { background-color: #f59e0b; color: #fff; }
    .json-viewer {
      background-color: #0d1117;
      border: 1px solid #30363d;
      border-radius: 0.5rem;
      padding: 1rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      max-height: 480px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #7ee787;
    }
    .new-row-highlight {
      animation: highlightFade 2.5s ease-out;
    }
    @keyframes highlightFade {
      0% { background-color: rgba(59, 130, 246, 0.3); }
      100% { background-color: transparent; }
    }
    .live-dot {
      width: 8px;
      height: 8px;
      background-color: #10b981;
      border-radius: 50%;
      display: inline-block;
      margin-right: 6px;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.4; }
      100% { opacity: 1; }
    }
  </style>
</head>
<body>

  <!-- Top Navbar -->
  <nav class="navbar navbar-expand-lg navbar-custom sticky-top py-3">
    <div class="container-fluid px-4">
      <a class="navbar-brand d-flex align-items-center gap-2 text-white fw-bold" href="#">
        <i class="bi bi-cpu text-primary fs-4"></i>
        <span>AI Transformation Server</span>
      </a>

      <div class="d-flex align-items-center gap-3 ms-auto">
        <span class="badge bg-dark border border-secondary text-secondary-emphasis d-flex align-items-center px-3 py-2">
          <span class="live-dot"></span>
          <span id="sseStatus">Live Stream Connected</span>
        </span>
        <span class="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle px-3 py-2">
          <i class="bi bi-hdd-network me-1"></i>
          Dest: <code class="text-info">${destinationUrl}</code>
        </span>
        <button class="btn btn-outline-danger btn-sm px-3" onclick="confirmClearLogs()">
          <i class="bi bi-trash3 me-1"></i> Clear Logs
        </button>
      </div>
    </div>
  </nav>

  <!-- Main Container -->
  <div class="container-fluid px-4 py-4">

    <!-- Metrics and Filters Card -->
    <div class="card card-custom mb-4 shadow-sm">
      <div class="card-body p-4">
        <div class="row g-3 align-items-center">
          <div class="col-md-5">
            <div class="input-group">
              <span class="input-group-text bg-dark border-secondary text-secondary">
                <i class="bi bi-search"></i>
              </span>
              <input type="text" id="searchInput" class="form-control bg-dark border-secondary text-white" placeholder="Search by path, prompt text, status or error...">
            </div>
          </div>
          <div class="col-md-3">
            <select id="methodFilter" class="form-select bg-dark border-secondary text-white">
              <option value="">All Methods</option>
              <option value="POST">POST</option>
              <option value="GET">GET</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div class="col-md-2">
            <select id="statusFilter" class="form-select bg-dark border-secondary text-white">
              <option value="">All Statuses</option>
              <option value="200">200 OK</option>
              <option value="400">400 Bad Request</option>
              <option value="500">500 Server Error</option>
            </select>
          </div>
          <div class="col-md-2 d-flex justify-content-end gap-2">
            <button class="btn btn-outline-primary w-100" onclick="fetchLogs()">
              <i class="bi bi-arrow-clockwise me-1"></i> Refresh
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Logs Table Card -->
    <div class="card card-custom shadow-sm">
      <div class="card-header bg-transparent border-bottom border-secondary d-flex justify-content-between align-items-center py-3">
        <div class="fw-semibold text-white d-flex align-items-center gap-2">
          <i class="bi bi-list-columns-reverse text-info"></i>
          <span>Recent API Call Logs</span>
          <span class="badge bg-primary rounded-pill ms-2" id="logCountBadge">0</span>
        </div>
        <div class="form-check form-switch text-secondary small">
          <input class="form-check-input" type="checkbox" role="switch" id="autoScrollSwitch" checked>
          <label class="form-check-label" for="autoScrollSwitch">Auto-prepend new requests</label>
        </div>
      </div>
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-custom table-hover mb-0">
            <thead>
              <tr>
                <th style="width: 80px;">ID</th>
                <th style="width: 170px;">Timestamp</th>
                <th style="width: 90px;">Method</th>
                <th style="width: 180px;">Path</th>
                <th style="width: 110px;">Status</th>
                <th style="width: 110px;">Duration</th>
                <th>Prompt / Request Summary</th>
                <th style="width: 160px;" class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody id="logsTableBody">
              <tr>
                <td colspan="8" class="text-center py-5 text-secondary">
                  <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                  Loading logs...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- 3-Way Payload Inspector Modal -->
  <div class="modal fade" id="payloadModal" tabindex="-1" aria-labelledby="payloadModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-xl modal-dialog-scrollable">
      <div class="modal-content bg-dark border-secondary">
        <div class="modal-header border-secondary">
          <div class="d-flex align-items-center gap-2">
            <span id="modalMethodBadge" class="badge badge-method method-POST">POST</span>
            <h5 class="modal-title text-white fw-bold mb-0" id="modalTitle">Request #0</h5>
            <span id="modalStatusBadge" class="badge bg-success ms-2">200 OK</span>
            <span id="modalDurationBadge" class="badge bg-secondary ms-1">1200ms</span>
          </div>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body p-4">
          <ul class="nav nav-pills mb-3 gap-2" id="pills-tab" role="tablist">
            <li class="nav-item" role="presentation">
              <button class="nav-link active rounded-pill px-4" id="pills-client-tab" data-bs-toggle="pill" data-bs-target="#pills-client" type="button" role="tab">
                <i class="bi bi-box-arrow-in-right me-1"></i> 1. Incoming Request
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link rounded-pill px-4" id="pills-transformed-tab" data-bs-toggle="pill" data-bs-target="#pills-transformed" type="button" role="tab">
                <i class="bi bi-diagram-3 me-1"></i> 2. Transformed ComfyUI Workflow
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link rounded-pill px-4" id="pills-dest-tab" data-bs-toggle="pill" data-bs-target="#pills-dest" type="button" role="tab">
                <i class="bi bi-box-arrow-up-right me-1"></i> 3. Destination Response
              </button>
            </li>
          </ul>

          <div class="tab-content" id="pills-tabContent">
            <!-- Incoming Request Tab -->
            <div class="tab-pane fade show active" id="pills-client" role="tabpanel">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="text-secondary small fw-semibold">Incoming HTTP Payload from Client</span>
                <button class="btn btn-sm btn-outline-secondary" onclick="copyTabContent('clientRequestJson')">
                  <i class="bi bi-clipboard"></i> Copy JSON
                </button>
              </div>
              <pre class="json-viewer" id="clientRequestJson">{}</pre>
            </div>

            <!-- Transformed Payload Tab -->
            <div class="tab-pane fade" id="pills-transformed" role="tabpanel">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="text-secondary small fw-semibold">Transformed ComfyUI Node Graph Sent to Destination</span>
                <button class="btn btn-sm btn-outline-secondary" onclick="copyTabContent('transformedPayloadJson')">
                  <i class="bi bi-clipboard"></i> Copy Workflow
                </button>
              </div>
              <pre class="json-viewer" id="transformedPayloadJson">{}</pre>
            </div>

            <!-- Destination Response Tab -->
            <div class="tab-pane fade" id="pills-dest" role="tabpanel">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="text-secondary small fw-semibold">Destination Execution Response & Artifacts</span>
                <button class="btn btn-sm btn-outline-secondary" onclick="copyTabContent('destinationResponseJson')">
                  <i class="bi bi-clipboard"></i> Copy Response
                </button>
              </div>
              <pre class="json-viewer" id="destinationResponseJson">{}</pre>
            </div>
          </div>
        </div>
        <div class="modal-footer border-secondary">
          <button type="button" class="btn btn-outline-warning" id="modalReplayBtn">
            <i class="bi bi-arrow-repeat me-1"></i> Replay This Request
          </button>
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    let currentLogs = [];
    let payloadModalInstance = null;
    let selectedLog = null;

    document.addEventListener("DOMContentLoaded", () => {
      payloadModalInstance = new bootstrap.Modal(document.getElementById("payloadModal"));
      fetchLogs();
      initSSE();

      document.getElementById("searchInput").addEventListener("input", debounce(fetchLogs, 300));
      document.getElementById("methodFilter").addEventListener("change", fetchLogs);
      document.getElementById("statusFilter").addEventListener("change", fetchLogs);
    });

    function debounce(func, wait) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    async function fetchLogs() {
      const search = document.getElementById("searchInput").value.trim();
      const method = document.getElementById("methodFilter").value;
      const status = document.getElementById("statusFilter").value;

      const params = new URLSearchParams({ limit: "100" });
      if (search) params.append("search", search);
      if (method) params.append("method", method);
      if (status) params.append("status", status);

      try {
        const res = await fetch(\`/_api/logs?\${params.toString()}\`);
        if (res.ok) {
          const data = await res.json();
          currentLogs = data.logs || [];
          document.getElementById("logCountBadge").textContent = data.total || currentLogs.length;
          renderTable(currentLogs);
        }
      } catch (err) {
        console.error("Error fetching logs:", err);
      }
    }

    function renderTable(logs, isNewPrepend = false) {
      const tbody = document.getElementById("logsTableBody");
      if (!logs || logs.length === 0) {
        tbody.innerHTML = \`
          <tr>
            <td colspan="8" class="text-center py-5 text-secondary">
              <i class="bi bi-inbox fs-2 d-block mb-2 text-secondary opacity-50"></i>
              No logs found matching your criteria.
            </td>
          </tr>\`;
        return;
      }

      tbody.innerHTML = logs.map(log => createRowHtml(log)).join("");
    }

    function createRowHtml(log, isHighlight = false) {
      let clientReq = {};
      try { clientReq = JSON.parse(log.client_request || "{}"); } catch {}

      const promptText = clientReq.prompt || clientReq.text || (log.error ? \`<span class="text-danger">Error: \${log.error}</span>\` : "-");
      const statusClass = log.status_code >= 200 && log.status_code < 300 ? "bg-success" : (log.status_code >= 400 && log.status_code < 500 ? "bg-warning text-dark" : "bg-danger");
      const methodClass = \`method-\${log.method}\`;

      const timeFormatted = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });

      return \`
        <tr id="log-row-\${log.id}" class="\${isHighlight ? 'new-row-highlight' : ''}">
          <td class="text-secondary fw-semibold">#\${log.id}</td>
          <td class="small text-secondary">\${timeFormatted}</td>
          <td><span class="badge badge-method \${methodClass}">\${log.method}</span></td>
          <td><code class="text-info">\${log.path}</code></td>
          <td><span class="badge \${statusClass}">\${log.status_code}</span></td>
          <td><span class="text-secondary small">\${log.latency_ms} ms</span></td>
          <td class="text-truncate" style="max-width: 320px;" title="\${escapeHtml(typeof promptText === 'string' ? promptText : JSON.stringify(promptText))}">
            \${typeof promptText === 'string' ? escapeHtml(promptText) : escapeHtml(JSON.stringify(promptText))}
          </td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-info me-1" onclick="inspectLog(\${log.id})">
              <i class="bi bi-search"></i> Inspect
            </button>
            <button class="btn btn-sm btn-outline-warning" onclick="replayLog(\${log.id})" title="Replay">
              <i class="bi bi-play-fill"></i>
            </button>
          </td>
        </tr>
      \`;
    }

    function initSSE() {
      const sseStatus = document.getElementById("sseStatus");
      const eventSource = new EventSource("/_api/events");

      eventSource.onopen = () => {
        sseStatus.textContent = "Live Stream Connected";
        sseStatus.parentElement.classList.remove("text-danger");
      };

      eventSource.onmessage = (e) => {
        try {
          const newLog = JSON.parse(e.data);
          const autoPrepend = document.getElementById("autoScrollSwitch").checked;

          if (autoPrepend) {
            currentLogs.unshift(newLog);
            const tbody = document.getElementById("logsTableBody");
            // If placeholder empty row exists, clear it
            if (tbody.querySelector("td[colspan='8']")) {
              tbody.innerHTML = "";
            }
            const rowHtml = createRowHtml(newLog, true);
            tbody.insertAdjacentHTML("afterbegin", rowHtml);
            const badge = document.getElementById("logCountBadge");
            badge.textContent = parseInt(badge.textContent || "0", 10) + 1;
          }
        } catch (err) {
          console.error("Error processing SSE log event:", err);
        }
      };

      eventSource.onerror = () => {
        sseStatus.textContent = "Reconnecting...";
      };
    }

    function inspectLog(id) {
      selectedLog = currentLogs.find(l => l.id === id);
      if (!selectedLog) return;

      document.getElementById("modalTitle").textContent = \`Request #\${selectedLog.id} (\${selectedLog.path})\`;
      const methodBadge = document.getElementById("modalMethodBadge");
      methodBadge.textContent = selectedLog.method;
      methodBadge.className = \`badge badge-method method-\${selectedLog.method}\`;

      const statusBadge = document.getElementById("modalStatusBadge");
      statusBadge.textContent = \`\${selectedLog.status_code} \${selectedLog.status_code === 200 ? 'OK' : 'ERR'}\`;
      statusBadge.className = selectedLog.status_code >= 200 && selectedLog.status_code < 300 ? "badge bg-success ms-2" : "badge bg-danger ms-2";

      document.getElementById("modalDurationBadge").textContent = \`\${selectedLog.latency_ms}ms\`;

      document.getElementById("clientRequestJson").textContent = formatJson(selectedLog.client_request);
      document.getElementById("transformedPayloadJson").textContent = formatJson(selectedLog.transformed_payload);
      document.getElementById("destinationResponseJson").textContent = formatJson(selectedLog.destination_response || (selectedLog.error ? { error: selectedLog.error } : ""));

      document.getElementById("modalReplayBtn").onclick = () => replayLog(selectedLog.id);

      payloadModalInstance.show();
    }

    async function replayLog(id) {
      if (!confirm(\`Replay API request #\${id}?\`)) return;
      try {
        const res = await fetch(\`/_api/replay/\${id}\`, { method: "POST" });
        if (res.ok) {
          alert(\`Request #\${id} replayed successfully!\`);
          fetchLogs();
        } else {
          const err = await res.text();
          alert(\`Replay failed (\${res.status}): \${err}\`);
        }
      } catch (err) {
        alert(\`Replay error: \${err.message}\`);
      }
    }

    async function confirmClearLogs() {
      if (!confirm("Are you sure you want to clear all recorded API logs?")) return;
      try {
        const res = await fetch("/_api/logs", { method: "DELETE" });
        if (res.ok) {
          fetchLogs();
        }
      } catch (err) {
        alert("Failed to clear logs: " + err.message);
      }
    }

    function formatJson(strOrObj) {
      if (!strOrObj) return "-";
      try {
        const obj = typeof strOrObj === "string" ? JSON.parse(strOrObj) : strOrObj;
        return JSON.stringify(obj, null, 2);
      } catch {
        return strOrObj;
      }
    }

    function escapeHtml(text) {
      if (!text) return "";
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function copyTabContent(elementId) {
      const text = document.getElementById(elementId).textContent;
      navigator.clipboard.writeText(text).then(() => {
        alert("Copied to clipboard!");
      });
    }
  </script>
</body>
</html>`;
}

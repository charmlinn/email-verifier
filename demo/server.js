const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 3000);
const apiBaseURL = (process.env.API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const publicDir = path.join(__dirname, "public");

function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
    });
    res.end(content);
  });
}

async function proxyVerification(req, res, url) {
  const email = url.searchParams.get("email");
  if (!email) {
    sendJSON(res, 400, { error: "email query parameter is required" });
    return;
  }

  try {
    const upstream = await fetch(`${apiBaseURL}/v1/${encodeURIComponent(email)}/verification`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(35000),
    });
    const body = await upstream.text();

    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    });
    res.end(body);
  } catch (err) {
    sendJSON(res, 502, {
      error: "failed to call email verifier API",
      detail: err.message,
      apiBaseURL,
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/verify") {
    proxyVerification(req, res, url);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    sendFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/styles.css") {
    sendFile(res, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/app.js") {
    sendFile(res, path.join(publicDir, "app.js"), "application/javascript; charset=utf-8");
    return;
  }

  sendJSON(res, 404, { error: "not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Demo listening on http://0.0.0.0:${port}`);
  console.log(`Proxying verification calls to ${apiBaseURL}`);
});

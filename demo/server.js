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

function mapReachable(reachable) {
  if (reachable === "yes") {
    return {
      canReceiveEmail: true,
      label: "可达",
      confidence: "high",
    };
  }

  if (reachable === "no") {
    return {
      canReceiveEmail: false,
      label: "不可达",
      confidence: "high",
    };
  }

  return {
    canReceiveEmail: null,
    label: "未知",
    confidence: "low",
  };
}

function mapVerificationResult(original) {
  if (!original || original.error) {
    return {
      status: "error",
      statusText: "调用失败",
      message: original?.error || "API returned an empty response",
      acceptEmail: false,
      riskLevel: "high",
      reasons: ["api_error"],
    };
  }

  const syntaxValid = Boolean(original.syntax?.valid);
  const reachable = mapReachable(original.reachable);
  const reasons = [];

  if (!syntaxValid) reasons.push("syntax_invalid");
  if (original.disposable) reasons.push("disposable_email");
  if (!original.has_mx_records) reasons.push("missing_mx_records");
  if (original.role_account) reasons.push("role_account");
  if (original.reachable === "no") reasons.push("reachable_no");
  if (original.reachable === "unknown") reasons.push("reachable_unknown");

  let status = "accepted";
  let statusText = "可接入";
  let riskLevel = "low";
  let acceptEmail = true;

  if (!syntaxValid || original.disposable || !original.has_mx_records || original.reachable === "no") {
    status = "rejected";
    statusText = "不建议接入";
    riskLevel = "high";
    acceptEmail = false;
  } else if (original.role_account || original.reachable === "unknown") {
    status = "review";
    statusText = "建议人工复核";
    riskLevel = "medium";
  }

  return {
    email: original.email,
    username: original.syntax?.username || "",
    domain: original.syntax?.domain || "",
    normalizedEmail:
      original.syntax?.username && original.syntax?.domain
        ? `${original.syntax.username}@${original.syntax.domain}`
        : original.email,
    status,
    statusText,
    acceptEmail,
    riskLevel,
    reasons,
    reachability: {
      raw: original.reachable,
      ...reachable,
    },
    checks: {
      syntaxValid,
      hasMxRecords: Boolean(original.has_mx_records),
      disposable: Boolean(original.disposable),
      roleAccount: Boolean(original.role_account),
      freeProvider: Boolean(original.free),
      hasSmtpResult: Boolean(original.smtp),
      hasGravatar: Boolean(original.gravatar),
      suggestion: original.suggestion || null,
    },
  };
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
    let original;

    try {
      original = JSON.parse(body);
    } catch (_) {
      original = { error: body || "upstream returned a non-JSON response" };
    }

    sendJSON(res, upstream.status, {
      original,
      mapped: mapVerificationResult(original),
    });
  } catch (err) {
    sendJSON(res, 502, {
      original: {
        error: "failed to call email verifier API",
        detail: err.message,
        apiBaseURL,
      },
      mapped: mapVerificationResult({
        error: "failed to call email verifier API",
      }),
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

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 3000);
const apiBaseURL = (process.env.API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const publicDir = path.join(__dirname, "public");
const verifierParams = [
  "smtp",
  "catchAll",
  "suggest",
  "gravatar",
  "yahooApi",
  "fromEmail",
  "helloName",
  "proxy",
  "connectTimeout",
  "operationTimeout",
];

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

function buildEvidence(original) {
  const evidence = [];

  evidence.push({
    item: "邮箱格式",
    outcome: original.syntax?.valid ? "通过" : "失败",
    detail: original.syntax?.valid ? "地址格式可以解析" : "地址格式不合法",
  });

  evidence.push({
    item: "域名 MX",
    outcome: original.has_mx_records ? "通过" : "失败",
    detail: original.has_mx_records ? "域名存在邮件交换记录" : "域名没有可用 MX 记录",
  });

  evidence.push({
    item: "邮箱类型",
    outcome: original.disposable ? "高风险" : "通过",
    detail: original.disposable ? "识别为一次性邮箱域名" : "未识别为一次性邮箱",
  });

  evidence.push({
    item: "账号属性",
    outcome: original.role_account ? "需复核" : "通过",
    detail: original.role_account ? "看起来是 support/admin/info/sales 等角色邮箱" : "未识别为角色邮箱",
  });

  evidence.push({
    item: "邮箱服务商",
    outcome: original.free ? "公共邮箱" : "企业/自有域名",
    detail: original.free ? "域名属于常见免费邮箱服务商" : "域名不是常见免费邮箱服务商",
  });

  if (original.smtp) {
    evidence.push({
      item: "SMTP 探测",
      outcome: original.reachable === "yes" ? "可达" : original.reachable === "no" ? "不可达" : "不确定",
      detail: original.smtp.deliverable
        ? "目标服务器接受该邮箱收件人"
        : original.smtp.catch_all
          ? "目标域名可能接收任意邮箱，无法确认具体账号"
          : "目标服务器未确认该邮箱可投递",
    });
  } else {
    evidence.push({
      item: "SMTP 探测",
      outcome: "未执行",
      detail: "未开启 SMTP 验证，或前置检查已提前结束",
    });
  }

  if (original.gravatar) {
    evidence.push({
      item: "头像画像",
      outcome: "有线索",
      detail: "Gravatar 返回了该邮箱相关头像信息",
    });
  }

  if (original.suggestion) {
    evidence.push({
      item: "拼写建议",
      outcome: "需确认",
      detail: `可能想输入 ${original.suggestion}`,
    });
  }

  return evidence;
}

function mapVerificationResult(original) {
  if (original?.result && original.error) {
    const mapped = mapVerificationResult(original.result);
    return {
      ...mapped,
      decisionCode: "error",
      decisionText: "验证异常",
      message: original.error,
      reasons: [...new Set([...(mapped.reasons || []), "verification_error"])],
    };
  }

  if (!original || original.error) {
    return {
      email: original?.email || "",
      decisionCode: "error",
      decisionText: "调用失败",
      message: original?.error || "API returned an empty response",
      acceptEmail: false,
      riskLevel: "high",
      reasons: ["api_error"],
    };
  }

  const syntaxValid = Boolean(original.syntax?.valid);
  const reachable = mapReachable(original.reachable);
  const reasons = [];
  const suggestions = [];

  if (!syntaxValid) {
    reasons.push("邮箱格式不合法");
    suggestions.push("请用户重新输入邮箱地址");
  }
  if (original.disposable) {
    reasons.push("一次性邮箱风险");
    suggestions.push("要求用户换用长期邮箱");
  }
  if (!original.has_mx_records) {
    reasons.push("域名没有邮件服务");
    suggestions.push("检查邮箱域名是否拼写正确");
  }
  if (original.role_account) {
    reasons.push("角色邮箱");
    suggestions.push("如需个人身份识别，建议补充人工确认");
  }
  if (original.reachable === "no") {
    reasons.push("SMTP 判断不可投递");
    suggestions.push("不要自动接入，建议让用户更换邮箱");
  }
  if (original.reachable === "unknown") {
    reasons.push("投递结果未知");
    suggestions.push("开启 SMTP 验证，或结合验证码/邮件确认链路");
  }
  if (original.free) {
    reasons.push("公共邮箱服务商");
  }
  if (original.suggestion) {
    reasons.push("域名可能拼写错误");
    suggestions.push(`建议确认是否为 ${original.syntax?.username || ""}@${original.suggestion}`);
  }

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

  const normalizedEmail =
    original.syntax?.username && original.syntax?.domain
      ? `${original.syntax.username}@${original.syntax.domain}`
      : original.email;
  const catchAllDomain = Boolean(original.smtp?.catch_all);

  return {
    email: original.email,
    normalizedEmail,
    decisionCode: status,
    decisionText: statusText,
    acceptEmail,
    riskLevel,
    reasons,
    recommendedActions: [...new Set(suggestions)],
    mailboxProfile: {
      domain: original.syntax?.domain || "",
      providerType: original.free ? "public_mailbox_provider" : "business_domain",
      providerText: original.free ? "公共邮箱服务商" : "企业/自有域名",
      accountType: original.role_account ? "role_account" : "individual_or_unknown",
      accountText: original.role_account ? "角色邮箱" : "个人或未知账号",
      temporaryMailboxRisk: original.disposable ? "high" : "none",
    },
    deliverability: {
      statusText: reachable.label,
      canReceiveEmail: reachable.canReceiveEmail,
      confidence: catchAllDomain ? "low" : reachable.confidence,
      smtpVerified: Boolean(original.smtp),
      mailboxConfirmed: original.smtp ? Boolean(original.smtp.deliverable) : null,
      catchAllRisk: catchAllDomain,
      summary: original.smtp
        ? catchAllDomain
          ? "目标域名可能接收任意地址，无法确认具体邮箱账号"
          : reachable.canReceiveEmail === true
            ? "目标服务器确认该邮箱可投递"
            : reachable.canReceiveEmail === false
              ? "目标服务器未确认该邮箱可投递"
              : "SMTP 已执行，但投递结论仍不确定"
        : "未执行 SMTP 验证，无法确认邮箱是否真实可投递",
    },
    evidence: buildEvidence(original),
    correction: {
      suggestedDomain: original.suggestion || null,
      suggestedEmail: original.suggestion && original.syntax?.username ? `${original.syntax.username}@${original.suggestion}` : null,
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
    const upstreamURL = new URL(`${apiBaseURL}/v1/${encodeURIComponent(email)}/verification`);
    for (const param of verifierParams) {
      const value = url.searchParams.get(param);
      if (value !== null && value !== "") {
        upstreamURL.searchParams.set(param, value);
      }
    }

    const upstream = await fetch(upstreamURL, {
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
      upstream: {
        url: upstreamURL.pathname + upstreamURL.search,
      },
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

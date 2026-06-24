const form = document.querySelector("#verify-form");
const emailInput = document.querySelector("#email");
const originalResult = document.querySelector("#original-result");
const mappedResult = document.querySelector("#mapped-result");
const statusPill = document.querySelector("#status-pill");
const requestPath = document.querySelector("#request-path");
const optionNames = [
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

function setStatus(text, state) {
  statusPill.textContent = text;
  statusPill.dataset.state = state;
}

function buildQuery(email) {
  const params = new URLSearchParams({ email });

  for (const name of optionNames) {
    const input = document.querySelector(`#${name}`);
    if (!input) continue;

    if (input.type === "checkbox") {
      params.set(name, input.checked ? "true" : "false");
      continue;
    }

    const value = input.value.trim();
    if (value) {
      params.set(name, value);
    }
  }

  return params;
}

async function verifyEmail(email) {
  setStatus("请求中", "loading");
  originalResult.textContent = "Calling API...";
  mappedResult.textContent = "Waiting for mapped result...";
  const params = buildQuery(email);
  const queryString = params.toString();
  const apiQuery = new URLSearchParams(queryString);
  apiQuery.delete("email");
  requestPath.textContent = `GET /v1/${email}/verification${apiQuery.size ? `?${apiQuery}` : ""}`;

  try {
    const response = await fetch(`/api/verify?${queryString}`);
    const text = await response.text();
    let payload;

    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = {
        original: text,
        mapped: {
          status: "error",
          statusText: "非 JSON 响应",
        },
      };
    }

    setStatus(`${response.status} ${response.ok ? "OK" : "ERROR"}`, response.ok ? "ok" : "error");
    originalResult.textContent = JSON.stringify(payload.original ?? payload, null, 2);
    mappedResult.textContent = JSON.stringify(payload.mapped ?? {}, null, 2);
    if (payload.upstream?.url) {
      requestPath.textContent = `GET ${payload.upstream.url}`;
    }
  } catch (err) {
    setStatus("调用失败", "error");
    originalResult.textContent = err.message;
    mappedResult.textContent = JSON.stringify(
      {
        status: "error",
        statusText: "调用失败",
      },
      null,
      2,
    );
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  verifyEmail(emailInput.value.trim());
});

document.querySelectorAll("[data-email]").forEach((button) => {
  button.addEventListener("click", () => {
    emailInput.value = button.dataset.email;
    verifyEmail(button.dataset.email);
  });
});

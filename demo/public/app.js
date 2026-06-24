const form = document.querySelector("#verify-form");
const emailInput = document.querySelector("#email");
const originalResult = document.querySelector("#original-result");
const mappedResult = document.querySelector("#mapped-result");
const statusPill = document.querySelector("#status-pill");
const requestPath = document.querySelector("#request-path");

function setStatus(text, state) {
  statusPill.textContent = text;
  statusPill.dataset.state = state;
}

async function verifyEmail(email) {
  setStatus("请求中", "loading");
  originalResult.textContent = "Calling API...";
  mappedResult.textContent = "Waiting for mapped result...";
  requestPath.textContent = `GET /v1/${email}/verification`;

  try {
    const response = await fetch(`/api/verify?email=${encodeURIComponent(email)}`);
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

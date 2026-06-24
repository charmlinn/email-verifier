const form = document.querySelector("#verify-form");
const emailInput = document.querySelector("#email");
const result = document.querySelector("#result");
const statusPill = document.querySelector("#status-pill");
const requestPath = document.querySelector("#request-path");

function setStatus(text, state) {
  statusPill.textContent = text;
  statusPill.dataset.state = state;
}

async function verifyEmail(email) {
  setStatus("请求中", "loading");
  result.textContent = "Calling API...";
  requestPath.textContent = `GET /v1/${email}/verification`;

  try {
    const response = await fetch(`/api/verify?email=${encodeURIComponent(email)}`);
    const text = await response.text();
    let payload = text;

    try {
      payload = JSON.stringify(JSON.parse(text), null, 2);
    } catch (_) {
      // Keep raw text if the upstream response is not JSON.
    }

    setStatus(`${response.status} ${response.ok ? "OK" : "ERROR"}`, response.ok ? "ok" : "error");
    result.textContent = payload;
  } catch (err) {
    setStatus("调用失败", "error");
    result.textContent = err.message;
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

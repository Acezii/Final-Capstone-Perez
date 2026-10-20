import { apiPost } from "/shared/js/api.js";

let conversationId = null;

function appendMessage(logEl, sender, text) {
  const div = document.createElement("div");
  div.className = "chat-msg " + (sender === "student" ? "chat-student" : sender === "system" ? "chat-system" : "chat-ai");
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

export function initChat({ form, input, sendBtn, logEl, statusEl }) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    appendMessage(logEl, "student", message);
    input.value = "";
    sendBtn.disabled = true;
    statusEl.textContent = "Path-Finder is thinking…";
    try {
      const data = await apiPost("/api/ai/chat", { conversationId, message }, "student", { noQueue: true });
      conversationId = data.conversationId;
      appendMessage(logEl, "ai", data.reply);
      if (data.escalated) {
        appendMessage(logEl, "system", "This has been forwarded to CCS staff. You'll see it marked resolved here once they've handled it.");
      }
      statusEl.textContent = "";
    } catch (err) {
      appendMessage(logEl, "system", "Couldn't reach the assistant. " + (err.message || "Check your connection and try again."));
      statusEl.textContent = "";
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });
}

let stream = null;
let rafId = null;

export function initScanner({ video, canvas, startBtn, stopBtn, statusEl, manualInput, manualBtn }, onToken) {
  const card = video.closest(".scanner-card");

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      startBtn.hidden = true;
      stopBtn.hidden = false;
      if (card) card.classList.add("camera-active");
      statusEl.textContent = "Point the camera at the student's QR ID…";
      tick();
    } catch (e) {
      statusEl.textContent = "Camera unavailable — use manual entry below instead.";
    }
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    startBtn.hidden = false;
    stopBtn.hidden = true;
    if (card) card.classList.remove("camera-active");
    statusEl.textContent = "";
  }

  function tick() {
    if (!stream) return;
    const ctx = canvas.getContext("2d");
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
      if (code && code.data) {
        statusEl.textContent = "Code detected — looking up…";
        onToken(code.data);
        stop();
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", stop);
  manualBtn.addEventListener("click", () => {
    const val = manualInput.value.trim();
    if (val) onToken(val);
  });
  manualInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") manualBtn.click();
  });

  return { stop };
}

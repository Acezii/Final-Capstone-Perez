let stream = null;
let rafId = null;

const CAMERA_KEY = "pf_scan_camera";
// Virtual cameras (OBS, Snap, etc.) often show up first on Windows and send a black picture.
const VIRTUAL_CAMERA = /virtual|obs|snap ?camera|camo|droidcam|manycam|xsplit|nvidia broadcast|iriun/i;

export function initScanner({ video, canvas, startBtn, stopBtn, cameraSelect, statusEl, manualInput, manualBtn }, onToken) {
  const card = video.closest(".scanner-card");
  let blackCheckTimer = null;

  function setStatus(text, warning = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-warning", warning);
  }

  function savedCamera() {
    try {
      return localStorage.getItem(CAMERA_KEY) || "";
    } catch {
      return "";
    }
  }

  function cameraError(e) {
    if (!window.isSecureContext) return "Camera needs a secure page — open the panel via http://localhost or https.";
    switch (e && e.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Camera permission was blocked — allow it in the browser's site settings, then try again.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "No camera was found on this device — use manual entry below.";
      case "NotReadableError":
      case "AbortError":
        return "The camera is in use by another app (Zoom, Teams, another tab) — close it and try again.";
      default:
        return `Camera unavailable (${(e && (e.name || e.message)) || "unknown error"}) — use manual entry below.`;
    }
  }

  async function openStream(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error("getUserMedia is not supported"), { name: "NotSupportedError" });
    }
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
      } catch (e) {
        if (e.name !== "OverconstrainedError" && e.name !== "NotFoundError") throw e;
        // The remembered camera is gone (unplugged); fall through to the default one.
      }
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) {
      // Some laptop webcams reject the facingMode hint; retry with any camera.
      if (e.name === "OverconstrainedError" || e.name === "NotFoundError") {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw e;
    }
  }

  // Device labels are only available after permission is granted, so this runs once a stream is open.
  async function listCameras(activeId) {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    if (cameraSelect) {
      cameraSelect.innerHTML = "";
      devices.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Camera ${i + 1}`;
        cameraSelect.appendChild(opt);
      });
      cameraSelect.value = activeId;
      cameraSelect.hidden = devices.length < 2;
    }
    return devices;
  }

  function stopStream() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    clearTimeout(blackCheckTimer);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
  }

  async function attach(newStream) {
    stream = newStream;
    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    await video.play();
  }

  async function start(deviceId = savedCamera()) {
    startBtn.disabled = true;
    setStatus("Starting camera…");
    try {
      stopStream();
      await attach(await openStream(deviceId));

      let activeId = stream.getVideoTracks()[0]?.getSettings().deviceId || "";
      const devices = await listCameras(activeId);

      // Without an explicit choice, move off a virtual camera onto a real one.
      const active = devices.find((d) => d.deviceId === activeId);
      const real = devices.find((d) => !VIRTUAL_CAMERA.test(d.label));
      if (!deviceId && active && VIRTUAL_CAMERA.test(active.label) && real) {
        stopStream();
        await attach(await openStream(real.deviceId));
        activeId = real.deviceId;
        if (cameraSelect) cameraSelect.value = activeId;
      }

      const track = stream.getVideoTracks()[0];
      const facing = track?.getSettings().facingMode;
      video.classList.toggle("is-mirrored", facing ? facing === "user" : !/back|rear|environment/i.test(track?.label || ""));

      startBtn.hidden = true;
      stopBtn.hidden = false;
      if (card) card.classList.add("camera-active");
      setStatus("Point the camera at the student's QR ID…");
      blackCheckTimer = setTimeout(checkForBlackPicture, 2500);
      tick();
    } catch (e) {
      console.error("QR scanner camera error:", e);
      stop();
      setStatus(cameraError(e), true);
    } finally {
      startBtn.disabled = false;
    }
  }

  function stop() {
    stopStream();
    startBtn.hidden = false;
    stopBtn.hidden = true;
    if (card) card.classList.remove("camera-active");
    setStatus("");
  }

  function checkForBlackPicture() {
    if (!stream || !video.videoWidth) return;
    const w = 64, h = 48;
    const probe = document.createElement("canvas");
    probe.width = w;
    probe.height = h;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    if (sum / (w * h * 3) < 8) {
      const label = stream.getVideoTracks()[0]?.label || "This camera";
      setStatus(
        `${label} is sending a black picture. Open the privacy shutter or press the camera key, close other apps using it, or pick another camera${cameraSelect && !cameraSelect.hidden ? " from the list" : ""}.`,
        true
      );
    }
  }

  function tick() {
    if (!stream) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
      if (code && code.data) {
        setStatus("Code detected — looking up…");
        onToken(code.data);
        stop();
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  startBtn.addEventListener("click", () => start());
  stopBtn.addEventListener("click", stop);
  if (cameraSelect) {
    cameraSelect.addEventListener("change", () => {
      try {
        localStorage.setItem(CAMERA_KEY, cameraSelect.value);
      } catch {}
      start(cameraSelect.value);
    });
  }
  manualBtn.addEventListener("click", () => {
    const val = manualInput.value.trim();
    if (val) onToken(val);
  });
  manualInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") manualBtn.click();
  });

  return { stop };
}

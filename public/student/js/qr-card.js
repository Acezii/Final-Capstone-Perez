export function renderQr(container, text) {
  container.innerHTML = "";
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = 220;
  const count = qr.getModuleCount();
  const cell = Math.floor(size / count);
  const margin = Math.floor((size - cell * count) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#171915";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(margin + col * cell, margin + row * cell, cell, cell);
      }
    }
  }
  container.appendChild(canvas);
}

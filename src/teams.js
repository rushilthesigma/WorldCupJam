// Real national-team kit colours + tiny pixel-art flags drawn procedurally.

export const TEAMS = {
  BRA: {
    name: "Brazil",
    abbr: "BRA",
    shirt: "#f7d417",
    shirtDark: "#c9a800",
    shorts: "#1f4fb0",
    skin: "#b9774a",
    gk: "#19c27a",
    drawFlag,
  },
  ARG: {
    name: "Argentina",
    abbr: "ARG",
    shirt: "#7fbfe6",
    shirtDark: "#5a9fcf",
    shorts: "#23335c",
    skin: "#d39a6a",
    gk: "#222a3a",
    drawFlag,
  },
};

function px(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

// Draws a small flag (w x h) at x,y for the given team key.
function drawFlag(ctx, key, x, y, w, h) {
  if (key === "BRA") {
    px(ctx, x, y, w, h, "#1e9e4a"); // green field
    // yellow diamond
    ctx.fillStyle = "#f7d417";
    const cx = x + w / 2;
    const cy = y + h / 2;
    const hw = w * 0.42;
    const hh = h * 0.42;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fill();
    // blue globe
    px(ctx, Math.round(cx - h * 0.18), Math.round(cy - h * 0.18), Math.round(h * 0.36), Math.round(h * 0.36), "#1f4fb0");
  } else if (key === "ARG") {
    const band = h / 3;
    px(ctx, x, y, w, band, "#7fbfe6"); // light blue
    px(ctx, x, y + band, w, h - 2 * band, "#ffffff"); // white
    px(ctx, x, y + h - band, w, band, "#7fbfe6"); // light blue
    // sun of may
    px(ctx, Math.round(x + w / 2 - 1), Math.round(y + h / 2 - 1), 2, 2, "#f2c200");
  } else {
    px(ctx, x, y, w, h, "#888");
  }
}

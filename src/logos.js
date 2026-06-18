// Sponsor logos, drawn as original low-resolution pixel emblems in the game's
// art style — geometric recreations of each brand's mark (NOT the wordmark/name,
// and not copies of the brands' logo artwork). Each board paints `bg`, then the
// brand's `draw(pen, maxW, maxH)` lays an emblem centred on it. Real-brand use is
// the project owner's call; see the project memory for the licensing context.

// --- Scanline polygon fill (device pixels). ---
function fillPoly(g, pts, col) {
  g.fillStyle = col;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  minY = Math.floor(minY); maxY = Math.ceil(maxY);
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const y1 = a[1], y2 = b[1];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const t = (y - y1) / (y2 - y1);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.round(xs[i]), xb = Math.round(xs[i + 1]);
      g.fillRect(xa, y, Math.max(1, xb - xa), 1);
    }
  }
}

// A drawing "pen" with origin at the board centre (cx,cy) and a uniform scale u.
// All coordinates are in design units relative to centre: +x right, +y down.
export function makePen(g, cx, cy, u) {
  const X = (x) => Math.round(cx + x * u);
  const Y = (y) => Math.round(cy + y * u);
  const S = (v) => Math.max(1, Math.round(v * u));
  return {
    u,
    rect(x, y, w, h, col) { g.fillStyle = col; g.fillRect(X(x), Y(y), S(w), S(h)); },
    // centred rect (x,y is the centre)
    box(x, y, w, h, col) { this.rect(x - w / 2, y - h / 2, w, h, col); },
    dot(x, y, col) { this.rect(x, y, 1, 1, col); },
    disc(x, y, r, col) {
      g.fillStyle = col;
      const cX = cx + x * u, cY = cy + y * u, rr = r * u, R = Math.round(rr);
      for (let yy = -R; yy <= R; yy++) {
        const dx = Math.floor(Math.sqrt(Math.max(0, rr * rr - yy * yy)));
        g.fillRect(Math.round(cX - dx), Math.round(cY + yy), dx * 2 + 1, 1);
      }
    },
    ring(x, y, r, t, col) {
      g.fillStyle = col;
      const cX = cx + x * u, cY = cy + y * u, ro = r * u, ri = (r - t) * u, R = Math.round(ro);
      for (let yy = -R; yy <= R; yy++) {
        const o = Math.sqrt(Math.max(0, ro * ro - yy * yy));
        const inSq = ri * ri - yy * yy;
        if (inSq > 0) {
          const inn = Math.sqrt(inSq);
          g.fillRect(Math.round(cX - o), Math.round(cY + yy), Math.ceil(o - inn) + 1, 1);
          g.fillRect(Math.round(cX + inn) - 1, Math.round(cY + yy), Math.ceil(o - inn) + 1, 1);
        } else {
          g.fillRect(Math.round(cX - o), Math.round(cY + yy), Math.round(o * 2) + 1, 1);
        }
      }
    },
    // ellipse (filled), rx/ry radii
    ellipse(x, y, rx, ry, col) {
      g.fillStyle = col;
      const cX = cx + x * u, cY = cy + y * u, RX = rx * u, RY = ry * u, R = Math.round(RY);
      for (let yy = -R; yy <= R; yy++) {
        const dx = Math.floor(RX * Math.sqrt(Math.max(0, 1 - (yy * yy) / (RY * RY))));
        g.fillRect(Math.round(cX - dx), Math.round(cY + yy), dx * 2 + 1, 1);
      }
    },
    poly(pts, col) { fillPoly(g, pts.map((p) => [cx + p[0] * u, cy + p[1] * u]), col); },
    tri(x1, y1, x2, y2, x3, y3, col) { this.poly([[x1, y1], [x2, y2], [x3, y3]], col); },
    star(x, y, ro, ri, n, rot, col) {
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const rr = i % 2 ? ri : ro;
        const a = rot + (i * Math.PI) / n;
        pts.push([x + Math.sin(a) * rr, y - Math.cos(a) * rr]);
      }
      this.poly(pts, col);
    },
    line(x1, y1, x2, y2, th, col) {
      g.fillStyle = col;
      const ax = cx + x1 * u, ay = cy + y1 * u, bx = cx + x2 * u, by = cy + y2 * u;
      const dx = bx - ax, dy = by - ay, len = Math.max(1, Math.hypot(dx, dy));
      const steps = Math.ceil(len), s = Math.max(1, Math.round(th * u));
      for (let i = 0; i <= steps; i++) {
        const px = ax + (dx * i) / steps, py = ay + (dy * i) / steps;
        g.fillRect(Math.round(px - s / 2), Math.round(py - s / 2), s, s);
      }
    },
    // a filled arc band (donut wedge) from angle a0..a1 (radians, 0 = up, cw)
    arc(x, y, r, th, a0, a1, col) {
      g.fillStyle = col;
      const cX = cx + x * u, cY = cy + y * u;
      const step = 0.12;
      for (let a = a0; a <= a1; a += step) {
        for (let rr = r - th; rr <= r; rr += 1 / u) {
          const px = cX + Math.sin(a) * rr * u, py = cY - Math.cos(a) * rr * u;
          g.fillRect(Math.round(px), Math.round(py), Math.max(1, Math.round(u)), Math.max(1, Math.round(u)));
        }
      }
    },
  };
}

// Each emblem is authored ~11 design-units tall (y in [-5.5, 5.5]) so it clears
// the 12px sideline boards with a pixel of margin, and reads on the goal boards.
const L = {
  // EMIRATES — red calligraphic flourish on white.
  emirates(p) {
    const c = "#d71921";
    p.line(-9, 2, -3, 2, 2, c);
    p.line(-3, 2, 2, -3, 2, c);
    p.line(2, -3, 6, 1, 2, c);
    p.line(6, 1, 9, -2, 2, c);
    p.line(0, 2, 8, 2, 1.4, c);
    p.dot(9, -3, c);
  },
  // ETIHAD — gold faceted hexagon mark.
  etihad(p) {
    const g = "#c9a24a", d = "#8a6f2e";
    p.poly([[0, -5], [5, -2.5], [5, 2.5], [0, 5], [-5, 2.5], [-5, -2.5]], g);
    p.line(0, -5, 0, 5, 0.8, d);
    p.line(-5, -2.5, 5, 2.5, 0.8, d);
    p.line(5, -2.5, -5, 2.5, 0.8, d);
  },
  // QATAR AIRWAYS — the oryx head with long swept-back horns.
  qatar(p) {
    const c = "#f2e8d0";
    p.poly([[-1, -1], [3, -2], [4, 3], [1, 5], [-2, 4], [-3, 1]], c); // head
    p.line(0, -1, -5, -5, 1.2, c); // horn
    p.line(2, -1, 5, -5, 1.2, c); // horn
    p.dot(2, 1, "#5a1030");
  },
  // TURKISH — white wild-goose in flight on red.
  turkish(p) {
    const c = "#ffffff";
    p.poly([[-7, 1], [-1, -2], [2, -4], [3, -1], [7, -3], [2, 2], [0, 1], [-3, 3]], c);
  },
  // HEINEKEN — red star, white-edged.
  heineken(p) {
    p.star(0, 0, 6, 2.6, 5, 0, "#ffffff");
    p.star(0, 0, 5, 2.1, 5, 0, "#e2231a");
  },
  // BUDWEISER — white bowtie with gold trim.
  budweiser(p) {
    const w = "#ffffff", gold = "#e8c33a";
    p.tri(-9, -4, -9, 4, -1, 0, w);
    p.tri(9, -4, 9, 4, 1, 0, w);
    p.box(0, 0, 2.6, 4, gold);
    p.line(-9, -4, -1, 0, 0.8, gold);
    p.line(-9, 4, -1, 0, 0.8, gold);
    p.line(9, -4, 1, 0, 0.8, gold);
    p.line(9, 4, 1, 0, 0.8, gold);
  },
  // CARLSBERG — white crown with hop dots.
  carlsberg(p) {
    const w = "#ffffff";
    p.poly([[-7, 4], [-7, -1], [-3.5, 2], [0, -4], [3.5, 2], [7, -1], [7, 4]], w);
    p.dot(-7, -2.5, w); p.dot(0, -5.5, w); p.dot(7, -2.5, w);
  },
  // COCA-COLA — the white dynamic ribbon wave.
  cocacola(p) {
    const w = "#ffffff";
    p.poly([[-11, 1], [-4, -1], [3, 2], [11, -1], [11, 3], [3, 5], [-4, 2], [-11, 4]], w);
  },
  // PEPSI — the globe: red top, blue bottom, white wave.
  pepsi(p) {
    p.disc(0, 0, 5.5, "#ffffff");
    p.disc(0, -1.6, 5.5, "#e32934"); // top red lobe (clipped by white below)
    // re-cut white band + blue bottom
    p.poly([[-5.5, -1.2], [-2, -2.4], [2, -0.6], [5.5, -2], [5.5, 6], [-5.5, 6]], "#ffffff");
    p.poly([[-5.5, 1.4], [-2, 0.2], [2, 2], [5.5, 0.6], [5.5, 6], [-5.5, 6]], "#0a3d91");
    p.ring(0, 0, 5.5, 0.8, "#0a3d91");
  },
  // MCDONALD'S — golden arches.
  mcdonalds(p) {
    const y = "#ffc72c", t = 2;
    p.arc(-2.6, -0.5, 2.4, t, -1.62, 1.62, y); // left arch top
    p.arc(2.6, -0.5, 2.4, t, -1.62, 1.62, y); // right arch top
    p.line(-5, -0.6, -5, 5, t, y); // left outer leg
    p.line(5, -0.6, 5, 5, t, y); // right outer leg
    p.line(-0.2, -0.6, 0, 5, t, y); // inner legs meet at the centre valley
    p.line(0.2, -0.6, 0, 5, t, y);
  },
  // KFC — the Colonel: white hair, glasses, goatee, red bowtie.
  kfc(p) {
    const w = "#ffffff", r = "#e4002b", k = "#1a1a1a";
    p.disc(0, -1, 3.4, w); // hair/face mass
    p.box(0, -2.5, 5.5, 1.4, w); // hair top
    p.dot(-1.4, -1.4, k); p.dot(1.4, -1.4, k); // eyes/glasses
    p.line(-1.4, -1.4, 1.4, -1.4, 0.6, k); // glasses bridge
    p.poly([[-1.2, 1.4], [1.2, 1.4], [0, 3.6]], w); // goatee
    p.tri(-3, 4.4, -0.4, 5.4, -0.4, 3.4, r); // bowtie L
    p.tri(3, 4.4, 0.4, 5.4, 0.4, 3.4, r); // bowtie R
  },
  // BURGER KING — the burger: two buns hugging the brand-colour text band.
  burgerking(p) {
    const bun = "#f0a83a", buntop = "#f6c266", fill = "#d62b1f", blue = "#1c63b8";
    p.poly([[-9, -1], [-9, -3], [-5, -5], [5, -5], [9, -3], [9, -1]], bun); // top bun
    p.box(0, -4, 12, 1, buntop);
    p.box(0, 0, 18, 1.6, fill); // filling band
    p.poly([[-9, 1], [9, 1], [9, 3], [5, 5], [-5, 5], [-9, 3]], bun); // bottom bun
    p.arc(0, 3.5, 8.5, 1.4, -1.05, 1.05, blue); // blue crescent hugging the top
  },
  // LAY'S — red ribbon swoosh with a yellow sun.
  lays(p) {
    const r = "#e01a22", w = "#ffffff";
    p.disc(-4, -1, 4, w);
    p.disc(-4, -1, 3, "#ffd200");
    p.poly([[-8, 4], [10, -3], [10, 0], [-8, 6]], r); // ribbon
  },
  // SNICKERS — a chocolate bar segment.
  snickers(p) {
    const c = "#6b3d12", hi = "#9a5c20", dk = "#3a2410";
    p.box(0, 0, 18, 8, c);
    for (let i = -1; i <= 1; i++) p.box(i * 5, 0, 4, 6, hi);
    for (let i = -1; i <= 1; i++) { p.box(i * 5, -3, 4, 1, dk); p.box(i * 5 - 2, 0, 0.8, 6, dk); }
    p.box(0, 3.6, 18, 1, dk);
  },
  // OREO — the cookie with cream, embossed edge.
  oreo(p) {
    const dk = "#15101a", rim = "#2a2030", cream = "#f2e6c8";
    p.disc(0, 0, 5.5, dk);
    p.ring(0, 0, 5.5, 1, rim);
    p.box(0, 0, 9, 1.4, cream); // cream filling
    for (let a = 0; a < 6; a++) { const t = (a / 6) * Math.PI * 2; p.dot(Math.sin(t) * 3.4, -Math.cos(t) * 3.4, rim); }
    p.disc(0, 0, 1.4, rim);
  },
  // NESTLE — the nest with mother bird and chicks.
  nestle(p) {
    const br = "#7a5a2a", bird = "#00529b";
    p.arc(0, 1, 6, 1.6, -1.4, 1.4, br); // nest rim
    p.box(0, 4, 9, 1.4, br);
    p.line(0, 3, 0, -3, 1.2, bird); // mother body
    p.tri(0, -3, -2.4, -4, 0, -1.6, bird); // beak/head
    p.disc(-2.6, 1.2, 1, bird); p.disc(2.6, 1.2, 1, bird); // chicks
    p.dot(-2.6, 0, bird); p.dot(2.6, 0, bird);
  },
  // VISA — bold blue chevron with a gold flag.
  visa(p) {
    const b = "#1a1f71", gold = "#f7b600";
    p.poly([[-8, -4], [-3.5, -4], [0, 3], [3.5, -4], [8, -4], [1.5, 5], [-1.5, 5]], b);
    p.poly([[4, -5], [9, -5], [8, -2], [3, -2]], gold);
  },
  // MASTERCARD — two overlapping circles.
  mastercard(p) {
    p.disc(-3, 0, 5, "#eb001b");
    p.disc(3, 0, 5, "#f79e1b");
    p.ellipse(0, 0, 2.4, 5, "#ff5f00"); // overlap
  },
  // BARCLAYS — the spread eagle.
  barclays(p) {
    const c = "#1ba1e2";
    p.poly([[0, -5], [2, -2], [9, -1], [3, 1], [1, 5], [-1, 5], [-3, 1], [-9, -1], [-2, -2]], c);
    p.disc(0, -4, 1.3, c);
  },
  // SANTANDER — the white flame.
  santander(p) {
    const w = "#ffffff";
    p.poly([[2, -6], [4, -2], [3, 2], [5, 0], [4, 4], [0, 6], [-4, 4], [-3, 0], [-1, 1], [-2, -2], [0, -3]], w);
  },
  // HSBC — the hexagon mark (two red triangles, white centre band).
  hsbc(p) {
    const r = "#db0011";
    p.poly([[-6, -5], [6, -5], [3, 0], [-3, 0]], r); // top triangle inward
    p.poly([[-6, 5], [6, 5], [3, 0], [-3, 0]], r); // bottom triangle inward
  },
  // STANDARD CHARTERED — interlocking green & blue teardrops.
  stanchart(p) {
    const gr = "#38a06b", bl = "#1f6fb5";
    p.poly([[-1, -6], [4, -1], [-1, 4], [-3, 1], [-1, -1], [-3, -3]], gr);
    p.poly([[1, 6], [-4, 1], [1, -4], [3, -1], [1, 1], [3, 3]], bl);
  },
  // BNP PARIBAS — four white stars rising over the green field.
  bnp(p) {
    const w = "#ffffff";
    const pos = [[-7, 3], [-2.5, 0.5], [2.5, -1], [7, -3.5]];
    for (const [x, y] of pos) p.star(x, y, 2, 0.9, 4, 0, w);
  },
  // CAIXABANK — Miró-style navy star with red & yellow dots.
  caixa(p) {
    p.star(-1, 0, 5.5, 2.2, 5, 0.3, "#003a70");
    p.disc(4, -3, 1.6, "#ffcd00");
    p.disc(3.5, 3.5, 1.3, "#e2231a");
  },
  // NATWEST — three arrows forming the cube.
  natwest(p) {
    const w = "#ffffff";
    p.tri(0, -5, 2.4, -1, -2.4, -1, w);
    p.tri(-5.5, 4, -3.1, 0, -7.9, 0, w);
    p.tri(5.5, 4, 7.9, 0, 3.1, 0, w);
  },
  // ALLIANZ — three white bars (the simplified mark).
  allianz(p) {
    const w = "#ffffff";
    p.box(-3.5, 0.5, 1.8, 9, w);
    p.box(0, -0.5, 1.8, 11, w);
    p.box(3.5, 0.5, 1.8, 9, w);
  },
  // AXA — white tile with a red diagonal cut.
  axa(p) {
    p.box(0, 0, 11, 9, "#ffffff");
    p.line(-5, 4.5, 5, -4.5, 2, "#ff1721");
  },
  // AIG — white diamond emblem with bars.
  aig(p) {
    const w = "#ffffff", b = "#003da5";
    p.poly([[0, -5.5], [6, 0], [0, 5.5], [-6, 0]], w);
    p.box(0, 0, 6, 1.2, b);
    p.box(0, -2, 4, 1, b);
    p.box(0, 2, 4, 1, b);
  },
  // PRUDENTIAL — a simple red anchor.
  prudential(p) {
    const r = "#ed1b2e";
    p.box(0, 0, 1.4, 9, r); // shank
    p.disc(0, -4, 1.2, r); // ring
    p.arc(0, 1, 5, 1.4, 1.2, 1.94, r); // flukes (drawn as arc base)
    p.line(-5, 2, -4, 4, 1.2, r); p.line(5, 2, 4, 4, 1.2, r);
    p.box(0, -2.5, 5, 1.2, r); // stock
  },
  // GAZPROM — white flame with a slash, on blue.
  gazprom(p) {
    const w = "#ffffff";
    p.poly([[1, -6], [3, -1], [2, 3], [4, 1], [3, 5], [-1, 6], [-4, 3], [-2, 1], [-3, -2], [0, -3]], w);
    p.line(-4, 4, 4, -4, 1, "#005aa0");
  },
  // ARAMCO — a four-point energy spark.
  aramco(p) {
    p.star(0, 0, 6, 1.4, 4, 0, "#ffffff");
    p.star(0, 0, 3, 0.8, 4, Math.PI / 4, "#9fe3bf");
  },
  // SHELL — the pecten scallop (yellow, red ribs) on red.
  shell(p) {
    const y = "#fbce07", r = "#ed1c24";
    p.poly([[-8, 5], [-8, 0], [-6, -3], [-3, -5], [0, -5.5], [3, -5], [6, -3], [8, 0], [8, 5]], y);
    for (let i = -3; i <= 3; i++) p.line(i * 2.3, 5, i * 1.1, -4.5, 0.8, r);
    p.line(-8, 5, 8, 5, 1, r);
  },
  // BP — the Helios sunburst (green & yellow rays).
  bp(p) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      p.line(0, 0, Math.sin(a) * 6, -Math.cos(a) * 6, 1.6, i % 2 ? "#ffe600" : "#7ac143");
    }
    p.disc(0, 0, 1.6, "#ffffff");
  },
  // TOTAL — the sphere split blue / red with an orange seam.
  total(p) {
    for (let yy = -5; yy <= 5; yy++) {
      const dx = Math.floor(5.5 * Math.sqrt(Math.max(0, 1 - (yy * yy) / 30.25)));
      if (dx <= 0) continue;
      p.rect(-dx, yy, dx, 1, "#004a9f"); // left blue
      p.rect(0, yy, dx, 1, "#e2231a"); // right red
    }
    p.box(0, 0, 1.6, 11, "#ff8a00"); // orange seam
  },
  // EXXON — the interlocking double-X.
  exxon(p) {
    const r = "#ce1126";
    p.line(-7, -4, -1, 4, 1.6, r); p.line(-7, 4, -1, -4, 1.6, r);
    p.line(1, -4, 7, 4, 1.6, r); p.line(1, 4, 7, -4, 1.6, r);
  },
  // HYUNDAI — slanted H in an oval.
  hyundai(p) {
    const w = "#ffffff";
    p.ellipse(0, 0, 7, 5, w);
    p.ellipse(0, 0, 5.4, 3.6, "#002c5f");
    // slanted H
    p.poly([[-3, -3], [-1.4, -3], [-1.4, 3], [-3, 3]], w);
    p.poly([[2.4, -3], [4, -3], [4, 3], [2.4, 3]], w);
    p.poly([[-2.6, -0.8], [3.6, -1.6], [3.6, 0], [-2.6, 0.8]], w);
  },
  // KIA — the modern continuous-stroke logomark (an abstract connected signature,
  // deliberately not a readable wordmark).
  kia(p) {
    const w = "#ffffff", t = 1.8;
    p.line(-8, -4, -8, 4, t, w);
    p.line(-8, 0, -4.5, -4, t, w);
    p.line(-4.5, -4, -4.5, 4, t, w);
    p.line(-4.5, 0.5, -1, 4, t, w);
    p.line(-1, 4, -1, -4, t, w);
    p.line(-1, -4, 2.5, 4, t, w);
    p.line(2.5, 4, 2.5, -4, t, w);
    p.line(2.5, -2, 8, -4, t, w); // sweeping tail
    p.line(5, -3.2, 8, 4, t, w);
  },
  // TOYOTA — three overlapping ellipses.
  toyota(p) {
    const w = "#ffffff", r = "#e50012";
    p.ellipse(0, 0.5, 7, 4, w); p.ellipse(0, 0.5, 5.4, 2.6, r); // horizontal oval ring
    p.ellipse(0, -1.5, 2.4, 3.6, w); p.ellipse(0, -1.5, 1.2, 2.4, r); // vertical oval ring
  },
  // NISSAN — ring with a horizontal bar.
  nissan(p) {
    const w = "#ffffff";
    p.ring(0, 0, 5.5, 1.2, w);
    p.box(0, 0, 13, 2.4, w);
    p.box(0, 0, 9, 1.4, "#c3002f");
  },
  // VOLKSWAGEN — ring with V over W.
  volkswagen(p) {
    const w = "#ffffff";
    p.ring(0, 0, 5.5, 1, w);
    p.line(-2.6, -3.5, 0, 0.5, 1, w); p.line(2.6, -3.5, 0, 0.5, 1, w); // V
    p.line(-3.4, 0.5, -2, 4, 1, w); p.line(-2, 4, -0.6, 0.8, 1, w);
    p.line(0.6, 0.8, 2, 4, 1, w); p.line(2, 4, 3.4, 0.5, 1, w); // W
  },
  // AUDI — four overlapping rings.
  audi(p) {
    const s = "#d6d6d6";
    for (let i = 0; i < 4; i++) p.ring(-7.5 + i * 5, 0, 3.2, 0.9, s);
  },
  // BMW — quartered roundel.
  bmw(p) {
    const w = "#ffffff", b = "#1c69d4", k = "#0a0a0a";
    p.disc(0, 0, 5.5, k);
    p.ring(0, 0, 5.5, 1, w);
    // quadrants
    p.tri(0, 0, 0, -4.4, 4.4, 0, w); // TR white
    p.tri(0, 0, 4.4, 0, 0, 4.4, b);  // BR blue
    p.tri(0, 0, 0, 4.4, -4.4, 0, w); // BL white
    p.tri(0, 0, -4.4, 0, 0, -4.4, b); // TL blue
  },
  // MERCEDES — three-pointed star in a ring.
  mercedes(p) {
    const s = "#d6d6d6";
    p.ring(0, 0, 5.5, 0.9, s);
    p.line(0, 0, 0, -4.6, 1.2, s);
    p.line(0, 0, 4, 2.3, 1.2, s);
    p.line(0, 0, -4, 2.3, 1.2, s);
    p.disc(0, 0, 1, s);
  },
  // FORD — the blue oval emblem.
  ford(p) {
    const b = "#003478", w = "#ffffff";
    p.ellipse(0, 0, 9, 5, w);
    p.ellipse(0, 0, 8, 4.2, b);
    p.ellipse(0, 0, 7.4, 3.6, w);
    p.ellipse(0, 0, 6.6, 3, b);
    p.line(-5, 1.5, -2.5, -1.5, 1, w); // suggestion of the script swash
    p.line(-3.5, 1.5, -1, -1.5, 1, w);
    p.line(1, 1, 4.5, 1, 0.8, w);
  },
  // JEEP — the seven-slot grille + round headlamps.
  jeep(p) {
    const c = "#f0f0e6";
    for (let i = 0; i < 7; i++) p.box(-6 + i * 2, 0, 1.2, 8, c);
    p.disc(-8.5, 0, 1.8, c);
    p.disc(8.5, 0, 1.8, c);
  },
  // VODAFONE — the white speech-mark in a red field.
  vodafone(p) {
    const w = "#ffffff";
    p.disc(0, -1, 3.2, w);
    p.poly([[-2.5, 0], [2, 0], [-1.5, 6], [-3, 4]], w); // tail
    p.disc(0, -1, 1.6, "#e60000");
  },
  // ORANGE — the bold white square mark.
  orange(p) {
    const w = "#ffffff";
    p.box(0, 0, 9, 9, w);
    p.box(0, 0, 5, 5, "#ff7900");
  },
  // MOVISTAR — the smiling M-wave.
  movistar(p) {
    const w = "#ffffff", g = "#5ec5c1";
    p.arc(0, 0, 6, 1.6, -1.2, 1.2, w); // smile
    p.disc(-5, -3, 1.2, g); // accent dot
    p.line(-4, -1, -1, -4, 1.4, w); p.line(-1, -4, 2, -1, 1.4, w); // little wave peak
  },
  // ATT — the striped globe.
  att(p) {
    const w = "#ffffff", b = "#0568ae";
    p.disc(0, 0, 5.5, w);
    for (let yy = -4; yy <= 4; yy += 2) {
      const dx = Math.floor(5.5 * Math.sqrt(Math.max(0, 1 - (yy * yy) / 30.25)));
      p.rect(-dx, yy, dx * 2, 1, b);
    }
    p.poly([[-5.5, 2], [5.5, 2], [4, 5.5], [-4, 5.5]], b); // shaded base
  },
  // VERIZON — the bold red check.
  verizon(p) {
    const r = "#cd040b";
    p.line(-7, -1, -2, 4, 2.4, r);
    p.line(-2, 4, 8, -5, 2.4, r);
  },
  // SAMSUNG — the tilted ellipse mark.
  samsung(p) {
    const w = "#ffffff";
    p.ellipse(0, 0, 9, 4.6, w);
    p.ellipse(0, 0, 7.4, 3.2, "#1428a0");
    p.box(0, 0, 9, 2, "#1428a0");
  },
  // SONY — a clean minimalist badge frame.
  sony(p) {
    const w = "#ffffff";
    p.ellipse(0, 0, 10, 4.4, w);
    p.ellipse(0, 0, 8.6, 3, "#111111");
    p.box(0, 0, 4, 0.9, w);
  },
  // INTEL — the orbiting swirl.
  intel(p) {
    const w = "#ffffff";
    p.ring(0, 0, 5.5, 1.1, w);
    p.box(2, 5, 4, 2.2, "#0071c5"); // break the ring (open swoosh)
    p.disc(3.6, -3.6, 1.3, w); // satellite dot
  },
  // EA — the rounded badge (the brand's mark).
  ea(p) {
    const k = "#111111", w = "#ffffff";
    p.box(0, 0, 14, 10, k);
    p.box(0, 0, 12, 8, w);
    // E
    p.box(-3.4, 0, 1.3, 6, k); p.box(-2.7, -2.5, 2.2, 1.1, k); p.box(-2.7, 0, 2, 1.1, k); p.box(-2.7, 2.4, 2.2, 1.1, k);
    // A
    p.line(1.2, 3, 2.8, -3, 1.2, k); p.line(4.4, 3, 2.8, -3, 1.2, k); p.box(2.8, 0.8, 2.2, 1.1, k);
  },
  // HUAWEI — the splayed red petals (flower fan).
  huawei(p) {
    const r = "#cf0a2c";
    for (let i = 0; i < 8; i++) {
      const a = -1.0 + (i / 7) * 2.0;
      p.line(0, 5, Math.sin(a) * 6, 5 - Math.cos(a) * 9, 1.4, r);
    }
    p.disc(0, 5, 1.2, r);
  },
  // DHL — the red three-line speedmark.
  dhl(p) {
    const r = "#d40511";
    p.poly([[-9, -3], [4, -3], [2, -1.4], [-11, -1.4]], r);
    p.poly([[-8, -0.6], [6, -0.6], [4, 1], [-10, 1]], r);
    p.poly([[-9, 1.8], [4, 1.8], [2, 3.4], [-11, 3.4]], r);
  },
  // FEDEX — the hidden arrow in negative space.
  fedex(p) {
    const o = "#ff6600";
    p.box(-4, 0, 8, 9, o); // left block
    p.poly([[1, -4.5], [7, 0], [1, 4.5]], o); // arrowhead block
    p.poly([[-1, -1.6], [3.2, -1.6], [3.2, -3], [6.2, 0], [3.2, 3], [3.2, 1.6], [-1, 1.6]], "#4d148c"); // carve arrow
  },
  // UPS — the shield with a bow on top.
  ups(p) {
    const g = "#ffb500", d = "#3a2410";
    p.poly([[-6, -3], [6, -3], [6, 1], [0, 6], [-6, 1]], g); // shield
    p.poly([[-4, -3], [4, -3], [2.4, -5.5], [-2.4, -5.5]], g); // bow
    p.line(-2.4, -5.5, 2.4, -5.5, 1, g);
    p.ring(0, 0.5, 2.6, 0.9, d); // suggest the knot detail
  },
  // AMAZON — the orange smile arrow (a→z curve with an arrowhead at the right).
  amazon(p) {
    const o = "#ff9900";
    p.arc(0, -3, 7, 1.6, Math.PI - 0.95, Math.PI + 0.95, o); // upward smile near the base
    p.poly([[5.2, 0.4], [8.2, 1.9], [4.6, 3.2]], o); // arrowhead
  },
  // GOOGLE — the four-colour "G".
  google(p) {
    p.arc(0, 0, 5.5, 1.6, -2.7, -0.1, "#fbbc05"); // left/bottom yellow→green span
    p.arc(0, 0, 5.5, 1.6, -2.7, -1.9, "#ea4335"); // top-left red
    p.arc(0, 0, 5.5, 1.6, 0.1, 1.3, "#34a853"); // bottom green
    p.arc(0, 0, 5.5, 1.6, 1.3, 2.6, "#4285f4"); // right blue
    p.box(3.5, 0, 4, 1.8, "#4285f4"); // the crossbar
  },
  // BET365 — yellow badge with a green play wedge.
  bet365(p) {
    const y = "#ffe600", g = "#027b5b";
    p.ellipse(0, 0, 8, 4.6, y);
    p.tri(-2, -2.4, -2, 2.4, 2.6, 0, g); // play triangle
  },
  // WILLIAM HILL — yellow shield with a navy bar.
  williamhill(p) {
    const y = "#ffd200", b = "#00263e";
    p.poly([[-6, -4], [6, -4], [6, 1], [0, 5.5], [-6, 1]], y);
    p.box(0, -1, 8, 1.8, b);
  },
  // BETWAY — the green wave + dot.
  betway(p) {
    const g = "#00b14f";
    p.poly([[-9, 2], [-3, -3], [3, 2], [9, -3], [9, 0], [3, 5], [-3, 0], [-9, 5]], g);
    p.disc(8.5, -4, 1.3, g);
  },
  // 888SPORT — three orange rings.
  triple8(p) {
    const o = "#ff7a00";
    p.ring(-6, 0, 2.6, 1, o);
    p.ring(0, 0, 2.6, 1, o);
    p.ring(6, 0, 2.6, 1, o);
  },
  // FIFA WORLD CUP 2026 — trophy mark with tri-colour handles (US blue, Canada red)
  // and a star crown. Geometric recreation; not a copy of the official artwork.
  fifa2026(p) {
    const gold = "#f0b800", red = "#bf0a30", blue = "#003087";
    p.star(0, -5.2, 2.0, 0.82, 5, 0, gold);
    p.poly([[-5, -3.2], [5, -3.2], [3.6, 1.4], [-3.6, 1.4]], gold);
    p.line(-5, -2.4, -7.8, -0.6, 1.6, red);
    p.line(-7.8, -0.6, -5, 1.4, 1.6, red);
    p.line(5, -2.4, 7.8, -0.6, 1.6, blue);
    p.line(7.8, -0.6, 5, 1.4, 1.6, blue);
    p.box(0, 2.8, 2.6, 2.8, gold);
    p.box(0, 4.8, 8.5, 1.5, gold);
  },
};

// The 64-brand pool. `bg` paints the board; `draw` lays the emblem. `name` is for
// debugging only and is never rendered.
export const SPONSORS = [
  { name: "EMIRATES", bg: "#ffffff", draw: L.emirates },
  { name: "ETIHAD", bg: "#14110c", draw: L.etihad },
  { name: "QATAR AIRWAYS", bg: "#5a1030", draw: L.qatar },
  { name: "TURKISH", bg: "#c8102e", draw: L.turkish },
  { name: "HEINEKEN", bg: "#0a7d00", draw: L.heineken },
  { name: "BUDWEISER", bg: "#b21a23", draw: L.budweiser },
  { name: "CARLSBERG", bg: "#00582a", draw: L.carlsberg },
  { name: "COCA-COLA", bg: "#e41b17", draw: L.cocacola },
  { name: "PEPSI", bg: "#004b93", draw: L.pepsi },
  { name: "MCDONALD'S", bg: "#d52b1e", draw: L.mcdonalds },
  { name: "KFC", bg: "#e4002b", draw: L.kfc },
  { name: "BURGER KING", bg: "#f5e7c8", draw: L.burgerking },
  { name: "LAY'S", bg: "#ffd200", draw: L.lays },
  { name: "SNICKERS", bg: "#2a1c0e", draw: L.snickers },
  { name: "OREO", bg: "#1d4f9b", draw: L.oreo },
  { name: "NESTLE", bg: "#ffffff", draw: L.nestle },
  { name: "VISA", bg: "#ffffff", draw: L.visa },
  { name: "MASTERCARD", bg: "#16181d", draw: L.mastercard },
  { name: "BARCLAYS", bg: "#00263e", draw: L.barclays },
  { name: "SANTANDER", bg: "#ec0000", draw: L.santander },
  { name: "HSBC", bg: "#ffffff", draw: L.hsbc },
  { name: "STANDARD CHARTERED", bg: "#ffffff", draw: L.stanchart },
  { name: "BNP PARIBAS", bg: "#007a53", draw: L.bnp },
  { name: "CAIXABANK", bg: "#ffffff", draw: L.caixa },
  { name: "NATWEST", bg: "#5a287d", draw: L.natwest },
  { name: "ALLIANZ", bg: "#003781", draw: L.allianz },
  { name: "AXA", bg: "#00008f", draw: L.axa },
  { name: "AIG", bg: "#003da5", draw: L.aig },
  { name: "PRUDENTIAL", bg: "#ffffff", draw: L.prudential },
  { name: "GAZPROM", bg: "#005aa0", draw: L.gazprom },
  { name: "ARAMCO", bg: "#00833e", draw: L.aramco },
  { name: "SHELL", bg: "#ed1c24", draw: L.shell },
  { name: "BP", bg: "#0b3d2e", draw: L.bp },
  { name: "TOTAL", bg: "#ffffff", draw: L.total },
  { name: "EXXON", bg: "#ffffff", draw: L.exxon },
  { name: "HYUNDAI", bg: "#002c5f", draw: L.hyundai },
  { name: "KIA", bg: "#bb162b", draw: L.kia },
  { name: "TOYOTA", bg: "#e50012", draw: L.toyota },
  { name: "NISSAN", bg: "#c3002f", draw: L.nissan },
  { name: "VOLKSWAGEN", bg: "#001e50", draw: L.volkswagen },
  { name: "AUDI", bg: "#111111", draw: L.audi },
  { name: "BMW", bg: "#0a2c5e", draw: L.bmw },
  { name: "MERCEDES", bg: "#111111", draw: L.mercedes },
  { name: "FORD", bg: "#ffffff", draw: L.ford },
  { name: "JEEP", bg: "#2a3322", draw: L.jeep },
  { name: "VODAFONE", bg: "#e60000", draw: L.vodafone },
  { name: "ORANGE", bg: "#ff7900", draw: L.orange },
  { name: "MOVISTAR", bg: "#019df4", draw: L.movistar },
  { name: "ATT", bg: "#0568ae", draw: L.att },
  { name: "VERIZON", bg: "#ffffff", draw: L.verizon },
  { name: "SAMSUNG", bg: "#1428a0", draw: L.samsung },
  { name: "SONY", bg: "#111111", draw: L.sony },
  { name: "INTEL", bg: "#0071c5", draw: L.intel },
  { name: "EA SPORTS", bg: "#ffffff", draw: L.ea },
  { name: "HUAWEI", bg: "#ffffff", draw: L.huawei },
  { name: "DHL", bg: "#ffcc00", draw: L.dhl },
  { name: "FEDEX", bg: "#4d148c", draw: L.fedex },
  { name: "UPS", bg: "#341b14", draw: L.ups },
  { name: "AMAZON", bg: "#111111", draw: L.amazon },
  { name: "GOOGLE", bg: "#ffffff", draw: L.google },
  { name: "BET365", bg: "#027b5b", draw: L.bet365 },
  { name: "WILLIAM HILL", bg: "#00263e", draw: L.williamhill },
  { name: "BETWAY", bg: "#111111", draw: L.betway },
  { name: "888SPORT", bg: "#111111", draw: L.triple8 },
];

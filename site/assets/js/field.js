/*
 * Carte d'accueil : DBSCAN en direct sur des points de vente simulés.
 * - Les points apparaissent, puis chaque cluster s'étend depuis son point d'origine
 *   dans l'ordre exact de l'exploration de l'algorithme (parcours en largeur).
 * - Le curseur montre le rayon eps et le nombre de voisins.
 * - Un clic ajoute des points ; le curseur "eps" relance le calcul.
 * - Chaque chargement (et "Réinitialiser") tire une nouvelle carte : nombre de quartiers,
 *   de points et de bruit aléatoires, donc un nombre de clusters différent (2 à 7).
 */
(() => {
  "use strict";

  const canvas = document.getElementById("field");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  const hero = canvas.parentElement;
  const textEl = document.getElementById("hero-text");
  const probeEl = document.getElementById("probe");
  const slider = document.getElementById("eps");
  const epsOut = document.getElementById("eps-value");
  const readout = document.getElementById("readout");
  const resetBtn = document.getElementById("reset");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Couleurs lues dans les variables CSS : relues à chaque changement de thème
  let PALETTE = [];
  let C = {};
  function readColors() {
    const st = getComputedStyle(document.documentElement);
    const v = (name) => st.getPropertyValue(name).trim();
    PALETTE = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7"].map(v);
    C = { text: v("--text"), faint: v("--faint"), line: v("--line"), muted: v("--muted") };
  }
  readColors();

  const MIN_SAMPLES = 4;
  const MAX_POINTS = 1100;

  // Dakar : 14.69° N, 17.45° O — sert de repère au quadrillage
  const LAT_TOP = 14.78;
  const LON_LEFT = 17.56;
  const GRID = 96; // px entre deux lignes
  const DEG_PER_LINE = 0.01;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let pts = [];
  let eps = Number(slider.value);
  let result = null; // { lab, depth, core, k, colorOf }
  let appear = []; // instant d'apparition de chaque point (ms)
  let colorAt = []; // instant où chaque point prend la couleur de son cluster (ms)
  let noiseAt = Infinity;
  let animEnd = 0;
  let t0 = 0;
  let mouse = null;
  let ripples = [];
  let frame = 0;
  let lastWidth = 0;

  const gridLayer = document.createElement("canvas");
  const gctx = gridLayer.getContext("2d");
  const haloLayer = document.createElement("canvas");
  const hctx = haloLayer.getContext("2d");

  /* ---------- Hasard : nouvelle graine à chaque chargement et à chaque "Réinitialiser" ---------- */
  // La graine reste la même pendant un redimensionnement, pour que la carte ne saute pas.
  const newSeed = () => (Math.random() * 4294967296) >>> 0;
  let seed = newSeed();

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rand) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ---------- Zone où vivent les clusters (hors du texte et du panneau) ---------- */
  function clusterRegion() {
    const h = hero.getBoundingClientRect();
    const t = textEl.getBoundingClientRect();
    const p = probeEl.getBoundingClientRect();
    const wide = W >= 900;
    let x0, x1, y0, y1;

    if (wide) {
      x0 = Math.min(t.right - h.left + 40, W * 0.62);
      x1 = W - 96;
      y0 = 120;
      y1 = Math.max(p.top - h.top - 24, H * 0.55);
      if (x1 - x0 < 260) x0 = W * 0.45;
    } else {
      x0 = 20;
      x1 = W - 20;
      y0 = t.bottom - h.top + 24;
      y1 = p.top - h.top - 20;
      if (y1 - y0 < 160) {
        y0 = H * 0.45;
        y1 = H * 0.75;
      }
    }
    // Rectangles à garder lisibles (texte, panneau, barre de navigation)
    const pad = 18;
    const keepOut = [
      { x0: 0, y0: 0, x1: W, y1: 84 },
      { x0: t.left - h.left - pad, y0: t.top - h.top - pad, x1: t.right - h.left + pad, y1: t.bottom - h.top + pad },
      { x0: p.left - h.left - pad, y0: p.top - h.top - pad, x1: p.right - h.left + pad, y1: p.bottom - h.top + pad },
    ];
    return { x0, x1, y0, y1, wide, keepOut };
  }

  /* ---------- Génération des points ---------- */
  function generate() {
    const rand = mulberry32(seed);
    const r = clusterRegion();
    const rw = r.x1 - r.x0;
    const rh = r.y1 - r.y0;
    const area = rw * rh;
    // Nombre de quartiers tiré au hasard, borné par la place disponible
    const kMax = Math.round(Math.min(7, Math.max(3, area / 40000)));
    const k = 2 + Math.floor(rand() * (kMax - 1)); // entre 2 et kMax
    // Nombre de points tiré au hasard autour de la densité de référence (×0.55 à ×1.45)
    const nBase = area / 620;
    const nClustered = Math.round(Math.min(640, Math.max(110, nBase * (0.55 + rand() * 0.9))));
    // Moins de points => quartiers plus serrés, pour qu'ils ne se cassent pas en miettes
    const density = Math.sqrt(nClustered / Math.max(1, nBase));
    const sigma = Math.max(14, (Math.sqrt(area / k) / (6.5 + rand() * 2)) * Math.min(1.1, density));
    const out = [];

    const clampPt = (x, y) => ({
      x: Math.min(W - 6, Math.max(6, x)),
      y: Math.min(H - 6, Math.max(6, y)),
    });

    // Centres éloignés les uns des autres
    const centers = [];
    let guard = 0;
    while (centers.length < k && guard++ < 500) {
      const c = {
        x: r.x0 + sigma * 1.5 + rand() * Math.max(1, rw - sigma * 3),
        y: r.y0 + sigma * 1.5 + rand() * Math.max(1, rh - sigma * 3),
      };
      if (centers.every((d) => Math.hypot(d.x - c.x, d.y - c.y) > sigma * 4.2)) centers.push(c);
    }

    // Une "route" : cluster allongé, que DBSCAN sait reconnaître
    // Pas toujours de route : une fois sur trois, la carte n'en a pas
    const roadShare = rand() < 0.33 ? 0 : 0.1 + rand() * 0.08;
    const nRoad = Math.round(nClustered * roadShare);
    const a = { x: r.x0 + rw * 0.05, y: r.y0 + rh * (0.75 + rand() * 0.2) };
    const b = { x: r.x0 + rw * (0.55 + rand() * 0.35), y: r.y0 + rh * (0.55 + rand() * 0.25) };
    for (let i = 0; i < nRoad; i++) {
      const s = rand();
      const nx = -(b.y - a.y);
      const ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      const off = gauss(rand) * 5;
      out.push(clampPt(a.x + (b.x - a.x) * s + (nx / len) * off, a.y + (b.y - a.y) * s + (ny / len) * off));
    }

    // Les quartiers : nuages gaussiens de tailles variées
    const weights = centers.map(() => 0.5 + rand());
    const wsum = weights.reduce((s, w) => s + w, 0);
    centers.forEach((c, i) => {
      const n = Math.max(30, Math.round(((nClustered - nRoad) * weights[i]) / wsum));
      // Étalement plafonné pour que le cœur du quartier reste assez dense pour DBSCAN
      const sMax = 24 * Math.sqrt(n / 25);
      const sx = Math.min(sMax, sigma * (0.7 + rand() * 0.6));
      const sy = Math.min(sMax, sigma * (0.7 + rand() * 0.6));
      for (let j = 0; j < n; j++) out.push(clampPt(c.x + gauss(rand) * sx, c.y + gauss(rand) * sy));
    });

    // Bruit : points isolés sur toute la carte
    const nNoise = Math.round(Math.min(90, Math.max(16, ((W * H) / 18000) * (0.5 + rand()))));
    const free = (x, y) => r.keepOut.every((k) => x < k.x0 || x > k.x1 || y < k.y0 || y > k.y1);
    for (let i = 0, tries = 0; i < nNoise && tries < nNoise * 20; tries++) {
      const x = 6 + rand() * (W - 12);
      const y = 6 + rand() * (H - 12);
      if (free(x, y)) {
        out.push({ x, y });
        i++;
      }
    }

    return out;
  }

  /* ---------- DBSCAN (grille spatiale, O(n·voisins)) ---------- */
  function dbscan(points, radius) {
    const n = points.length;
    const cell = radius;
    const grid = new Map();
    const key = (cx, cy) => cx * 73856093 + cy * 19349663;

    for (let i = 0; i < n; i++) {
      const k = key(Math.floor(points[i].x / cell), Math.floor(points[i].y / cell));
      let bucket = grid.get(k);
      if (!bucket) grid.set(k, (bucket = []));
      bucket.push(i);
    }

    const r2 = radius * radius;
    const neigh = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      const list = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(key(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const j of bucket) {
            const q = points[j];
            const ex = q.x - p.x;
            const ey = q.y - p.y;
            if (ex * ex + ey * ey <= r2) list.push(j);
          }
        }
      }
      neigh[i] = list; // inclut le point lui-même, comme scikit-learn
    }

    const UNVISITED = -2;
    const NOISE = -1;
    const lab = new Int32Array(n).fill(UNVISITED);
    const depth = new Int32Array(n);
    const core = new Uint8Array(n);
    for (let i = 0; i < n; i++) core[i] = neigh[i].length >= MIN_SAMPLES ? 1 : 0;

    let k = 0;
    for (let i = 0; i < n; i++) {
      if (lab[i] !== UNVISITED) continue;
      if (!core[i]) {
        lab[i] = NOISE;
        continue;
      }
      lab[i] = k;
      depth[i] = 0;
      const queue = [i];
      for (let h = 0; h < queue.length; h++) {
        const p = queue[h];
        if (!core[p]) continue;
        for (const j of neigh[p]) {
          if (lab[j] === NOISE) {
            lab[j] = k; // point de bordure
            depth[j] = depth[p] + 1;
          } else if (lab[j] === UNVISITED) {
            lab[j] = k;
            depth[j] = depth[p] + 1;
            queue.push(j);
          }
        }
      }
      k++;
    }

    // Couleurs stables : clusters triés de gauche à droite
    const sumX = new Float64Array(k);
    const count = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      if (lab[i] >= 0) {
        sumX[lab[i]] += points[i].x;
        count[lab[i]]++;
      }
    }
    const order = Array.from({ length: k }, (_, c) => c).sort(
      (c1, c2) => sumX[c1] / count[c1] - sumX[c2] / count[c2]
    );
    const colorOf = new Array(k);
    const rank = new Int32Array(k);
    order.forEach((c, r) => {
      colorOf[c] = PALETTE[r % PALETTE.length];
      rank[c] = r;
    });

    let noise = 0;
    for (let i = 0; i < n; i++) if (lab[i] === NOISE) noise++;

    return { lab, depth, core, k, colorOf, rank, noise, neigh };
  }

  /* ---------- Calendrier de l'animation ---------- */
  function schedule(animate) {
    const n = pts.length;
    appear = new Array(n);
    colorAt = new Array(n);
    if (!animate) {
      // Tout est déjà visible : instants à -Infinity pour que les fondus soient terminés
      appear.fill(-Infinity);
      colorAt.fill(-Infinity);
      noiseAt = -Infinity;
      animEnd = 0;
      return;
    }
    const rand = mulberry32(7);
    let maxT = 0;
    for (let i = 0; i < n; i++) {
      appear[i] = rand() * 650;
      const c = result.lab[i];
      if (c >= 0) {
        colorAt[i] = 950 + result.rank[c] * 170 + result.depth[i] * 42;
        if (colorAt[i] > maxT) maxT = colorAt[i];
      } else {
        colorAt[i] = Infinity;
      }
    }
    noiseAt = maxT + 150;
    animEnd = noiseAt + 400;
  }

  /* ---------- Quadrillage façon carte ---------- */
  function drawGrid() {
    gridLayer.width = W * dpr;
    gridLayer.height = H * dpr;
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.clearRect(0, 0, W, H);
    gctx.strokeStyle = C.line;
    gctx.globalAlpha = 0.55;
    gctx.lineWidth = 1;
    gctx.beginPath();
    for (let x = GRID; x < W; x += GRID) {
      gctx.moveTo(Math.round(x) + 0.5, 0);
      gctx.lineTo(Math.round(x) + 0.5, H);
    }
    for (let y = GRID; y < H; y += GRID) {
      gctx.moveTo(0, Math.round(y) + 0.5);
      gctx.lineTo(W, Math.round(y) + 0.5);
    }
    gctx.stroke();

    gctx.globalAlpha = 1;
    gctx.fillStyle = C.faint;
    gctx.font = '500 9px "Martian Mono", ui-monospace, monospace';
    gctx.textBaseline = "bottom";
    let i = 1;
    for (let x = GRID; x < W - 60; x += GRID, i++) {
      if (i % 2) continue;
      gctx.fillText(`${(LON_LEFT - i * DEG_PER_LINE).toFixed(2)}° O`, x + 5, H - 8);
    }
    gctx.textAlign = "right";
    gctx.textBaseline = "top";
    i = 1;
    for (let y = GRID; y < H - 40; y += GRID, i++) {
      if (i % 2) continue;
      gctx.fillText(`${(LAT_TOP - i * DEG_PER_LINE).toFixed(2)}° N`, W - 8, y + 5);
    }
  }

  /* ---------- Rendu ---------- */
  const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  function render(now) {
    frame = 0;
    const t = now - t0;
    const n = pts.length;
    const { lab, core, colorOf } = result;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(gridLayer, 0, 0, W, H);

    // Zones de couverture : un disque par point de cluster, aplati sur un calque
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, W, H);
    const haloR = eps * 0.62;
    for (let i = 0; i < n; i++) {
      const c = lab[i];
      if (c < 0 || t < colorAt[i]) continue;
      const g = easeOut((t - colorAt[i]) / 380);
      hctx.fillStyle = colorOf[c];
      hctx.beginPath();
      hctx.arc(pts[i].x, pts[i].y, haloR * g, 0, Math.PI * 2);
      hctx.fill();
    }
    ctx.globalAlpha = 0.2;
    ctx.drawImage(haloLayer, 0, 0, W, H);
    ctx.globalAlpha = 1;

    // Voisinage sous le curseur
    let hovered = null;
    const r2 = eps * eps;
    if (mouse) {
      hovered = new Set();
      for (let i = 0; i < n; i++) {
        const dx = pts[i].x - mouse.x;
        const dy = pts[i].y - mouse.y;
        if (dx * dx + dy * dy <= r2) hovered.add(i);
      }
    }

    // Points
    for (let i = 0; i < n; i++) {
      if (t < appear[i]) continue;
      const a = easeOut((t - appear[i]) / 300);
      const p = pts[i];
      const c = lab[i];
      const big = hovered && hovered.has(i) ? 1.6 : 1;
      ctx.globalAlpha = a;

      if (c >= 0 && t >= colorAt[i]) {
        const g = easeOut((t - colorAt[i]) / 260);
        ctx.fillStyle = colorOf[c];
        ctx.beginPath();
        ctx.arc(p.x, p.y, (core[i] ? 3 : 2.4) * big * (0.6 + 0.4 * g), 0, Math.PI * 2);
        ctx.fill();
      } else if (c < 0 && t >= noiseAt) {
        ctx.strokeStyle = C.muted;
        ctx.lineWidth = 1;
        ctx.globalAlpha = a * 0.75;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6 * big, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = C.faint;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 * big, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Ondes de clic
    ripples = ripples.filter((rp) => now - rp.t < 700);
    for (const rp of ripples) {
      const k = (now - rp.t) / 700;
      ctx.strokeStyle = C.text;
      ctx.globalAlpha = 0.5 * (1 - k);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, eps * (0.4 + k * 1.4), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Sonde : cercle eps + nombre de voisins
    if (mouse) {
      const count = hovered.size;
      const isCore = count >= MIN_SAMPLES;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isCore ? C.text : C.muted;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, eps, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = '500 10px "Martian Mono", ui-monospace, monospace';
      ctx.fillStyle = isCore ? C.text : C.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const label = `${count} voisin${count > 1 ? "s" : ""}${isCore ? " · point central" : ""}`;
      const lx = mouse.x + eps + 8 > W - 150 ? mouse.x - eps - 8 : mouse.x + eps + 8;
      ctx.textAlign = lx < mouse.x ? "right" : "left";
      ctx.fillText(label, lx, mouse.y);
    }

    if (t < animEnd || ripples.length) requestRender();
  }

  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  /* ---------- Nouvelle carte : on garde un tirage qui donne entre 2 et 7 clusters ---------- */
  function freshMap() {
    const epsRef = Number(slider.defaultValue) || 24;
    const firstSeed = seed;
    let first = null;
    for (let tries = 0; tries < 12; tries++) {
      const candidate = generate();
      const k = dbscan(candidate, epsRef).k;
      if (k >= 2 && k <= PALETTE.length) return candidate;
      if (!first) first = candidate;
      seed = newSeed();
    }
    seed = firstSeed; // aucun tirage dans la plage : on garde le premier
    return first;
  }

  /* ---------- Calcul + affichage du résultat ---------- */
  function compute() {
    result = dbscan(pts, eps);
    const k = result.k;
    readout.textContent = `→ ${k} cluster${k > 1 ? "s" : ""} · ${result.noise} point${
      result.noise > 1 ? "s" : ""
    } isolé${result.noise > 1 ? "s" : ""}`;
  }

  function resize(force) {
    const rect = hero.getBoundingClientRect();
    const newW = Math.round(rect.width);
    const newH = Math.round(rect.height);
    // Sur mobile, la barre d'adresse change la hauteur : on ne régénère que si la largeur change
    if (!force && newW === lastWidth && Math.abs(newH - H) < 120) return;
    const first = lastWidth === 0;
    lastWidth = newW;
    W = newW;
    H = newH;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    haloLayer.width = W * dpr;
    haloLayer.height = H * dpr;
    drawGrid();
    // Premier affichage : nouveau tirage. Redimensionnement : même graine, carte recalée.
    pts = first ? freshMap() : generate();
    compute();
    schedule(first && !reduceMotion);
    t0 = performance.now();
    requestRender();
  }

  /* ---------- Interactions ---------- */
  slider.addEventListener("input", () => {
    eps = Number(slider.value);
    epsOut.textContent = `${eps} px`;
    compute();
    schedule(false);
    requestRender();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    requestRender();
  });

  canvas.addEventListener("pointerleave", () => {
    mouse = null;
    requestRender();
  });

  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const rand = Math.random;
    const add = 9;
    if (pts.length + add > MAX_POINTS) pts.splice(0, add);
    for (let i = 0; i < add; i++) {
      pts.push({ x: x + gauss(rand) * eps * 0.45, y: y + gauss(rand) * eps * 0.45 });
    }
    compute();
    schedule(false);
    if (!reduceMotion) ripples.push({ x, y, t: performance.now() });
    requestRender();
  });

  resetBtn.addEventListener("click", () => {
    slider.value = "24";
    eps = 24;
    epsOut.textContent = "24 px";
    seed = newSeed();
    pts = freshMap();
    compute();
    schedule(!reduceMotion);
    t0 = performance.now();
    requestRender();
  });

  window.addEventListener("themechange", () => {
    readColors();
    if (!W) return; // carte pas encore dessinée
    drawGrid();
    compute();
    requestRender();
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => resize(false), 150);
  });

  // Attendre les polices pour placer les clusters à côté du vrai bloc de texte
  const start = () => resize(true);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(start, start);
  } else {
    start();
  }
})();

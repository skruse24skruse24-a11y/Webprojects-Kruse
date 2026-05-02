(function () {
  "use strict";

  /** Roster will expand to 6 capitals; this build only ships A. */
  const ALLOWED_GLYPHS = new Set(["A", "R"]);

  const NAME_MSG_EXTRA =
    "Maximum length reached.";
  const NAME_MSG_LOWER =
    "Uppercase letters only.";
  const NAME_MSG_WRONG =
    "Unsupported letter.";

  const AXES = [
    { tag: "THIC", inputId: "axis-thickness", valueId: "axis-thickness-value" },
    { tag: "VARI", inputId: "axis-variation", valueId: "axis-variation-value" },
  ];

  const letter = document.getElementById("viewport-letter");
  const frame = document.getElementById("viewport-frame");
  const nameInput = document.getElementById("glyph-name");

  // Cache static NodeLists — DOM structure never changes after load, so we
  // query once and reuse on every sync() instead of calling querySelectorAll
  // four times per render cycle.
  const _fillPanels     = [...document.querySelectorAll("[data-fill-for]")];
  const _bgPanels       = [...document.querySelectorAll("[data-bg-for]")];
  const _bgAdjustNodes  = [...document.querySelectorAll("[data-bg-adjust-for]")];
  const _classTicks     = [...document.querySelectorAll(".class-tick")];

  const CLASS_STOPS = [0, 125, 250, 375, 500, 625, 750, 875, 1000];
  const CLASS_NAMES = [
    "Unknown",
    "Luck",
    "Charisma",
    "Wisdom",
    "Strength",
    "None",
    "Intelligence",
    "Constitution",
    "Agility",
  ];

  function getSelectedFillMode() {
    const r = document.querySelector('input[name="letter-fill-mode"]:checked');
    return r ? r.value : "solid";
  }


  function isFillModeOn(mode) {
    return getSelectedFillMode() === mode;
  }

  function anyFillModeOn() {
    return getSelectedFillMode() !== "solid";
  }

  /** Multiclass: bracketing stops around raw slider value (inclusive segment between stops). */
  function classBracketStops(v) {
    const sv = clamp(Number(v), 0, 1000);
    if (sv <= CLASS_STOPS[0]) return [CLASS_STOPS[0]];
    if (sv >= CLASS_STOPS[CLASS_STOPS.length - 1]) return [CLASS_STOPS[CLASS_STOPS.length - 1]];
    for (let i = 0; i < CLASS_STOPS.length - 1; i += 1) {
      const a = CLASS_STOPS[i];
      const b = CLASS_STOPS[i + 1];
      if (sv >= a && sv <= b) return a === b ? [a] : [a, b];
    }
    return [nearestClassStop(sv)];
  }

  let lastValidGlyph = "A";
  /** True while a batch control update is in progress; suppresses cascading sync() calls. */
  let _batchUpdate = false;
  /** Caches the last buildHalftoneSvg() result to avoid re-encoding an unchanged SVG on every sync(). */
  let _halftoneCache = null;

  function setLetterChar(c) {
    if (!letter) return;
    letter.textContent = c;
    // Use specific font for A, default font for others (R)
    if (c === "A") {
      letter.style.fontFamily = '"Character Creator A"';
    } else {
      letter.style.fontFamily = '"Character Creator"';
    }
  }

  function nearestClassStop(v) {
    return CLASS_STOPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best));
  }

  function classNameForStop(stop) {
    const i = CLASS_STOPS.indexOf(stop);
    return i >= 0 ? CLASS_NAMES[i] : "—";
  }

  /**
   * SVG tiles that repeat seamlessly; color comes from the picker.
   * Sizes are large enough to read clearly before fill-pattern-scale / backdrop-pattern-scale scaling.
   */
  function svgUrl(svg) {
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  function getSelectedBackdropMode() {
    const r = document.querySelector('input[name="backdrop-mode"]:checked');
    return r ? r.value : "none";
  }


  function previewBgHex() {
    return el("preview-bg-color")?.value ?? "#1a1410";
  }

  function dotHash2(i, j, seed) {
    const x = Math.sin(i * 12.9898 + j * 78.233 + seed * 0.001) * 43758.5453;
    return x - Math.floor(x);
  }


  /** SVG shape markup for a single dot in backdrop dot patterns. */
  function backdropDotShapeSvg(shape, cx, cy, r, color) {
    switch (shape) {
      case "square": {
        const s = r * 1.6;
        return `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="${color}"/>`;
      }
      case "triangle": {
        const h = r * 1.5;
        const w = r * 1.73;
        return `<polygon points="${cx},${cy - h} ${cx - w},${cy + h * 0.6} ${cx + w},${cy + h * 0.6}" fill="${color}"/>`;
      }
      case "star": {
        const pts = 5;
        const inner = r * 0.42;
        let d = "";
        for (let k = 0; k < 2 * pts; k += 1) {
          const rad = k % 2 === 0 ? r : inner;
          const a = (Math.PI / pts) * k - Math.PI / 2;
          d += `${k === 0 ? "M" : "L"}${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
        }
        return `<path d="${d}Z" fill="${color}"/>`;
      }
      case "hex": {
        let d = "";
        for (let k = 0; k < 6; k += 1) {
          const a = (Math.PI / 3) * k - Math.PI / 6;
          d += `${k === 0 ? "M" : "L"}${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
        }
        return `<path d="${d}Z" fill="${color}"/>`;
      }
      case "diamond":
        return `<polygon points="${cx},${cy - r} ${cx + r * 0.7},${cy} ${cx},${cy + r} ${cx - r * 0.7},${cy}" fill="${color}"/>`;
      default: // circle
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
    }
  }

  /** Generate inline-SVG content for a stripe backdrop (straight or wavy sine). */
  function generateBackdropStripeSvg(w, h, patternColor, baseColor) {
    const f = backdropPatternFactor();
    const ang = Number(el("backdrop-stripes-angle")?.value ?? -45);
    const bandW = Math.max(1, Number(el("backdrop-stripes-band")?.value ?? 4));
    const gap = Math.max(1, Number(el("backdrop-stripes-gap")?.value ?? 14));
    const waveAmp = Number(el("backdrop-stripes-wave-amp")?.value ?? 0);
    const waveFreq = Math.max(1, Number(el("backdrop-stripes-wave-freq")?.value ?? 4));

    // Tile height must fit the stroke+wave plus the gap between stripes
    const stripeExtent = waveAmp > 0.5 ? bandW + 2 * waveAmp : bandW;
    const tileH = stripeExtent + gap;
    const cy = tileH / 2;
    const tileW = waveAmp > 0.5 ? Math.max(40, 300 / waveFreq) : 100;

    let stripeContent;
    if (waveAmp < 0.5) {
      // Slight overlap prevents sub-pixel seams between tiles
      stripeContent = `<rect x="-0.5" y="${cy - bandW / 2}" width="${tileW + 1}" height="${bandW}" fill="${patternColor}"/>`;
    } else {
      // Sine wave path — extend past tile edges to prevent butt-cap cutouts at seams
      const steps = Math.max(40, Math.ceil(tileW * 2));
      const extend = bandW;  // extra length past each edge
      const totalW = tileW + 2 * extend;
      const pts = [];
      for (let i = 0; i <= steps; i += 1) {
        const x = -extend + (i / steps) * totalW;
        const dy = waveAmp * Math.sin((2 * Math.PI * x) / tileW);
        pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${(cy + dy).toFixed(2)}`);
      }
      stripeContent = `<path d="${pts.join("")}" stroke="${patternColor}" stroke-width="${bandW}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    // Expand fill to cover corners when rotated
    const diag = Math.sqrt(w * w + h * h);
    const ox = (diag - w) / 2;
    const oy = (diag - h) / 2;

    return `<defs>
      <pattern id="bg-stripe-pat" x="0" y="0" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang} ${w / 2} ${h / 2}) scale(${f})">
        ${stripeContent}
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="${baseColor}"/>
    <rect x="${-ox}" y="${-oy}" width="${diag}" height="${diag}" fill="url(#bg-stripe-pat)"/>`;
  }

  /** Generate inline-SVG content for a dot backdrop with shapes, jitter, and size variation. */
  function generateBackdropDotsSvg(w, h, patternColor, baseColor) {
    const f = backdropPatternFactor();
    const shape = el("backdrop-dots-shape")?.value ?? "circle";
    const spacing = Math.max(4, Number(el("backdrop-dots-spacing")?.value ?? 44) * f);
    const baseR = Math.max(0.5, Number(el("backdrop-dots-radius")?.value ?? 5) * f);
    const sizeVar = clamp(Number(el("backdrop-dots-size-var")?.value ?? 0), 0, 100) / 100;
    const rowSt = (Number(el("backdrop-dots-row-stagger")?.value ?? 0) / 100) * (spacing * 0.5);
    const colSt = (Number(el("backdrop-dots-col-stagger")?.value ?? 0) / 100) * (spacing * 0.5);
    const jitterPct = clamp(Number(el("backdrop-dots-jitter")?.value ?? 0), 0, 100) / 100;
    const seed = Number(el("backdrop-dots-seed")?.value ?? 42);

    const cols = Math.ceil(w / spacing) + 2;
    const rows = Math.ceil(h / spacing) + 2;
    const startX = -spacing;
    const startY = -spacing;

    const segments = [];
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const hash1 = dotHash2(i, j, seed);
        const hash2 = dotHash2(i + 17, j + 41, seed + 3);
        const hash3 = dotHash2(i + 31, j + 71, seed + 7);

        const jx = jitterPct * (hash1 - 0.5) * 2 * spacing * 0.3;
        const jy = jitterPct * (hash2 - 0.5) * 2 * spacing * 0.3;

        const cx = startX + i * spacing + spacing / 2 + (j % 2 === 1 ? rowSt : 0) + jx;
        const cy = startY + j * spacing + spacing / 2 + (i % 2 === 1 ? colSt : 0) + jy;

        const sizeMultiplier = sizeVar > 0 ? (1 - sizeVar + sizeVar * 2 * hash3) : 1;
        const r = baseR * sizeMultiplier;

        segments.push(backdropDotShapeSvg(shape, cx, cy, r, patternColor));
      }
    }

    return `<rect width="100%" height="100%" fill="${baseColor}"/>
    ${segments.join("")}`;
  }

  /** Generate inline-SVG content for a grid backdrop (straight or wavy lines). */
  function generateBackdropGridSvg(w, h, patternColor, baseColor) {
    const f = backdropPatternFactor();
    const cell = Math.max(4, Number(el("backdrop-grid-cell")?.value ?? 48));
    const sw = Math.max(0.5, Number(el("backdrop-grid-line")?.value ?? 2));
    const rot = clamp(Number(el("backdrop-grid-rotate")?.value ?? 0), 0, 90);
    const waveAmp = Number(el("backdrop-grid-wave")?.value ?? 0);

    // Use SVG <pattern> for both straight and wavy — seamless tiling + rotation
    const diag = Math.sqrt(w * w + h * h);
    const ox = (diag - w) / 2;
    const oy = (diag - h) / 2;

    let patternContent;
    if (waveAmp < 0.5) {
      // Straight grid lines
      patternContent = `<line x1="0" y1="0" x2="${cell}" y2="0" stroke="${patternColor}" stroke-width="${sw}"/>
          <line x1="0" y1="0" x2="0" y2="${cell}" stroke="${patternColor}" stroke-width="${sw}"/>`;
    } else {
      // Wavy grid — draw sine curves at BOTH edges of tile so adjacent tiles
      // combine to form complete lines at boundaries (prevents clipping gaps)
      const steps = Math.max(30, Math.ceil(cell * 2));
      // Horizontal wavy lines at y=0 and y=cell
      const pH0 = [], pHC = [], pV0 = [], pVC = [];
      for (let i = 0; i <= steps; i += 1) {
        const x = (i / steps) * cell;
        const dy = waveAmp * Math.sin((2 * Math.PI * x) / cell);
        pH0.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${dy.toFixed(2)}`);
        pHC.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${(cell + dy).toFixed(2)}`);
      }
      // Vertical wavy lines at x=0 and x=cell
      for (let i = 0; i <= steps; i += 1) {
        const y = (i / steps) * cell;
        const dx = waveAmp * Math.sin((2 * Math.PI * y) / cell);
        pV0.push(`${i === 0 ? "M" : "L"}${dx.toFixed(2)},${y.toFixed(2)}`);
        pVC.push(`${i === 0 ? "M" : "L"}${(cell + dx).toFixed(2)},${y.toFixed(2)}`);
      }
      patternContent = `<path d="${pH0.join("")}" stroke="${patternColor}" stroke-width="${sw}" fill="none"/>
          <path d="${pHC.join("")}" stroke="${patternColor}" stroke-width="${sw}" fill="none"/>
          <path d="${pV0.join("")}" stroke="${patternColor}" stroke-width="${sw}" fill="none"/>
          <path d="${pVC.join("")}" stroke="${patternColor}" stroke-width="${sw}" fill="none"/>`;
    }

    return `<defs>
      <pattern id="bg-grid-pat" x="0" y="0" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rot} ${w / 2} ${h / 2}) scale(${f})">
        ${patternContent}
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="${baseColor}"/>
    <rect x="${-ox}" y="${-oy}" width="${diag}" height="${diag}" fill="url(#bg-grid-pat)"/>`;
  }


  function el(id) {
    return document.getElementById(id);
  }

  function patternFactor() {
    return Number(el("fill-pattern-scale")?.value ?? 240) / 100;
  }

  function backdropPatternFactor() {
    return Number(el("backdrop-pattern-scale")?.value ?? 100) / 100;
  }

  function formatVariationSettings() {
    const parts = [];
    for (const axis of AXES) {
      const input = el(axis.inputId);
      if (!input) continue;
      parts.push(`"${axis.tag}" ${Number(input.value)}`);
    }
    return parts.join(", ");
  }

  function applyPreviewBackdrop() {
    if (!frame) return;
    const bgColor = previewBgHex();
    const patternColor = el("preview-pattern-color")?.value ?? "#8a7358";
    const key = getSelectedBackdropMode();

    const svgEl = el("backdrop-pattern-svg");

    const resetFrame = () => {
      frame.style.backgroundImage = "none";
      frame.style.removeProperty("background-size");
      frame.style.removeProperty("background-repeat");
      frame.style.removeProperty("background-position");
      frame.style.backgroundBlendMode = "normal";
    };

    const hideOverlays = () => {
      if (svgEl) { svgEl.innerHTML = ""; svgEl.style.display = "none"; }
    };

    const isPatternMode = key === "stripes" || key === "dots" || key === "grid";

    if (isPatternMode && svgEl) {
      const rect = frame.getBoundingClientRect();
      const w = Math.round(rect.width) || 800;
      const h = Math.round(rect.height) || 600;

      let svgContent = "";
      switch (key) {
        case "stripes": svgContent = generateBackdropStripeSvg(w, h, patternColor, bgColor); break;
        case "dots": svgContent = generateBackdropDotsSvg(w, h, patternColor, bgColor); break;
        case "grid": svgContent = generateBackdropGridSvg(w, h, patternColor, bgColor); break;
      }

      svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svgEl.setAttribute("preserveAspectRatio", "none");
      svgEl.innerHTML = svgContent;
      svgEl.style.display = "block";
      frame.style.backgroundColor = bgColor;
      resetFrame();
      return;
    }

    // Non-pattern modes — hide SVG overlay
    if (svgEl) { svgEl.innerHTML = ""; svgEl.style.display = "none"; }

    if (key === "none") {
      hideOverlays();
      frame.style.backgroundColor = bgColor;
      resetFrame();
      return;
    }

    if (key === "gradient") {
      hideOverlays();
      frame.style.backgroundColor = bgColor;
      frame.style.backgroundImage = buildBackdropGradientImage();
      frame.style.backgroundRepeat = "no-repeat";
      frame.style.backgroundSize = "100% 100%";
      frame.style.backgroundPosition = "center";
      return;
    }

    // Fallback
    hideOverlays();
    frame.style.backgroundColor = bgColor;
    resetFrame();
  }

  function clearLetterClip() {
    if (!letter) return;
    letter.style.removeProperty("background-image");
    letter.style.removeProperty("background-size");
    letter.style.removeProperty("background-position");
    letter.style.removeProperty("-webkit-background-clip");
    letter.style.removeProperty("background-clip");
    letter.style.removeProperty("-webkit-text-fill-color");
    letter.style.removeProperty("background-repeat");
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /** Sort three color stops by position for valid CSS gradients. */
  function gradientThreeStops(c1, p1, c2, p2, c3, p3) {
    const pts = [
      { c: c1, p: clamp(Number(p1), 0, 100) },
      { c: c2, p: clamp(Number(p2), 0, 100) },
      { c: c3, p: clamp(Number(p3), 0, 100) },
    ].sort((a, b) => a.p - b.p);
    return `${pts[0].c} ${pts[0].p}%, ${pts[1].c} ${pts[1].p}%, ${pts[2].c} ${pts[2].p}%`;
  }

  function setGradStopPercents(p1, p2, p3) {
    const n1 = el("fill-grad-p1");
    const n2 = el("fill-grad-p2");
    const n3 = el("fill-grad-p3");
    if (n1) n1.value = String(Math.round(clamp(Number(p1), 0, 100)));
    if (n2) n2.value = String(Math.round(clamp(Number(p2), 0, 100)));
    if (n3) n3.value = String(Math.round(clamp(Number(p3), 0, 100)));
    // updateGradRailUi() removed — sync() always follows at every call site
  }

  function readGradStopPercents() {
    return [
      clamp(Number(el("fill-grad-p1")?.value ?? 0), 0, 100),
      clamp(Number(el("fill-grad-p2")?.value ?? 45), 0, 100),
      clamp(Number(el("fill-grad-p3")?.value ?? 100), 0, 100),
    ];
  }

  function setBgGradStopPercents(p1, p2, p3) {
    const n1 = el("bg-grad-p1");
    const n2 = el("bg-grad-p2");
    const n3 = el("bg-grad-p3");
    if (n1) n1.value = String(Math.round(clamp(Number(p1), 0, 100)));
    if (n2) n2.value = String(Math.round(clamp(Number(p2), 0, 100)));
    if (n3) n3.value = String(Math.round(clamp(Number(p3), 0, 100)));
    // updateBgGradRailUi() removed — sync() always follows at every call site
  }

  function readBgGradStopPercents() {
    return [
      clamp(Number(el("bg-grad-p1")?.value ?? 0), 0, 100),
      clamp(Number(el("bg-grad-p2")?.value ?? 40), 0, 100),
      clamp(Number(el("bg-grad-p3")?.value ?? 100), 0, 100),
    ];
  }

  function updateBgGradRailUi() {
    const c1 = el("bg-grad-c1")?.value ?? "#1a1410";
    const c2 = el("bg-grad-c2")?.value ?? "#2d2118";
    const c3 = el("bg-grad-c3")?.value ?? "#3d2a22";
    const [p1, p2, p3] = readBgGradStopPercents();
    const stops = gradientThreeStops(c1, p1, c2, p2, c3, p3);

    const prev = el("bg-grad-stops-preview");
    if (prev) prev.style.background = `linear-gradient(90deg, ${stops})`;

    const h1 = el("bg-grad-handle-1");
    const h2 = el("bg-grad-handle-2");
    const h3 = el("bg-grad-handle-3");
    if (h1) h1.style.left = `${p1}%`;
    if (h2) h2.style.left = `${p2}%`;
    if (h3) h3.style.left = `${p3}%`;

    const vals = el("bg-grad-stops-values");
    if (vals) vals.textContent = `${Math.round(p1)}% · ${Math.round(p2)}% · ${Math.round(p3)}%`;
  }

  function buildBackdropGradientImage() {
    const c1 = el("bg-grad-c1")?.value ?? "#1a1410";
    const c2 = el("bg-grad-c2")?.value ?? "#2d2118";
    const c3 = el("bg-grad-c3")?.value ?? "#3d2a22";
    const [p1, p2, p3] = readBgGradStopPercents();
    const stops = gradientThreeStops(c1, p1, c2, p2, c3, p3);
    const gtype = el("bg-grad-type")?.value ?? "linear";
    if (gtype === "radial") {
      const rx = el("bg-grad-radial-x")?.value ?? 50;
      const ry = el("bg-grad-radial-y")?.value ?? 50;
      return `radial-gradient(circle at ${rx}% ${ry}%, ${stops})`;
    }
    const ang = Number(el("bg-grad-linear-angle")?.value ?? 160);
    return `linear-gradient(${ang}deg, ${stops})`;
  }

  function updateGradRailUi() {
    const c1 = el("fill-grad-c1")?.value ?? "#f0e6d8";
    const c2 = el("fill-grad-c2")?.value ?? "#8b6914";
    const c3 = el("fill-grad-c3")?.value ?? "#c4a574";
    const [p1, p2, p3] = readGradStopPercents();
    const stops = gradientThreeStops(c1, p1, c2, p2, c3, p3);

    const prev = el("grad-stops-preview");
    if (prev) prev.style.background = `linear-gradient(90deg, ${stops})`;

    const h1 = el("grad-handle-1");
    const h2 = el("grad-handle-2");
    const h3 = el("grad-handle-3");
    if (h1) h1.style.left = `${p1}%`;
    if (h2) h2.style.left = `${p2}%`;
    if (h3) h3.style.left = `${p3}%`;

    const vals = el("grad-stops-values");
    if (vals) vals.textContent = `${Math.round(p1)}% · ${Math.round(p2)}% · ${Math.round(p3)}%`;

  }

  function bindGradStopsRail() {
    const rail = el("grad-stops-rail");
    if (!rail) return;

    let activeIndex = 0;

    function setStopFromClientX(clientX) {
      const rect = rail.getBoundingClientRect();
      const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      const pct = Math.round(clamp(t, 0, 1) * 100);
      const [a, b, c] = readGradStopPercents();
      if (activeIndex === 1) setGradStopPercents(pct, b, c);
      else if (activeIndex === 2) setGradStopPercents(a, pct, c);
      else setGradStopPercents(a, b, pct);
      sync();
    }

    rail.querySelectorAll(".grad-stop-handle").forEach((btn) => {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeIndex = Number(btn.getAttribute("data-stop-index")) || 1;
        btn.setPointerCapture(e.pointerId);
      });
      btn.addEventListener("pointermove", (e) => {
        if (!btn.hasPointerCapture(e.pointerId)) return;
        setStopFromClientX(e.clientX);
      });
      btn.addEventListener("pointerup", (e) => {
        if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      });
      btn.addEventListener("pointercancel", (e) => {
        if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      });
    });

    rail.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".grad-stop-handle")) return;
      const rect = rail.getBoundingClientRect();
      const t = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      const pct = clamp(t, 0, 1) * 100;
      const [a, b, c] = readGradStopPercents();
      const d1 = Math.abs(pct - a);
      const d2 = Math.abs(pct - b);
      const d3 = Math.abs(pct - c);
      activeIndex = d1 <= d2 && d1 <= d3 ? 1 : d2 <= d3 ? 2 : 3;
      setStopFromClientX(e.clientX);
    });
  }

  function bindBgGradStopsRail() {
    const rail = el("bg-grad-stops-rail");
    if (!rail) return;

    let activeIndex = 0;

    function setStopFromClientX(clientX) {
      const rect = rail.getBoundingClientRect();
      const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      const pct = Math.round(clamp(t, 0, 1) * 100);
      const [a, b, c] = readBgGradStopPercents();
      if (activeIndex === 1) setBgGradStopPercents(pct, b, c);
      else if (activeIndex === 2) setBgGradStopPercents(a, pct, c);
      else setBgGradStopPercents(a, b, pct);
      sync();
    }

    rail.querySelectorAll(".grad-stop-handle").forEach((btn) => {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeIndex = Number(btn.getAttribute("data-stop-index")) || 1;
        btn.setPointerCapture(e.pointerId);
      });
      btn.addEventListener("pointermove", (e) => {
        if (!btn.hasPointerCapture(e.pointerId)) return;
        setStopFromClientX(e.clientX);
      });
      btn.addEventListener("pointerup", (e) => {
        if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      });
      btn.addEventListener("pointercancel", (e) => {
        if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      });
    });

    rail.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".grad-stop-handle")) return;
      const rect = rail.getBoundingClientRect();
      const t = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      const pct = clamp(t, 0, 1) * 100;
      const [a, b, c] = readBgGradStopPercents();
      const d1 = Math.abs(pct - a);
      const d2 = Math.abs(pct - b);
      const d3 = Math.abs(pct - c);
      activeIndex = d1 <= d2 && d1 <= d3 ? 1 : d2 <= d3 ? 2 : 3;
      setStopFromClientX(e.clientX);
    });
  }

  function halftoneDotMarkup(cDot, shape, cx, cy, dotR, cell) {
    const r = Math.min(dotR, cell * 0.45);
    if (shape === "square") {
      const s = Math.min(dotR * 2, cell * 0.92);
      return `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="${cDot}"/>`;
    }
    if (shape === "triangle") {
      const h = r * 1.5;
      const w = (4 / Math.sqrt(3)) * r;
      const pts = `${cx},${cy - h * 0.55} ${cx - w * 0.5},${cy + h * 0.35} ${cx + w * 0.5},${cy + h * 0.35}`;
      return `<polygon points="${pts}" fill="${cDot}"/>`;
    }
    if (shape === "star") {
      const pts = 5;
      const inner = r * 0.42;
      let d = "";
      for (let i = 0; i < 2 * pts; i += 1) {
        const rad = i % 2 === 0 ? r : inner;
        const a = (Math.PI / pts) * i - Math.PI / 2;
        const x = cx + rad * Math.cos(a);
        const y = cy + rad * Math.sin(a);
        d += `${i === 0 ? "M" : "L"}${x.toFixed(3)},${y.toFixed(3)}`;
      }
      return `<path d="${d}Z" fill="${cDot}"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${cDot}"/>`;
  }

  function buildHalftoneSvg(cDot, cCell, dotR, cell, shape, gridAngle, brickPct) {
    const key = `${cDot}|${cCell}|${dotR}|${cell}|${shape}|${gridAngle}|${brickPct}`;
    if (_halftoneCache && _halftoneCache.key === key) return _halftoneCache.result;

    const rot = Number(gridAngle) || 0;
    const brick = clamp(Number(brickPct) || 0, 0, 100);
    const sc = Math.max(6, Math.round(cell * 100) / 100);
    let dr = Math.max(0.25, dotR);
    dr = Math.min(dr, sc * 0.48);

    const mkDot = (cx, cy) => {
      const inner = halftoneDotMarkup(cDot, shape, cx, cy, dr, sc);
      return `<g transform="rotate(${rot} ${cx} ${cy})">${inner}</g>`;
    };

    // Always use 2×2 tile to avoid jump when brick changes
    const W = 2 * sc;
    const H = 2 * sc;
    const shift = (brick / 100) * sc;
    let g = "";
    // Top row (no shift)
    g += mkDot(sc / 2, sc / 2);
    g += mkDot((3 * sc) / 2, sc / 2);
    // Bottom row (shifted) — add wrapped copies for seamless tiling
    const bx1 = ((sc / 2 + shift) % W + W) % W;
    const bx2 = (((3 * sc) / 2 + shift) % W + W) % W;
    g += mkDot(bx1, (3 * sc) / 2);
    g += mkDot(bx2, (3 * sc) / 2);
    // Wrap copies at tile edges for seamless tiling
    if (bx1 + dr > W) g += mkDot(bx1 - W, (3 * sc) / 2);
    if (bx2 + dr > W) g += mkDot(bx2 - W, (3 * sc) / 2);
    if (bx1 - dr < 0) g += mkDot(bx1 + W, (3 * sc) / 2);
    if (bx2 - dr < 0) g += mkDot(bx2 + W, (3 * sc) / 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="${cCell}"/>${g}</svg>`;
    const result = { url: svgUrl(svg), w: W, h: H };
    _halftoneCache = { key, result };
    return result;
  }

  /**
   * Clipped fills: background-clip text. `patternFactor()` scales global tile size.
   */
  function buildClipFill(mode, textColor, pf) {
    const f = pf;
    switch (mode) {
      case "gradient": {
        const c1 = el("fill-grad-c1")?.value ?? "#f0e6d8";
        const c2 = el("fill-grad-c2")?.value ?? "#8b6914";
        const c3 = el("fill-grad-c3")?.value ?? "#c4a574";
        const p1 = el("fill-grad-p1")?.value ?? 0;
        const p2 = el("fill-grad-p2")?.value ?? 45;
        const p3 = el("fill-grad-p3")?.value ?? 100;
        const stops = gradientThreeStops(c1, p1, c2, p2, c3, p3);
        const gtype = el("fill-grad-type")?.value ?? "linear";
        let bgImage;
        if (gtype === "radial") {
          const rx = el("fill-grad-radial-x")?.value ?? 50;
          const ry = el("fill-grad-radial-y")?.value ?? 50;
          bgImage = `radial-gradient(circle at ${rx}% ${ry}%, ${stops})`;
        } else {
          const ang = Number(el("fill-grad-linear-angle")?.value ?? 145);
          bgImage = `linear-gradient(${ang}deg, ${stops})`;
        }
        return {
          backgroundImage: bgImage,
          backgroundSize: "100% 100%",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        };
      }
      case "bar-stripes": {
        const c1 = el("fill-bar-c1")?.value ?? "#c4a574";
        const c2 = el("fill-bar-c2")?.value ?? "#6b5344";
        const c3 = el("fill-bar-c3")?.value ?? "#2a1810";
        let w1 = Number(el("fill-bar-w1")?.value ?? 5) * f;
        let w2 = Number(el("fill-bar-w2")?.value ?? 5) * f;
        let w3 = Number(el("fill-bar-w3")?.value ?? 5) * f;
        w1 = Math.max(1, w1);
        w2 = Math.max(1, w2);
        w3 = Math.max(1, w3);
        const period = w1 + w2 + w3;
        const ang = Number(el("fill-bar-angle")?.value ?? 90);
        const bgImage = `repeating-linear-gradient(${ang}deg, ${c1} 0px, ${c1} ${w1}px, ${c2} ${w1}px, ${c2} ${w1 + w2}px, ${c3} ${w1 + w2}px, ${c3} ${period}px)`;
        return {
          backgroundImage: bgImage,
          backgroundSize: "100% 100%",
          backgroundPosition: "center",
        };
      }
      case "halftone": {
        const cDot = el("fill-halftone-c1")?.value ?? textColor;
        const cCell = el("fill-halftone-c2")?.value ?? "#1a1410";
        let dot = Number(el("fill-halftone-dot")?.value ?? 1.5) * f;
        let cell = Number(el("fill-halftone-cell")?.value ?? 10) * f;
        const shape = el("fill-halftone-shape")?.value ?? "circle";
        const phaseX = Number(el("fill-halftone-phase-x")?.value ?? 0);
        const phaseY = Number(el("fill-halftone-phase-y")?.value ?? 0);
        const gridAngle = Number(el("fill-halftone-grid-angle")?.value ?? 0);
        const brick = Number(el("fill-halftone-brick")?.value ?? 50);
        cell = Math.max(6, cell);
        dot = Math.max(0.25, Math.min(dot, cell * 0.48));
        const ht = buildHalftoneSvg(cDot, cCell, dot, cell, shape, gridAngle, brick);
        const ox = ((Math.round((phaseX / 100) * ht.w) % ht.w) + ht.w) % ht.w;
        const oy = ((Math.round((phaseY / 100) * ht.h) % ht.h) + ht.h) % ht.h;
        const dx = ox - ht.w / 2;
        const dy = oy - ht.h / 2;
        return {
          backgroundImage: ht.url,
          backgroundSize: `${ht.w}px ${ht.h}px`,
          backgroundPosition: `calc(50% + ${dx}px) calc(50% + ${dy}px)`,
          backgroundRepeat: "repeat",
        };
      }
      case "mesh": {
        let tile = Number(el("fill-mesh-tile")?.value ?? 36) * f;
        tile = Math.max(8, Math.round(tile * 100) / 100);
        const w = clamp(Number(el("fill-mesh-line")?.value ?? 25), 5, 48);
        const lineW = Math.max(1, Math.round(tile * w / 100 * 100) / 100);
        const a1 = Number(el("fill-mesh-a1")?.value ?? 135);
        const a2 = Number(el("fill-mesh-a2")?.value ?? 225);
        const a3 = Number(el("fill-mesh-a3")?.value ?? 315);
        const c1 = el("fill-mesh-c1")?.value ?? "#c4a574";
        const c2 = el("fill-mesh-c2")?.value ?? "#3d2918";
        const c3 = el("fill-mesh-c3")?.value ?? "#8b6914";
        const base = el("fill-mesh-base")?.value ?? "#1a1410";
        const bgImage = `repeating-linear-gradient(${a1}deg, ${c1} 0px, ${c1} ${lineW}px, transparent ${lineW}px, transparent ${tile}px), repeating-linear-gradient(${a2}deg, ${c2} 0px, ${c2} ${lineW}px, transparent ${lineW}px, transparent ${tile}px), repeating-linear-gradient(${a3}deg, ${c3} 0px, ${c3} ${lineW}px, transparent ${lineW}px, transparent ${tile}px), linear-gradient(${base}, ${base})`;
        return {
          backgroundImage: bgImage,
          backgroundSize: "100% 100%",
          backgroundPosition: "center",
          backgroundRepeat: "repeat",
        };
      }
      default:
        return {
          backgroundImage: "none",
          backgroundSize: "100% 100%",
          backgroundPosition: "center",
        };
    }
  }

  function updateFillPanels() {
    _fillPanels.forEach((panel) => {
      const modes = (panel.getAttribute("data-fill-for") || "").trim().split(/\s+/);
      const show = modes.some((m) => isFillModeOn(m));
      panel.toggleAttribute("hidden", !show);
    });
  }

  function updateBgSubpanels() {
    const mode = getSelectedBackdropMode();
    _bgPanels.forEach((panel) => {
      const modes = (panel.getAttribute("data-bg-for") || "").trim().split(/\s+/);
      const show = modes.includes(mode);
      panel.toggleAttribute("hidden", !show);
    });
    _bgAdjustNodes.forEach((node) => {
      const modes = (node.getAttribute("data-bg-adjust-for") || "").trim().split(/\s+/);
      node.toggleAttribute("hidden", !modes.includes(mode));
    });
  }

  function updateGradientFieldsVisibility() {
    const t = el("fill-grad-type")?.value ?? "linear";
    const lin = el("fill-grad-linear-fields");
    const rad = el("fill-grad-radial-fields");
    if (lin) lin.hidden = t !== "linear";
    if (rad) rad.hidden = t !== "radial";

    const bt = el("bg-grad-type")?.value ?? "linear";
    const blin = el("bg-grad-linear-fields");
    const brad = el("bg-grad-radial-fields");
    if (blin) blin.hidden = bt !== "linear";
    if (brad) brad.hidden = bt !== "radial";
  }

  function updateTextColorAvailability() {
    const input = el("css-text-color");
    const lab = el("text-color-label");
    if (!input || !lab) return;
    const use = isFillModeOn("solid");
    input.disabled = !use;
    lab.textContent = "Text color";
  }

  function applyLetterFill(textColor) {
    if (!letter) return;
    const f = patternFactor();

    if (!anyFillModeOn()) {
      clearLetterClip();
      letter.style.color = textColor;
      letter.style.removeProperty("background-repeat");
      return;
    }

    const mode = getSelectedFillMode();
    const clip = buildClipFill(mode, textColor, f);
    if (!clip || !clip.backgroundImage || clip.backgroundImage === "none") {
      clearLetterClip();
      letter.style.color = textColor;
      letter.style.removeProperty("background-repeat");
      return;
    }

    letter.style.color = "transparent";
    letter.style.webkitTextFillColor = "transparent";
    letter.style.backgroundImage = clip.backgroundImage;
    letter.style.backgroundSize = clip.backgroundSize;
    letter.style.backgroundPosition = clip.backgroundPosition ?? "center";
    if (clip.backgroundRepeat) letter.style.backgroundRepeat = clip.backgroundRepeat;
    else letter.style.removeProperty("background-repeat");
    letter.style.webkitBackgroundClip = "text";
    letter.style.backgroundClip = "text";
    letter.style.backgroundOrigin = "padding-box";
  }

  function clearNameInputError() {
    if (!nameInput) return;
    nameInput.classList.remove("name-input--error", "name-input--pulse");
  }

  /** Invalid key blocked before insert: red border; repeat invalid while already red → pulse. */
  function onNameInvalidAttempt() {
    if (!nameInput) return;
    const alreadyErr = nameInput.classList.contains("name-input--error");
    nameInput.classList.add("name-input--error");
    if (alreadyErr) {
      nameInput.classList.remove("name-input--pulse");
      void nameInput.offsetWidth;
      nameInput.classList.add("name-input--pulse");
    }
  }

  function classifyGlyphChar(c) {
    if (c >= "a" && c <= "z") return "lower";
    if (c >= "A" && c <= "Z") return ALLOWED_GLYPHS.has(c) ? "ok" : "wrong";
    return "wrong";
  }

  /** Safety net (IME, older UAs): keep field consistent with roster rules. */
  function validateGlyphName(hadExtraFromPaste) {
    const input = nameInput;
    const hint = el("name-hint");
    if (!input || !hint || !letter) return;

    let hadExtra = !!hadExtraFromPaste;
    let v = input.value;

    if (v.length > 1) {
      hadExtra = true;
      v = v.slice(0, 1);
      input.value = v;
    }

    if (v.length === 0) {
      hint.textContent = "";
      setLetterChar(lastValidGlyph);
      clearNameInputError();
      return;
    }

    const c = v[0];
    const kind = classifyGlyphChar(c);

    if (kind === "lower") {
      hint.textContent = NAME_MSG_LOWER;
      input.value = lastValidGlyph;
      onNameInvalidAttempt();
      return;
    }

    if (kind === "wrong") {
      hint.textContent = NAME_MSG_WRONG;
      input.value = lastValidGlyph;
      onNameInvalidAttempt();
      return;
    }

    lastValidGlyph = c;
    setLetterChar(c);
    hint.textContent = hadExtra ? NAME_MSG_EXTRA : "";
    clearNameInputError();
  }

  function bindGlyphName() {
    if (!nameInput) return;

    const supportsBeforeInput = "onbeforeinput" in document.createElement("input");

    if (supportsBeforeInput) {
      nameInput.addEventListener("beforeinput", (e) => {
        if (e.isComposing) return;
        const hint = el("name-hint");
        if (!hint) return;

        const t = e.inputType;
        if (t === "deleteContentBackward" || t === "deleteContentForward") return;
        if (t === "insertFromPaste") return;

        if (t === "insertText" || t === "insertCompositionText" || t === "insertReplacementText") {
          const d = e.data;
          if (d == null || d === "") return;
          const c = d[0];
          const kind = classifyGlyphChar(c);

          if (kind === "lower") {
            e.preventDefault();
            hint.textContent = NAME_MSG_LOWER;
            onNameInvalidAttempt();
            return;
          }
          if (kind === "wrong") {
            e.preventDefault();
            hint.textContent = NAME_MSG_WRONG;
            onNameInvalidAttempt();
            return;
          }
          hint.textContent = "";
          clearNameInputError();
        }
      });
    } else {
      nameInput.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (
          e.key === "Backspace" ||
          e.key === "Delete" ||
          e.key === "Tab" ||
          e.key === "Escape" ||
          e.key === "Enter" ||
          e.key.startsWith("Arrow") ||
          e.key === "Home" ||
          e.key === "End"
        ) {
          return;
        }
        if (e.key.length !== 1) return;

        const hint = el("name-hint");
        if (!hint) return;
        const kind = classifyGlyphChar(e.key);

        if (kind === "lower") {
          e.preventDefault();
          hint.textContent = NAME_MSG_LOWER;
          onNameInvalidAttempt();
          return;
        }
        if (kind === "wrong") {
          e.preventDefault();
          hint.textContent = NAME_MSG_WRONG;
          onNameInvalidAttempt();
          return;
        }
        hint.textContent = "";
        clearNameInputError();
      });
    }

    nameInput.addEventListener("input", () => validateGlyphName(false));

    nameInput.addEventListener("paste", (e) => {
      e.preventDefault();
      const hint = el("name-hint");
      const t = (e.clipboardData || window.clipboardData).getData("text") || "";
      const slice = t.slice(0, 1);
      if (!slice) return;
      const kind = classifyGlyphChar(slice[0]);

      if (kind === "lower") {
        if (hint) hint.textContent = NAME_MSG_LOWER;
        onNameInvalidAttempt();
        return;
      }
      if (kind === "wrong") {
        if (hint) hint.textContent = NAME_MSG_WRONG;
        onNameInvalidAttempt();
        return;
      }

      nameInput.value = slice;
      validateGlyphName(t.length > 1);
    });

    nameInput.addEventListener("animationend", () => {
      nameInput.classList.remove("name-input--pulse");
    });

    nameInput.addEventListener("blur", () => {
      if (nameInput.value.length === 0) {
        nameInput.value = lastValidGlyph;
        const hint = el("name-hint");
        if (hint) hint.textContent = "";
        clearNameInputError();
      }
    });
  }

  function sync() {
    if (!letter || !frame) return;

    const vari = el("axis-variation");
    if (vari && !el("class-multiclass")?.checked) {
      const snapped = nearestClassStop(Number(vari.value));
      if (Number(vari.value) !== snapped) {
        vari.value = String(snapped);
      }
    }

    letter.style.fontVariationSettings = formatVariationSettings();

    const sizeVal = Number(el("base-size")?.value ?? 100);
    frame.style.setProperty("--viewport-letter-max", `${18 * sizeVal / 100}rem`);

    const skewX = Number(el("css-skew")?.value ?? 0);
    const skewY = Number(el("css-skew-y")?.value ?? 0);
    const posX = Number(el("base-pos-x")?.value ?? 50);
    const posY = Number(el("base-pos-y")?.value ?? 50);
    letter.style.left = `${posX}%`;
    letter.style.top = `${posY}%`;
    letter.style.transform = `translate(-50%, -50%) skewX(${skewX}deg) skewY(${skewY}deg)`;

    const age = Number(el("base-age")?.value ?? 0);
    const disp = el("fe-age-displace");
    if (disp) {
      disp.setAttribute("scale", String((age / 100) * 14));
    }

    updateFillPanels();
    updateBgSubpanels();
    updateGradientFieldsVisibility();
    updateTextColorAvailability();

    const textColor = el("css-text-color")?.value ?? "#e8dcc8";
    applyLetterFill(textColor);

    const mode = getSelectedFillMode();
    const opId =
      mode === "solid"
        ? "fill-opacity-solid"
        : mode === "gradient"
          ? "fill-opacity-gradient"
          : mode === "bar-stripes"
            ? "fill-opacity-bar-stripes"
            : mode === "halftone"
              ? "fill-opacity-halftone"
              : "fill-opacity-mesh";
    const op = Number(el(opId)?.value ?? 100) / 100;
    letter.style.opacity = String(op);

    letter.style.textShadow = "none";
    const blur = Number(el("css-shadow-blur")?.value ?? 0);
    const sx = Number(el("css-shadow-x")?.value ?? 0);
    const sy = Number(el("css-shadow-y")?.value ?? 0);
    const shadowOn = blur !== 0 || sx !== 0 || sy !== 0;
    const parts = [];
    if (age > 0) parts.push("url(#filter-letter-age)");
    if (shadowOn) {
      parts.push(`drop-shadow(${sx}px ${sy}px ${blur}px rgba(0, 0, 0, 0.65))`);
    }
    letter.style.filter = parts.length ? parts.join(" ") : "none";

    applyPreviewBackdrop();
    updateClassUi();
    updateGradRailUi();
    updateBgGradRailUi();
    updateValueDisplays();
  }

  function updateClassUi() {
    const inp = el("axis-variation");
    const multi = el("class-multiclass")?.checked;
    const labelEl = el("class-active-label");
    if (!inp || !labelEl) return;

    const v = Number(inp.value);
    if (!multi) {
      const snapped = nearestClassStop(v);
      if (v !== snapped) {
        inp.value = String(snapped);
      }
      labelEl.textContent = classNameForStop(nearestClassStop(Number(inp.value)));
    } else {
      const br = classBracketStops(v);
      if (br.length === 2) {
        labelEl.textContent = `${classNameForStop(br[0])} — ${classNameForStop(br[1])}`;
      } else {
        labelEl.textContent = classNameForStop(br[0]);
      }
    }

    const activeStops = multi ? classBracketStops(v) : [nearestClassStop(Number(inp.value))];
    _classTicks.forEach((tick) => {
      const stop = Number(tick.getAttribute("data-stop"));
      tick.classList.toggle("is-active", activeStops.includes(stop));
    });
  }

  const PRESET_STORAGE_KEY = "char-creator-presets-v1";

  // Paste the value from an Export here to make presets permanent across browsers/clears.
  const BUNDLED_PRESETS = {
  "Druid": {
    "radio:letter-fill-mode": "halftone",
    "radio:backdrop-mode": "gradient",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "145",
    "axis-variation": "139",
    "axis-thickness": "1000",
    "css-skew": "0",
    "css-skew-y": "0",
    "fill-pattern-scale": "665",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "linear",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "50",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "90",
    "fill-bar-c1": "#ffffff",
    "fill-bar-w1": "5",
    "fill-bar-c2": "#c3ad96",
    "fill-bar-w2": "5",
    "fill-bar-c3": "#1a120d",
    "fill-bar-w3": "5",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "triangle",
    "fill-halftone-c1": "#4ddb00",
    "fill-halftone-c2": "#024601",
    "fill-halftone-dot": "5",
    "fill-halftone-cell": "9",
    "fill-halftone-phase-x": "20",
    "fill-halftone-phase-y": "100",
    "fill-halftone-grid-angle": "0",
    "fill-halftone-brick": "45",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "36",
    "fill-mesh-line": "25",
    "fill-mesh-a1": "135",
    "fill-mesh-a2": "225",
    "fill-mesh-a3": "315",
    "fill-mesh-c1": "#c3ad96",
    "fill-mesh-c2": "#1a120d",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#ffffff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "25",
    "css-shadow-x": "0",
    "css-shadow-y": "0",
    "preview-bg-color": "#21caae",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#1a120d",
    "backdrop-pattern-scale": "100",
    "backdrop-stripes-angle": "-45",
    "backdrop-stripes-band": "4",
    "backdrop-stripes-gap": "14",
    "backdrop-stripes-wave-amp": "0",
    "backdrop-stripes-wave-freq": "4",
    "backdrop-dots-shape": "circle",
    "backdrop-dots-radius": "5",
    "backdrop-dots-spacing": "44",
    "backdrop-dots-size-var": "0",
    "backdrop-dots-row-stagger": "0",
    "backdrop-dots-col-stagger": "0",
    "backdrop-dots-jitter": "0",
    "backdrop-dots-seed": "42",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "30",
    "base-pos-y": "43"
  },
  "Mage": {
    "radio:letter-fill-mode": "bar-stripes",
    "radio:backdrop-mode": "stripes",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "145",
    "axis-variation": "246",
    "axis-thickness": "0",
    "css-skew": "0",
    "css-skew-y": "0",
    "fill-pattern-scale": "665",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "radial",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "9",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "158",
    "fill-bar-c1": "#2c1b1b",
    "fill-bar-w1": "5",
    "fill-bar-c2": "#c29061",
    "fill-bar-w2": "2",
    "fill-bar-c3": "#2c1b1b",
    "fill-bar-w3": "5",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "triangle",
    "fill-halftone-c1": "#4ddb00",
    "fill-halftone-c2": "#024601",
    "fill-halftone-dot": "5",
    "fill-halftone-cell": "9",
    "fill-halftone-phase-x": "20",
    "fill-halftone-phase-y": "100",
    "fill-halftone-grid-angle": "0",
    "fill-halftone-brick": "45",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "36",
    "fill-mesh-line": "25",
    "fill-mesh-a1": "135",
    "fill-mesh-a2": "225",
    "fill-mesh-a3": "315",
    "fill-mesh-c1": "#c3ad96",
    "fill-mesh-c2": "#1a120d",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#ffffff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "0",
    "css-shadow-x": "0",
    "css-shadow-y": "0",
    "preview-bg-color": "#2ae5c5",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#1a120d",
    "backdrop-pattern-scale": "150",
    "backdrop-stripes-angle": "41",
    "backdrop-stripes-band": "1",
    "backdrop-stripes-gap": "23",
    "backdrop-stripes-wave-amp": "3",
    "backdrop-stripes-wave-freq": "4",
    "backdrop-dots-shape": "circle",
    "backdrop-dots-radius": "5",
    "backdrop-dots-spacing": "44",
    "backdrop-dots-size-var": "0",
    "backdrop-dots-row-stagger": "0",
    "backdrop-dots-col-stagger": "0",
    "backdrop-dots-jitter": "0",
    "backdrop-dots-seed": "42",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "50",
    "base-pos-y": "60"
  },
  "Tank": {
    "radio:letter-fill-mode": "halftone",
    "radio:backdrop-mode": "none",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "145",
    "axis-variation": "494",
    "axis-thickness": "1000",
    "css-skew": "0",
    "css-skew-y": "0",
    "fill-pattern-scale": "665",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "radial",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "9",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "158",
    "fill-bar-c1": "#2c1b1b",
    "fill-bar-w1": "5",
    "fill-bar-c2": "#c29061",
    "fill-bar-w2": "2",
    "fill-bar-c3": "#2c1b1b",
    "fill-bar-w3": "5",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "square",
    "fill-halftone-c1": "#c13c1a",
    "fill-halftone-c2": "#271107",
    "fill-halftone-dot": "5",
    "fill-halftone-cell": "8",
    "fill-halftone-phase-x": "42",
    "fill-halftone-phase-y": "80",
    "fill-halftone-grid-angle": "0",
    "fill-halftone-brick": "40",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "36",
    "fill-mesh-line": "25",
    "fill-mesh-a1": "135",
    "fill-mesh-a2": "225",
    "fill-mesh-a3": "315",
    "fill-mesh-c1": "#c3ad96",
    "fill-mesh-c2": "#1a120d",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#ffffff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "2",
    "css-shadow-x": "12",
    "css-shadow-y": "14",
    "preview-bg-color": "#9cb587",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#1a120d",
    "backdrop-pattern-scale": "150",
    "backdrop-stripes-angle": "41",
    "backdrop-stripes-band": "1",
    "backdrop-stripes-gap": "23",
    "backdrop-stripes-wave-amp": "3",
    "backdrop-stripes-wave-freq": "4",
    "backdrop-dots-shape": "circle",
    "backdrop-dots-radius": "5",
    "backdrop-dots-spacing": "44",
    "backdrop-dots-size-var": "0",
    "backdrop-dots-row-stagger": "0",
    "backdrop-dots-col-stagger": "0",
    "backdrop-dots-jitter": "0",
    "backdrop-dots-seed": "42",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "55",
    "base-pos-y": "36"
  },
  "Beach Towel": {
    "radio:letter-fill-mode": "mesh",
    "radio:backdrop-mode": "gradient",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "145",
    "axis-variation": "874",
    "axis-thickness": "589",
    "css-skew": "-10",
    "css-skew-y": "10",
    "fill-pattern-scale": "250",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "radial",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "9",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "158",
    "fill-bar-c1": "#2c1b1b",
    "fill-bar-w1": "5",
    "fill-bar-c2": "#c29061",
    "fill-bar-w2": "2",
    "fill-bar-c3": "#2c1b1b",
    "fill-bar-w3": "5",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "square",
    "fill-halftone-c1": "#c13c1a",
    "fill-halftone-c2": "#271107",
    "fill-halftone-dot": "5",
    "fill-halftone-cell": "8",
    "fill-halftone-phase-x": "42",
    "fill-halftone-phase-y": "80",
    "fill-halftone-grid-angle": "0",
    "fill-halftone-brick": "40",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "25",
    "fill-mesh-line": "26",
    "fill-mesh-a1": "231",
    "fill-mesh-a2": "229",
    "fill-mesh-a3": "234",
    "fill-mesh-c1": "#ffffff",
    "fill-mesh-c2": "#376376",
    "fill-mesh-c3": "#1f0481",
    "fill-mesh-base": "#0088ff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "2",
    "css-shadow-x": "12",
    "css-shadow-y": "14",
    "preview-bg-color": "#9cb587",
    "bg-grad-type": "linear",
    "bg-grad-linear-angle": "0",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#0888bf",
    "bg-grad-c2": "#85d6ff",
    "bg-grad-c3": "#c7d507",
    "bg-grad-p1": "60",
    "bg-grad-p2": "60",
    "bg-grad-p3": "44",
    "preview-pattern-color": "#1a120d",
    "backdrop-pattern-scale": "150",
    "backdrop-stripes-angle": "41",
    "backdrop-stripes-band": "1",
    "backdrop-stripes-gap": "23",
    "backdrop-stripes-wave-amp": "3",
    "backdrop-stripes-wave-freq": "4",
    "backdrop-dots-shape": "circle",
    "backdrop-dots-radius": "5",
    "backdrop-dots-spacing": "44",
    "backdrop-dots-size-var": "0",
    "backdrop-dots-row-stagger": "0",
    "backdrop-dots-col-stagger": "0",
    "backdrop-dots-jitter": "0",
    "backdrop-dots-seed": "42",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "67",
    "base-pos-y": "41"
  },
  "Space Creature": {
    "radio:letter-fill-mode": "halftone",
    "radio:backdrop-mode": "dots",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "145",
    "axis-variation": "76",
    "axis-thickness": "1000",
    "css-skew": "25",
    "css-skew-y": "-25",
    "fill-pattern-scale": "50",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "radial",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "9",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "158",
    "fill-bar-c1": "#2c1b1b",
    "fill-bar-w1": "5",
    "fill-bar-c2": "#c29061",
    "fill-bar-w2": "2",
    "fill-bar-c3": "#2c1b1b",
    "fill-bar-w3": "5",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "circle",
    "fill-halftone-c1": "#59ff00",
    "fill-halftone-c2": "#013800",
    "fill-halftone-dot": "5",
    "fill-halftone-cell": "5",
    "fill-halftone-phase-x": "28",
    "fill-halftone-phase-y": "100",
    "fill-halftone-grid-angle": "0",
    "fill-halftone-brick": "56",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "36",
    "fill-mesh-line": "25",
    "fill-mesh-a1": "135",
    "fill-mesh-a2": "225",
    "fill-mesh-a3": "315",
    "fill-mesh-c1": "#c3ad96",
    "fill-mesh-c2": "#1a120d",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#ffffff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "38",
    "css-shadow-x": "0",
    "css-shadow-y": "0",
    "preview-bg-color": "#e52acf",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#1f0f15",
    "backdrop-pattern-scale": "300",
    "backdrop-stripes-angle": "41",
    "backdrop-stripes-band": "1",
    "backdrop-stripes-gap": "23",
    "backdrop-stripes-wave-amp": "3",
    "backdrop-stripes-wave-freq": "4",
    "backdrop-dots-shape": "hex",
    "backdrop-dots-radius": "23",
    "backdrop-dots-spacing": "36",
    "backdrop-dots-size-var": "32",
    "backdrop-dots-row-stagger": "100",
    "backdrop-dots-col-stagger": "56",
    "backdrop-dots-jitter": "26",
    "backdrop-dots-seed": "89",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "60",
    "base-pos-y": "54"
  },
  "Fishnets": {
    "radio:letter-fill-mode": "mesh",
    "radio:backdrop-mode": "dots",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "160",
    "axis-variation": "750",
    "axis-thickness": "785",
    "css-skew": "3",
    "css-skew-y": "-3",
    "fill-pattern-scale": "50",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "radial",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "9",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "158",
    "fill-bar-c1": "#2c1b1b",
    "fill-bar-w1": "5",
    "fill-bar-c2": "#c29061",
    "fill-bar-w2": "2",
    "fill-bar-c3": "#2c1b1b",
    "fill-bar-w3": "5",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "circle",
    "fill-halftone-c1": "#59ff00",
    "fill-halftone-c2": "#013800",
    "fill-halftone-dot": "5",
    "fill-halftone-cell": "5",
    "fill-halftone-phase-x": "28",
    "fill-halftone-phase-y": "100",
    "fill-halftone-grid-angle": "0",
    "fill-halftone-brick": "56",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "12",
    "fill-mesh-line": "8",
    "fill-mesh-a1": "135",
    "fill-mesh-a2": "225",
    "fill-mesh-a3": "225",
    "fill-mesh-c1": "#000000",
    "fill-mesh-c2": "#000000",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#ffffff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "0",
    "css-shadow-x": "0",
    "css-shadow-y": "0",
    "preview-bg-color": "#04ff00",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#000000",
    "backdrop-pattern-scale": "300",
    "backdrop-stripes-angle": "41",
    "backdrop-stripes-band": "1",
    "backdrop-stripes-gap": "23",
    "backdrop-stripes-wave-amp": "3",
    "backdrop-stripes-wave-freq": "4",
    "backdrop-dots-shape": "star",
    "backdrop-dots-radius": "15",
    "backdrop-dots-spacing": "51",
    "backdrop-dots-size-var": "44",
    "backdrop-dots-row-stagger": "40",
    "backdrop-dots-col-stagger": "100",
    "backdrop-dots-jitter": "100",
    "backdrop-dots-seed": "697",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "31",
    "base-pos-y": "37"
  },
  "Sneaking": {
    "radio:letter-fill-mode": "solid",
    "radio:backdrop-mode": "grid",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "125",
    "axis-variation": "1000",
    "axis-thickness": "0",
    "css-skew": "0",
    "css-skew-y": "0",
    "fill-pattern-scale": "740",
    "css-text-color": "#04ff00",
    "fill-opacity-solid": "100",
    "fill-grad-type": "linear",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "9",
    "fill-grad-c1": "#000000",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "158",
    "fill-bar-c1": "#04ff00",
    "fill-bar-w1": "4",
    "fill-bar-c2": "#c29061",
    "fill-bar-w2": "2",
    "fill-bar-c3": "#2c1b1b",
    "fill-bar-w3": "5",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "circle",
    "fill-halftone-c1": "#59ff00",
    "fill-halftone-c2": "#013800",
    "fill-halftone-dot": "5",
    "fill-halftone-cell": "5",
    "fill-halftone-phase-x": "28",
    "fill-halftone-phase-y": "100",
    "fill-halftone-grid-angle": "0",
    "fill-halftone-brick": "56",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "12",
    "fill-mesh-line": "8",
    "fill-mesh-a1": "135",
    "fill-mesh-a2": "225",
    "fill-mesh-a3": "225",
    "fill-mesh-c1": "#000000",
    "fill-mesh-c2": "#000000",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#ffffff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "1",
    "css-shadow-x": "2",
    "css-shadow-y": "5",
    "preview-bg-color": "#04ff00",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#252222",
    "backdrop-pattern-scale": "300",
    "backdrop-stripes-angle": "41",
    "backdrop-stripes-band": "1",
    "backdrop-stripes-gap": "23",
    "backdrop-stripes-wave-amp": "3",
    "backdrop-stripes-wave-freq": "4",
    "backdrop-dots-shape": "star",
    "backdrop-dots-radius": "15",
    "backdrop-dots-spacing": "51",
    "backdrop-dots-size-var": "44",
    "backdrop-dots-row-stagger": "40",
    "backdrop-dots-col-stagger": "100",
    "backdrop-dots-jitter": "100",
    "backdrop-dots-seed": "697",
    "backdrop-grid-cell": "15",
    "backdrop-grid-line": "1",
    "backdrop-grid-rotate": "24",
    "backdrop-grid-wave": "9",
    "base-pos-x": "49",
    "base-pos-y": "69"
  },
  "Default": {
    "radio:letter-fill-mode": "solid",
    "radio:backdrop-mode": "none",
    "class-multiclass": false,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "145",
    "axis-variation": "625",
    "axis-thickness": "0",
    "css-skew": "0",
    "css-skew-y": "0",
    "fill-pattern-scale": "665",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "radial",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "9",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "0",
    "fill-bar-c1": "#2c1b1b",
    "fill-bar-w1": "2",
    "fill-bar-c2": "#c29061",
    "fill-bar-w2": "2",
    "fill-bar-c3": "#2c1b1b",
    "fill-bar-w3": "2",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "square",
    "fill-halftone-c1": "#c13c1a",
    "fill-halftone-c2": "#271107",
    "fill-halftone-dot": "0.5",
    "fill-halftone-cell": "5",
    "fill-halftone-phase-x": "0",
    "fill-halftone-phase-y": "0",
    "fill-halftone-grid-angle": "0",
    "fill-halftone-brick": "0",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "12",
    "fill-mesh-line": "8",
    "fill-mesh-a1": "77",
    "fill-mesh-a2": "230",
    "fill-mesh-a3": "165",
    "fill-mesh-c1": "#c3ad96",
    "fill-mesh-c2": "#1a120d",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#696969",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "0",
    "css-shadow-x": "0",
    "css-shadow-y": "0",
    "preview-bg-color": "#ffffff",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#1a120d",
    "backdrop-pattern-scale": "140",
    "backdrop-stripes-angle": "41",
    "backdrop-stripes-band": "15",
    "backdrop-stripes-gap": "4",
    "backdrop-stripes-wave-amp": "0",
    "backdrop-stripes-wave-freq": "4",
    "backdrop-dots-shape": "circle",
    "backdrop-dots-radius": "5",
    "backdrop-dots-spacing": "44",
    "backdrop-dots-size-var": "0",
    "backdrop-dots-row-stagger": "0",
    "backdrop-dots-col-stagger": "0",
    "backdrop-dots-jitter": "0",
    "backdrop-dots-seed": "42",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "36",
    "base-pos-y": "39"
  },
  "Stripes and Stars": {
    "radio:letter-fill-mode": "halftone",
    "radio:backdrop-mode": "stripes",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "145",
    "axis-variation": "375",
    "axis-thickness": "1000",
    "css-skew": "0",
    "css-skew-y": "0",
    "fill-pattern-scale": "665",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "linear",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "50",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "90",
    "fill-bar-c1": "#ffffff",
    "fill-bar-w1": "5",
    "fill-bar-c2": "#c3ad96",
    "fill-bar-w2": "5",
    "fill-bar-c3": "#1a120d",
    "fill-bar-w3": "5",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "star",
    "fill-halftone-c1": "#0037ff",
    "fill-halftone-c2": "#ffffff",
    "fill-halftone-dot": "2.3",
    "fill-halftone-cell": "5",
    "fill-halftone-phase-x": "33",
    "fill-halftone-phase-y": "64",
    "fill-halftone-grid-angle": "26",
    "fill-halftone-brick": "73",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "36",
    "fill-mesh-line": "25",
    "fill-mesh-a1": "135",
    "fill-mesh-a2": "225",
    "fill-mesh-a3": "315",
    "fill-mesh-c1": "#c3ad96",
    "fill-mesh-c2": "#1a120d",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#ffffff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "0",
    "css-shadow-x": "2",
    "css-shadow-y": "3",
    "preview-bg-color": "#ffffff",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#ff3300",
    "backdrop-pattern-scale": "100",
    "backdrop-stripes-angle": "-41",
    "backdrop-stripes-band": "40",
    "backdrop-stripes-gap": "9",
    "backdrop-stripes-wave-amp": "11",
    "backdrop-stripes-wave-freq": "1",
    "backdrop-dots-shape": "circle",
    "backdrop-dots-radius": "5",
    "backdrop-dots-spacing": "44",
    "backdrop-dots-size-var": "0",
    "backdrop-dots-row-stagger": "0",
    "backdrop-dots-col-stagger": "0",
    "backdrop-dots-jitter": "0",
    "backdrop-dots-seed": "42",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "31",
    "base-pos-y": "59"
  },
  "Present": {
    "radio:letter-fill-mode": "bar-stripes",
    "radio:backdrop-mode": "dots",
    "class-multiclass": true,
    "glyph-name": "A",
    "base-gender": "50",
    "base-age": "0",
    "base-size": "145",
    "axis-variation": "846",
    "axis-thickness": "1000",
    "css-skew": "0",
    "css-skew-y": "0",
    "fill-pattern-scale": "340",
    "css-text-color": "#1a120d",
    "fill-opacity-solid": "100",
    "fill-grad-type": "linear",
    "fill-grad-linear-angle": "167",
    "fill-grad-radial-x": "50",
    "fill-grad-radial-y": "50",
    "fill-grad-c1": "#ffffff",
    "fill-grad-c2": "#c2c2c2",
    "fill-grad-c3": "#525252",
    "fill-grad-p1": "21",
    "fill-grad-p2": "42",
    "fill-grad-p3": "63",
    "fill-opacity-gradient": "100",
    "fill-bar-angle": "9",
    "fill-bar-c1": "#ff0000",
    "fill-bar-w1": "24",
    "fill-bar-c2": "#ffffff",
    "fill-bar-w2": "2",
    "fill-bar-c3": "#11ff00",
    "fill-bar-w3": "2",
    "fill-opacity-bar-stripes": "100",
    "fill-halftone-shape": "circle",
    "fill-halftone-c1": "#ffffff",
    "fill-halftone-c2": "#ffffff",
    "fill-halftone-dot": "2.3",
    "fill-halftone-cell": "5",
    "fill-halftone-phase-x": "33",
    "fill-halftone-phase-y": "64",
    "fill-halftone-grid-angle": "26",
    "fill-halftone-brick": "73",
    "fill-opacity-halftone": "100",
    "fill-mesh-tile": "36",
    "fill-mesh-line": "25",
    "fill-mesh-a1": "135",
    "fill-mesh-a2": "225",
    "fill-mesh-a3": "315",
    "fill-mesh-c1": "#c3ad96",
    "fill-mesh-c2": "#1a120d",
    "fill-mesh-c3": "#ffffff",
    "fill-mesh-base": "#ffffff",
    "fill-opacity-mesh": "100",
    "css-shadow-blur": "0",
    "css-shadow-x": "2",
    "css-shadow-y": "3",
    "preview-bg-color": "#dbd1ff",
    "bg-grad-type": "radial",
    "bg-grad-linear-angle": "160",
    "bg-grad-radial-x": "100",
    "bg-grad-radial-y": "100",
    "bg-grad-c1": "#00e67a",
    "bg-grad-c2": "#092900",
    "bg-grad-c3": "#8fff05",
    "bg-grad-p1": "0",
    "bg-grad-p2": "100",
    "bg-grad-p3": "100",
    "preview-pattern-color": "#ffffff",
    "backdrop-pattern-scale": "105",
    "backdrop-stripes-angle": "-41",
    "backdrop-stripes-band": "40",
    "backdrop-stripes-gap": "9",
    "backdrop-stripes-wave-amp": "11",
    "backdrop-stripes-wave-freq": "1",
    "backdrop-dots-shape": "circle",
    "backdrop-dots-radius": "27",
    "backdrop-dots-spacing": "77",
    "backdrop-dots-size-var": "100",
    "backdrop-dots-row-stagger": "57",
    "backdrop-dots-col-stagger": "100",
    "backdrop-dots-jitter": "100",
    "backdrop-dots-seed": "42",
    "backdrop-grid-cell": "48",
    "backdrop-grid-line": "2",
    "backdrop-grid-rotate": "0",
    "backdrop-grid-wave": "0",
    "base-pos-x": "47",
    "base-pos-y": "43"
  }
};

  function loadPresetsObject() {
    try {
      const saved = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "{}");
      // BUNDLED_PRESETS act as defaults; localStorage overrides if same key exists
      return Object.assign({}, BUNDLED_PRESETS, saved);
    } catch {
      return { ...BUNDLED_PRESETS };
    }
  }

  function savePresetsObject(obj) {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(obj));
  }

  function rebuildPresetSelect() {
    const sel = el("base-preset");
    if (!sel) return;
    const current = sel.value;
    while (sel.options.length) sel.remove(0);
    const optC = document.createElement("option");
    optC.value = "custom";
    optC.textContent = "Custom";
    sel.appendChild(optC);
    const presets = loadPresetsObject();
    Object.keys(presets)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        const o = document.createElement("option");
        o.value = `saved:${encodeURIComponent(name)}`;
        o.textContent = name;
        sel.appendChild(o);
      });
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
    else sel.value = "custom";
  }

  function serializePreset() {
    const scroll = el("controls-scroll");
    const data = {};
    if (!scroll) return data;
    scroll.querySelectorAll('input[type="radio"]:checked').forEach((node) => {
      if (node.name) data[`radio:${node.name}`] = node.value;
    });
    scroll.querySelectorAll('input[type="checkbox"]').forEach((node) => {
      if (node.id && !node.id.startsWith("dev-") && node.id !== "base-preset") data[node.id] = node.checked;
    });
    scroll.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), select').forEach((node) => {
      if (!node.id || node.id.startsWith("dev-") || node.id === "base-preset") return;
      if (node.hasAttribute("data-preview-bg-mirror")) return;
      data[node.id] = node.value;
    });
    return data;
  }

  function applyPresetData(data) {
    const scroll = el("controls-scroll");
    if (!scroll || !data) return;
    if (data["pattern-scale"] != null && data["fill-pattern-scale"] == null) {
      const fps = el("fill-pattern-scale");
      const bps = el("backdrop-pattern-scale");
      if (fps) fps.value = String(data["pattern-scale"]);
      if (bps) bps.value = String(data["pattern-scale"]);
    }
    const patched = { ...data };
    const dep = patched["radio:backdrop-mode"];
    if (dep === "hex" || dep === "speckle" || dep === "crosshatch") patched["radio:backdrop-mode"] = "grid";
    if (dep === "waves" || dep === "vignette" || dep === "rings") patched["radio:backdrop-mode"] = "none";
    scroll.querySelectorAll('input[type="radio"]').forEach((node) => {
      const v = patched[`radio:${node.name}`];
      if (v !== undefined) node.checked = node.value === v;
    });
    scroll.querySelectorAll('input[type="checkbox"]').forEach((node) => {
      if (!node.id || node.id.startsWith("dev-")) return;
      if (data[node.id] !== undefined) node.checked = !!data[node.id];
    });
    scroll.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), select').forEach((node) => {
      if (!node.id || node.id.startsWith("dev-") || node.id === "base-preset") return;
      if (node.id === "glyph-name") return; // keep the letter the user has typed
      if (node.hasAttribute("data-preview-bg-mirror")) return;
      if (patched[node.id] !== undefined) node.value = patched[node.id];
    });
    const masterBg = el("preview-bg-color");
    if (masterBg) {
      document.querySelectorAll("[data-preview-bg-mirror]").forEach((m) => {
        m.value = masterBg.value;
      });
    }
  }

  function applyUserPreset(key) {
    if (key === "custom") return;
    const m = /^saved:(.+)$/.exec(key);
    if (!m) return;
    const name = decodeURIComponent(m[1]);
    const presets = loadPresetsObject();
    const payload = presets[name];
    if (payload) applyPresetData(payload);
  }

  function updateValueDisplays() {
    setText("axis-thickness-value", el("axis-thickness")?.value);
    setText("axis-variation-value", el("axis-variation")?.value);
    const bp = el("base-preset");
    if (bp) {
      const o = bp.options[bp.selectedIndex];
      setText("base-preset-value", o ? o.text : "");
    }
    setText("base-gender-value", el("base-gender")?.value ?? "0");
    setText("base-age-value", el("base-age")?.value ?? "0");
    setText("base-size-value", `${el("base-size")?.value ?? 100}%`);
    setText("base-pos-x-value", `${el("base-pos-x")?.value ?? 50}%`);
    setText("base-pos-y-value", `${el("base-pos-y")?.value ?? 55}%`);
    const sk = el("css-skew")?.value ?? 0;
    setText("css-skew-value", `${sk}°`);
    const sky = el("css-skew-y")?.value ?? 0;
    setText("css-skew-y-value", `${sky}°`);
    setText("fill-pattern-scale-value", `${el("fill-pattern-scale")?.value ?? 240}%`);
    setText("backdrop-pattern-scale-value", `${el("backdrop-pattern-scale")?.value ?? 240}%`);
    const pbg = previewBgHex();
    setText("preview-bg-color-value", pbg);
    setText("preview-bg-color-gradient-value", pbg);
    setText("preview-bg-color-pattern-value", pbg);
    setText("preview-pattern-color-value", el("preview-pattern-color")?.value ?? "");
    setText("backdrop-stripes-angle-value", `${el("backdrop-stripes-angle")?.value ?? -45}°`);
    setText("backdrop-stripes-band-value", el("backdrop-stripes-band")?.value ?? "4");
    setText("backdrop-stripes-gap-value", el("backdrop-stripes-gap")?.value ?? "14");
    setText("backdrop-dots-radius-value", el("backdrop-dots-radius")?.value ?? "5");
    setText("backdrop-dots-spacing-value", el("backdrop-dots-spacing")?.value ?? "44");
    setText("backdrop-dots-row-stagger-value", `${el("backdrop-dots-row-stagger")?.value ?? 0}%`);
    setText("backdrop-dots-col-stagger-value", `${el("backdrop-dots-col-stagger")?.value ?? 0}%`);
    setText("backdrop-dots-jitter-value", `${el("backdrop-dots-jitter")?.value ?? 0}%`);
    setText("backdrop-dots-seed-value", el("backdrop-dots-seed")?.value ?? "42");
    setText("backdrop-grid-cell-value", el("backdrop-grid-cell")?.value ?? "48");
    setText("backdrop-grid-line-value", el("backdrop-grid-line")?.value ?? "2");
    setText("backdrop-grid-rotate-value", `${el("backdrop-grid-rotate")?.value ?? 0}°`);
    setText("backdrop-grid-wave-value", el("backdrop-grid-wave")?.value ?? "0");
    setText("backdrop-stripes-wave-amp-value", el("backdrop-stripes-wave-amp")?.value ?? "0");
    setText("backdrop-stripes-wave-freq-value", el("backdrop-stripes-wave-freq")?.value ?? "4");
    const bds = el("backdrop-dots-shape");
    if (bds) {
      const o = bds.options[bds.selectedIndex];
      setText("backdrop-dots-shape-value", o ? o.text : "");
    }
    setText("backdrop-dots-size-var-value", `${el("backdrop-dots-size-var")?.value ?? 0}%`);
    const tc = el("css-text-color")?.value ?? "";
    setText("css-text-color-value", tc);
    setText("fill-opacity-solid-value", `${el("fill-opacity-solid")?.value ?? 100}%`);
    setText("fill-opacity-gradient-value", `${el("fill-opacity-gradient")?.value ?? 100}%`);
    setText("fill-opacity-bar-stripes-value", `${el("fill-opacity-bar-stripes")?.value ?? 100}%`);
    setText("fill-opacity-halftone-value", `${el("fill-opacity-halftone")?.value ?? 100}%`);
    setText("fill-opacity-mesh-value", `${el("fill-opacity-mesh")?.value ?? 100}%`);
    const gt = el("fill-grad-type");
    if (gt) {
      const o = gt.options[gt.selectedIndex];
      setText("fill-grad-type-value", o ? o.text : "");
    }
    setText("fill-grad-linear-angle-value", `${el("fill-grad-linear-angle")?.value ?? 0}°`);
    setText("fill-grad-radial-x-value", `${el("fill-grad-radial-x")?.value ?? 0}%`);
    setText("fill-grad-radial-y-value", `${el("fill-grad-radial-y")?.value ?? 0}%`);
    const bgt = el("bg-grad-type");
    if (bgt) {
      const o = bgt.options[bgt.selectedIndex];
      setText("bg-grad-type-value", o ? o.text : "");
    }
    setText("bg-grad-linear-angle-value", `${el("bg-grad-linear-angle")?.value ?? 160}°`);
    setText("bg-grad-radial-x-value", `${el("bg-grad-radial-x")?.value ?? 50}%`);
    setText("bg-grad-radial-y-value", `${el("bg-grad-radial-y")?.value ?? 50}%`);
    setText("fill-bar-angle-value", `${el("fill-bar-angle")?.value ?? 0}°`);
    setText("fill-bar-c1-value", el("fill-bar-c1")?.value ?? "");
    setText("fill-bar-w1-value", el("fill-bar-w1")?.value ?? "");
    setText("fill-bar-c2-value", el("fill-bar-c2")?.value ?? "");
    setText("fill-bar-w2-value", el("fill-bar-w2")?.value ?? "");
    setText("fill-bar-c3-value", el("fill-bar-c3")?.value ?? "");
    setText("fill-bar-w3-value", el("fill-bar-w3")?.value ?? "");
    const hs = el("fill-halftone-shape");
    if (hs) {
      const o = hs.options[hs.selectedIndex];
      setText("fill-halftone-shape-value", o ? o.text : "");
    }
    setText("fill-halftone-c1-value", el("fill-halftone-c1")?.value ?? "");
    setText("fill-halftone-c2-value", el("fill-halftone-c2")?.value ?? "");
    const hd = el("fill-halftone-dot")?.value ?? "1.5";
    setText("fill-halftone-dot-value", Number(hd).toFixed(1));
    setText("fill-halftone-cell-value", el("fill-halftone-cell")?.value ?? "");
    setText("fill-halftone-phase-x-value", `${el("fill-halftone-phase-x")?.value ?? 0}%`);
    setText("fill-halftone-phase-y-value", `${el("fill-halftone-phase-y")?.value ?? 0}%`);
    setText("fill-halftone-grid-angle-value", `${el("fill-halftone-grid-angle")?.value ?? 0}°`);
    setText("fill-halftone-brick-value", `${el("fill-halftone-brick")?.value ?? 50}%`);
    setText("fill-mesh-tile-value", el("fill-mesh-tile")?.value ?? "");
    setText("fill-mesh-line-value", `${el("fill-mesh-line")?.value ?? 0}%`);
    setText("fill-mesh-a1-value", `${el("fill-mesh-a1")?.value ?? 0}°`);
    setText("fill-mesh-a2-value", `${el("fill-mesh-a2")?.value ?? 0}°`);
    setText("fill-mesh-a3-value", `${el("fill-mesh-a3")?.value ?? 0}°`);
    setText("fill-mesh-c1-value", el("fill-mesh-c1")?.value ?? "");
    setText("fill-mesh-c2-value", el("fill-mesh-c2")?.value ?? "");
    setText("fill-mesh-c3-value", el("fill-mesh-c3")?.value ?? "");
    setText("fill-mesh-base-value", el("fill-mesh-base")?.value ?? "");
    setText("css-shadow-blur-value", el("css-shadow-blur")?.value);
    setText("css-shadow-x-value", el("css-shadow-x")?.value);
    setText("css-shadow-y-value", el("css-shadow-y")?.value);
  }

  function setText(id, value) {
    const node = el(id);
    if (node && value !== undefined && value !== null) {
      node.textContent = String(value);
    }
  }

  function bindPreviewBgMirrors() {
    const master = el("preview-bg-color");
    const mirrors = document.querySelectorAll("[data-preview-bg-mirror]");
    if (!master) return;
    function toMirrors(v) {
      mirrors.forEach((m) => {
        if (document.activeElement !== m) m.value = v;
      });
    }
    master.addEventListener("input", () => {
      toMirrors(master.value);
      sync();
    });
    master.addEventListener("change", () => {
      toMirrors(master.value);
      sync();
    });
    mirrors.forEach((m) => {
      m.addEventListener("input", () => {
        master.value = m.value;
        toMirrors(master.value);
        sync();
      });
      m.addEventListener("change", () => {
        master.value = m.value;
        toMirrors(master.value);
        sync();
      });
    });
  }

  const listenIds = [
    "axis-thickness",
    "axis-variation",
    "base-age",
    "base-gender",
    "base-size",
    "base-pos-x",
    "base-pos-y",
    "css-skew",
    "css-skew-y",
    "fill-pattern-scale",
    "backdrop-pattern-scale",
    "preview-pattern-color",
    "backdrop-stripes-angle",
    "backdrop-stripes-band",
    "backdrop-stripes-gap",
    "backdrop-stripes-wave-amp",
    "backdrop-stripes-wave-freq",
    "backdrop-dots-shape",
    "backdrop-dots-radius",
    "backdrop-dots-spacing",
    "backdrop-dots-size-var",
    "backdrop-dots-row-stagger",
    "backdrop-dots-col-stagger",
    "backdrop-dots-jitter",
    "backdrop-dots-seed",
    "backdrop-grid-cell",
    "backdrop-grid-line",
    "backdrop-grid-rotate",
    "backdrop-grid-wave",
    "fill-grad-type",
    "fill-grad-linear-angle",
    "fill-grad-radial-x",
    "fill-grad-radial-y",
    "fill-grad-c1",
    "fill-grad-c2",
    "fill-grad-c3",
    "bg-grad-type",
    "bg-grad-linear-angle",
    "bg-grad-radial-x",
    "bg-grad-radial-y",
    "bg-grad-c1",
    "bg-grad-c2",
    "bg-grad-c3",
    "fill-bar-angle",
    "fill-bar-c1",
    "fill-bar-c2",
    "fill-bar-c3",
    "fill-bar-w1",
    "fill-bar-w2",
    "fill-bar-w3",
    "fill-halftone-shape",
    "fill-halftone-c1",
    "fill-halftone-c2",
    "fill-halftone-dot",
    "fill-halftone-cell",
    "fill-halftone-phase-x",
    "fill-halftone-phase-y",
    "fill-halftone-grid-angle",
    "fill-halftone-brick",
    "fill-mesh-tile",
    "fill-mesh-line",
    "fill-mesh-a1",
    "fill-mesh-a2",
    "fill-mesh-a3",
    "fill-mesh-c1",
    "fill-mesh-c2",
    "fill-mesh-c3",
    "fill-mesh-base",
    "fill-opacity-solid",
    "fill-opacity-gradient",
    "fill-opacity-bar-stripes",
    "fill-opacity-halftone",
    "fill-opacity-mesh",
    "css-text-color",
    "css-shadow-blur",
    "css-shadow-x",
    "css-shadow-y",
    "class-multiclass",
  ];

  function markCustom() {
    const sel = el("base-preset");
    if (sel && sel.value !== "custom") sel.value = "custom";
  }

  for (const id of listenIds) {
    const node = el(id);
    if (node) {
      node.addEventListener("input", () => { markCustom(); sync(); });
      node.addEventListener("change", () => { markCustom(); sync(); });
    }
  }

  bindPreviewBgMirrors();

  function bindFillUi() {
    document.querySelectorAll('input[name="letter-fill-mode"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        if (_batchUpdate) return;
        markCustom();
        updateFillPanels();
        updateGradientFieldsVisibility();
        sync();
      });
    });
  }

  function bindBaseUi() {
    const bp = el("base-preset");
    if (bp) {
      bp.addEventListener("change", () => {
        // applyPresetData sets radio buttons which can cascade sync() calls;
        // suppress those and do one deliberate sync() at the end.
        _batchUpdate = true;
        applyUserPreset(bp.value);
        _batchUpdate = false;
        sync();
      });
    }
    // Note: class-multiclass is already covered by the listenIds loop
    // (both 'input' and 'change' registered there). No duplicate needed here.
  }

  function bindBackdropUi() {
    document.querySelectorAll('input[name="backdrop-mode"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        if (_batchUpdate) return;
        markCustom();
        updateBgSubpanels();
        sync();
      });
    });
  }

  function migratePresetPositions() {
    const presets = loadPresetsObject();
    let changed = false;
    Object.keys(presets).forEach((name) => {
      const p = presets[name];
      if (p["base-pos-x"] == null) {
        p["base-pos-x"] = String(30 + Math.floor(Math.random() * 41)); // 30-70
        changed = true;
      }
      if (p["base-pos-y"] == null) {
        p["base-pos-y"] = String(30 + Math.floor(Math.random() * 41)); // 30-70
        changed = true;
      }
    });
    if (changed) savePresetsObject(presets);
  }

  function bindRandomizeButton() {
    el("base-randomize")?.addEventListener("click", () => {
      // Suppress event-driven sync() calls triggered by rRadio() setting .checked;
      // run exactly one deliberate sync() after all values are set.
      _batchUpdate = true;
      markCustom();
      randomizeAllOptions();
      _batchUpdate = false;
      sync();
    });
  }

  function randomColor() {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }

  function randomizeAllOptions() {
    function rInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
    function rFloat(min, max, step) {
      const steps = Math.round((max - min) / step);
      return +(min + Math.floor(Math.random() * (steps + 1)) * step).toFixed(10);
    }
    function rEl(id, v) { const e = el(id); if (e) e.value = v; }
    function rColor(id) { rEl(id, randomColor()); }
    function rRadio(name) {
      const opts = document.querySelectorAll(`input[name="${name}"]`);
      if (opts.length) opts[Math.floor(Math.random() * opts.length)].checked = true;
    }
    function rSelect(id) {
      const e = el(id);
      if (e && e.options.length) e.value = e.options[rInt(0, e.options.length - 1)].value;
    }

    // --- Base ---
    const glyphs = Array.from(ALLOWED_GLYPHS);
    if (glyphs.length > 0) {
      const randomLetter = glyphs[Math.floor(Math.random() * glyphs.length)];
      setLetterChar(randomLetter);
      rEl("glyph-name", randomLetter);
    }
    rEl("base-gender", rInt(0, 100));
    rEl("base-age", rInt(0, 100));
    rEl("base-size", rInt(50, 200));
    rEl("base-pos-x", rInt(20, 80));
    rEl("base-pos-y", rInt(20, 80));

    // --- Body ---
    rEl("axis-thickness", rInt(0, 1000));
    rEl("axis-variation", rInt(0, 1000));
    const multiclass = el("class-multiclass");
    if (multiclass) multiclass.checked = Math.random() < 0.3;
    // Skew towards center using average of two randoms (triangle distribution), then mirror for balance
    const skewBase = Math.round(((Math.random() + Math.random()) / 2 - 0.5) * 2 * 35);
    const skewYOffset = Math.round((Math.random() * 0.3 - 0.15) * 30); // small variance ±15% of max
    rEl("css-skew", Math.max(-35, Math.min(35, skewBase)));
    rEl("css-skew-y", Math.max(-30, Math.min(30, -skewBase + skewYOffset)));

    // --- Letter fill ---
    rRadio("letter-fill-mode");
    rEl("fill-pattern-scale", rInt(50, 900));

    // Solid
    rColor("css-text-color");
    rEl("fill-opacity-solid", rInt(75, 100));

    // Gradient
    rSelect("fill-grad-type");
    rEl("fill-grad-linear-angle", rInt(0, 360));
    rEl("fill-grad-radial-x", rInt(0, 100));
    rEl("fill-grad-radial-y", rInt(0, 100));
    rColor("fill-grad-c1");
    rColor("fill-grad-c2");
    rColor("fill-grad-c3");
    rEl("fill-grad-p2", rInt(5, 95));
    rEl("fill-opacity-gradient", rInt(75, 100));

    // Bar stripes
    rEl("fill-bar-angle", rInt(0, 360));
    rColor("fill-bar-c1");
    rEl("fill-bar-w1", rInt(2, 24));
    rColor("fill-bar-c2");
    rEl("fill-bar-w2", rInt(2, 24));
    rColor("fill-bar-c3");
    rEl("fill-bar-w3", rInt(2, 24));
    rEl("fill-opacity-bar-stripes", rInt(75, 100));

    // Halftone
    rSelect("fill-halftone-shape");
    rColor("fill-halftone-c1");
    rColor("fill-halftone-c2");
    rEl("fill-halftone-dot", rFloat(0.5, 5, 0.1));
    rEl("fill-halftone-cell", rInt(5, 32));
    rEl("fill-halftone-phase-x", rInt(0, 100));
    rEl("fill-halftone-phase-y", rInt(0, 100));
    rEl("fill-halftone-grid-angle", rInt(0, 90));
    rEl("fill-halftone-brick", rInt(0, 100));
    rEl("fill-opacity-halftone", rInt(75, 100));

    // Mesh
    rEl("fill-mesh-tile", rInt(12, 80));
    rEl("fill-mesh-line", rInt(8, 45));
    rEl("fill-mesh-a1", rInt(0, 360));
    rEl("fill-mesh-a2", rInt(0, 360));
    rEl("fill-mesh-a3", rInt(0, 360));
    rColor("fill-mesh-c1");
    rColor("fill-mesh-c2");
    rColor("fill-mesh-c3");
    rColor("fill-mesh-base");
    rEl("fill-opacity-mesh", rInt(75, 100));

    // --- Shadow ---
    rEl("css-shadow-blur", rInt(0, 48));
    rEl("css-shadow-x", rInt(-40, 40));
    rEl("css-shadow-y", rInt(-40, 40));

    // --- Background ---
    rRadio("backdrop-mode");
    const bgC = randomColor();
    rEl("preview-bg-color", bgC);
    rEl("preview-bg-color-gradient", bgC);
    rEl("preview-bg-color-pattern", bgC);
    rColor("preview-pattern-color");

    // Background gradient
    rSelect("bg-grad-type");
    rEl("bg-grad-linear-angle", rInt(0, 360));
    rEl("bg-grad-radial-x", rInt(0, 100));
    rEl("bg-grad-radial-y", rInt(0, 100));
    rColor("bg-grad-c1");
    rColor("bg-grad-c2");
    rColor("bg-grad-c3");
    rEl("bg-grad-p2", rInt(5, 95));

    // Background pattern
    rEl("backdrop-pattern-scale", rInt(25, 300));

    // Stripes
    rEl("backdrop-stripes-angle", rInt(-90, 90));
    rEl("backdrop-stripes-band", rInt(1, 40));
    rEl("backdrop-stripes-gap", rInt(4, 80));
    rEl("backdrop-stripes-wave-amp", rInt(0, 50));
    rEl("backdrop-stripes-wave-freq", rInt(1, 20));

    // Dots
    rSelect("backdrop-dots-shape");
    rEl("backdrop-dots-radius", rInt(1, 60));
    // Floor at 20 to prevent pathological SVG counts (4px spacing ≈ 15 000 shapes
    // per frame; the slider still allows 4 manually for deliberate use).
    rEl("backdrop-dots-spacing", rInt(20, 120));
    rEl("backdrop-dots-size-var", rInt(0, 100));
    rEl("backdrop-dots-row-stagger", rInt(0, 100));
    rEl("backdrop-dots-col-stagger", rInt(0, 100));
    rEl("backdrop-dots-jitter", rInt(0, 100));
    rEl("backdrop-dots-seed", rInt(0, 999));

    // Grid
    rEl("backdrop-grid-cell", rInt(4, 200));
    rEl("backdrop-grid-line", rInt(1, 20));
    rEl("backdrop-grid-rotate", rInt(0, 90));
    rEl("backdrop-grid-wave", rInt(0, 50));
    // updateValueDisplays() removed — sync() handles this immediately after
  }

  /** Convert font file to base64 data URL (cached). */
  let _fontDataUrl = null;
  let _fontDataUrlA = null;

  async function fetchFontDataUrl(path) {
    try {
      const resp = await fetch(path);
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return "data:font/truetype;base64," + btoa(binary);
    } catch (e) {
      console.error("Font fetch failed:", path, e);
      return null;
    }
  }

  async function getFontDataUrl() {
    if (_fontDataUrl) return _fontDataUrl;
    _fontDataUrl = await fetchFontDataUrl("CharacterCreator/Variable-TT/CharacterCreatorV2-VF.ttf");
    return _fontDataUrl;
  }

  async function getFontDataUrlA() {
    if (_fontDataUrlA) return _fontDataUrlA;
    _fontDataUrlA = await fetchFontDataUrl("CharacterCreator/Variable-TT/CharacterCreatorV2-A.ttf");
    return _fontDataUrlA;
  }

  /** Deep-clone a DOM element with all computed styles inlined. */
  function cloneWithInlineStyles(src) {
    const clone = src.cloneNode(true);
    function applyStyles(original, copy) {
      if (original.nodeType !== 1) return;
      const cs = getComputedStyle(original);
      for (let i = 0; i < cs.length; i++) {
        const prop = cs[i];
        copy.style.setProperty(prop, cs.getPropertyValue(prop));
      }
      // Preserve SVG innerHTML (patterns etc)
      if (original.tagName === "svg" || original.tagName === "SVG") {
        copy.innerHTML = original.innerHTML;
        return; // skip children since innerHTML covers it
      }
      const srcKids = original.children;
      const dstKids = copy.children;
      for (let i = 0; i < srcKids.length; i++) {
        if (dstKids[i]) applyStyles(srcKids[i], dstKids[i]);
      }
    }
    applyStyles(src, clone);
    return clone;
  }

  /** Capture the main viewport frame as a canvas using foreignObject SVG. */
  async function captureViewportPng(snapW, snapH) {
    if (!frame) return null;
    const [fontUrl, fontUrlA] = await Promise.all([getFontDataUrl(), getFontDataUrlA()]);

    // Register fonts in document.fonts via FontFace API and await the load.
    // foreignObject shares the parent document's FontFace registry, so fonts
    // loaded this way are immediately available when the SVG is rasterized —
    // unlike @font-face in an embedded <style>, which triggers a new async
    // download that img.onload doesn't wait for.
    async function ensureFontFace(name, url) {
      if (!url) return;
      try {
        const ff = new FontFace(name, `url("${url}")`);
        await ff.load();
        document.fonts.add(ff);
      } catch (e) {
        console.warn("FontFace load failed for", name, e);
      }
    }
    await Promise.all([
      ensureFontFace("Character Creator",   fontUrl),
      ensureFontFace("Character Creator A", fontUrlA),
    ]);
    await document.fonts.ready;

    const rect = frame.getBoundingClientRect();
    const w = snapW || Math.round(rect.width);
    const h = snapH || Math.round(rect.height);
    const scale = 2;

    // Clone and inline all styles
    const clone = cloneWithInlineStyles(frame);
    clone.style.position = "relative";
    clone.style.margin = "0";
    clone.style.width = w + "px";
    clone.style.height = h + "px";
    clone.style.removeProperty("container-type");
    clone.style.removeProperty("container-name");

    // font-variation-settings is often not enumerated by getComputedStyle iteration,
    // so explicitly copy it from the live letter element to the cloned one.
    const clonedLetter = clone.querySelector(".viewport-letter");
    if (clonedLetter && letter && letter.style.fontVariationSettings) {
      clonedLetter.style.fontVariationSettings = letter.style.fontVariationSettings;
    }

    // Inline the SVG age filter so url(#filter-letter-age) works inside foreignObject
    const ageFilter = document.getElementById("filter-letter-age");
    let filterXhtml = "";
    if (ageFilter) {
      const filterSvg = ageFilter.closest("svg");
      if (filterSvg) {
        filterXhtml = `<div xmlns="http://www.w3.org/1999/xhtml" style="position:absolute;width:0;height:0;overflow:hidden;">${new XMLSerializer().serializeToString(filterSvg)}</div>`;
      }
    }

    // Use XMLSerializer on the clone for well-formed XHTML
    // XMLSerializer will add xmlns="http://www.w3.org/1999/xhtml" automatically
    const serializer = new XMLSerializer();
    const cloneXhtml = serializer.serializeToString(clone);

    // Build @font-face rules. Embed them inside the foreignObject HTML so they
    // are in the correct document context — SVG <defs> styles don't reliably
    // cascade into foreignObject for variable font axes.
    const fontFaceRules = [
      fontUrl  ? `@font-face { font-family: "Character Creator";   src: url("${fontUrl}")  format("truetype"); font-weight: 400; font-style: normal; }` : "",
      fontUrlA ? `@font-face { font-family: "Character Creator A"; src: url("${fontUrlA}") format("truetype"); font-weight: 400; font-style: normal; }` : "",
    ].filter(Boolean).join(" ");
    const fontStyleTag = fontFaceRules
      ? `<style xmlns="http://www.w3.org/1999/xhtml">${fontFaceRules}</style>`
      : "";

    const svgStr = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}">`,
      `<foreignObject x="0" y="0" width="${w}" height="${h}" transform="scale(${scale})">`,
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;overflow:hidden;margin:0;">`,
      fontStyleTag,
      filterXhtml,
      cloneXhtml,
      `</div>`,
      `</foreignObject>`,
      `</svg>`,
    ].join("");

    // Use data URI to avoid blob URL CORS/taint issues
    const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = (e) => {
        console.error("SVG image load failed", e);
        reject(e);
      };
      img.src = svgDataUrl;
    });
  }

  function bindFinalizeUi() {
    const overlay = el("finalize-overlay");
    const previewImg = el("finalize-preview-img");
    let capturedCanvas = null;

    el("finalize-open")?.addEventListener("click", async () => {
      const st = el("finalize-status");
      if (st) st.textContent = "Rendering…";
      if (overlay) overlay.hidden = false;
      if (previewImg) previewImg.src = "";

      // Snapshot dimensions before overlay alters layout, then render
      const snapRect = frame ? frame.getBoundingClientRect() : null;
      const snapW = snapRect ? Math.round(snapRect.width) : 0;
      const snapH = snapRect ? Math.round(snapRect.height) : 0;

      try {
        capturedCanvas = await captureViewportPng(snapW, snapH);
        if (capturedCanvas && previewImg) {
          previewImg.src = capturedCanvas.toDataURL("image/png");
        }
        if (st) st.textContent = "";
      } catch (err) {
        console.error("Capture error:", err);
        if (st) st.textContent = "Could not capture preview.";
      }
    });

    el("finalize-close")?.addEventListener("click", () => {
      if (overlay) overlay.hidden = true;
    });
    overlay?.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });

    el("finalize-download")?.addEventListener("click", () => {
      const st = el("finalize-status");
      if (!capturedCanvas) {
        if (st) st.textContent = "No image captured yet.";
        return;
      }
      capturedCanvas.toBlob((blob) => {
        if (!blob) { if (st) st.textContent = "Export produced no data."; return; }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "My Character!.png";
        a.click();
        URL.revokeObjectURL(a.href);
        if (st) st.textContent = "Download started.";
      });
    });

    el("finalize-send-email")?.addEventListener("click", async () => {
      const email = el("finalize-email")?.value?.trim();
      const st = el("finalize-status");
      const endpoint = window.CHARACTER_MAIL_ENDPOINT;
      if (!email) {
        if (st) st.textContent = "Enter an email address.";
        return;
      }
      if (!endpoint) {
        if (st)
          st.textContent =
            "Set window.CHARACTER_MAIL_ENDPOINT to your API URL, or download the PNG and attach it manually.";
        return;
      }
      if (!capturedCanvas) {
        if (st) st.textContent = "No image captured yet.";
        return;
      }
      try {
        const imageBase64 = capturedCanvas.toDataURL("image/png");
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            imageBase64,
            glyph: letter?.textContent ?? "A",
          }),
        });
        if (res.ok) {
          if (st) st.textContent = "Sent. Check your inbox.";
        } else {
          if (st) st.textContent = `Send failed (${res.status}). Check your server.`;
        }
      } catch {
        if (st) st.textContent = "Network error sending email.";
      }
    });
  }

  migratePresetPositions();
  rebuildPresetSelect();
  bindFillUi();
  bindGradStopsRail();
  bindBgGradStopsRail();
  bindBackdropUi();
  bindBaseUi();
  bindRandomizeButton();
  bindFinalizeUi();
  bindGlyphName();
  updateGradRailUi();
  updateBgGradRailUi();

  // Re-render SVG patterns when viewport resizes
  if (typeof ResizeObserver !== "undefined" && frame) {
    const ro = new ResizeObserver(() => {
      const key = getSelectedBackdropMode();
      if (key === "stripes" || key === "dots" || key === "grid") {
        applyPreviewBackdrop();
      }
    });
    ro.observe(frame);
  }

  sync();
})();

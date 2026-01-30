mapboxgl.accessToken = "PASTE_YOUR_MAPBOX_TOKEN_HERE";

/**
 * Flat, interactive map + reliable nearest-route picking.
 * Works even when routes are close/overlapping because we compute
 * distance from click point to each candidate line in screen pixels.
 */

// ----- CONFIG -----
const START_CENTER = [-35, 18];
const START_ZOOM = 1.8;

// forgiving click radius box (px)
const CLICK_BOX_RADIUS = 30;

// fat invisible hit line (px)
const HIT_LINE_WIDTH = 70;

// Used for distance calc: we consider only features returned in the click box
// so this stays fast even on mobile.
const UNLOCK_TARGET = 4;
// ------------------

const inspected = new Set();

function normalizeId(v) {
  return String(v || "").trim().toUpperCase();
}

function setStatus() {
  const el = document.getElementById("status");
  if (el) el.textContent = `Collected: ${inspected.size}/${UNLOCK_TARGET}`;
}

function fillNode(routeId) {
  const node = document.getElementById(`node-${routeId}`);
  if (node) node.classList.add("filled");
}

function clearNodes() {
  ["R1", "R2", "R3", "R4"].forEach((r) => {
    const n = document.getElementById(`node-${r}`);
    if (n) n.classList.remove("filled");
  });
}

function showSynthesisIfAny() {
  const synth = document.getElementById("synthesis");
  if (synth && inspected.size >= UNLOCK_TARGET) synth.classList.remove("hidden");
}

function showUnlockIfAny() {
  const panel = document.getElementById("unlock");
  const code = document.getElementById("unlockCode");
  if (inspected.size >= UNLOCK_TARGET) {
    if (code) code.textContent = "ROUTES";
    if (panel) panel.classList.remove("hidden");
  }
}

function hideUnlock() {
  const panel = document.getElementById("unlock");
  if (panel) panel.classList.add("hidden");
}

// -----------------------------
// Distance helper (screen px)
// -----------------------------
function distPointToSegment(px, ax, bx) {
  // px, ax, bx are objects: {x,y}
  const x = px.x, y = px.y;
  const x1 = ax.x, y1 = ax.y;
  const x2 = bx.x, y2 = bx.y;

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    const ddx = x - x1, ddy = y - y1;
    return Math.hypot(ddx, ddy);
  }

  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  const cx = x1 + tt * dx;
  const cy = y1 + tt * dy;

  return Math.hypot(x - cx, y - cy);
}

function nearestFeatureToClick(map, features, clickPoint) {
  // Choose the feature whose LineString is closest to the click point
  // in screen pixels. This prevents “R1/R3 reading as R4”.
  let best = null;
  let bestDist = Infinity;

  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;

    // Support LineString only for this escape room
    if (geom.type !== "LineString" || !Array.isArray(geom.coordinates)) continue;

    const coords = geom.coordinates;
    // Convert coords to screen pixels
    const pts = coords.map(([lng, lat]) => map.project([lng, lat]));

    for (let i = 0; i < pts.length - 1; i++) {
      const d = distPointToSegment(clickPoint, pts[i], pts[i + 1]);
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
  }

  return best;
}

// -----------------------------
// Context reveal (R1) — bulletproof
// -----------------------------
window.revealContext = function (routeId) {
  const el = document.getElementById(`context-${routeId}`);
  const btn = document.getElementById(`revealBtn-${routeId}`);
  if (el) el.style.display = "block";
  if (btn) btn.style.display = "none";
};

// -----------------------------
// Map init (flat mercator)
// -----------------------------
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: START_CENTER,
  zoom: START_ZOOM,
  projection: "mercator",
  attributionControl: false
});

map.dragRotate.disable();
map.touchZoomRotate.disableRotation();
map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

map.on("load", async () => {
  map.setFog(null);

  // Load routes
  const res = await fetch("./routes.geojson", { cache: "no-store" });
  const data = await res.json();

  map.addSource("routes", { type: "geojson", data });

  // Visible routes
  map.addLayer({
    id: "routes-core",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffd38a",
      "line-width": 3,
      "line-opacity": 0.85
    }
  });

  // Highlight layer
  map.addLayer({
    id: "route-highlight",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    filter: ["==", ["get", "route_id"], "__NONE__"],
    paint: {
      "line-color": "#ffe8b0",
      "line-width": 8,
      "line-opacity": 0.95
    }
  });

  // Fat invisible hit layer
  map.addLayer({
    id: "routes-hit",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": HIT_LINE_WIDTH,
      "line-opacity": 0.01
    }
  });

  setStatus();

  // Cursor hint
  map.on("mousemove", (e) => {
    const r = CLICK_BOX_RADIUS;
    const box = [
      [e.point.x - r, e.point.y - r],
      [e.point.x + r, e.point.y + r]
    ];
    const feats = map.queryRenderedFeatures(box, { layers: ["routes-hit"] });
    map.getCanvas().style.cursor = feats.length ? "pointer" : "";
  });

  map.on("click", (e) => {
    const r = CLICK_BOX_RADIUS;
    const box = [
      [e.point.x - r, e.point.y - r],
      [e.point.x + r, e.point.y + r]
    ];

    const candidates = map.queryRenderedFeatures(box, { layers: ["routes-hit"] });
    if (!candidates.length) return;

    // ✅ Pick the truly nearest line in screen space
    const picked = nearestFeatureToClick(map, candidates, e.point) || candidates[0];

    const routeId = normalizeId(picked?.properties?.route_id);
    const label = picked?.properties?.label || "Route";
    const echo = picked?.properties?.echo || "";
    const logic = picked?.properties?.logic || "";

    // Count it
    const isNew = routeId && !inspected.has(routeId);
    if (routeId) {
      inspected.add(routeId);
      fillNode(routeId);
    }

    setStatus();
    showSynthesisIfAny();
    showUnlockIfAny();

    // Highlight
    map.setFilter("route-highlight", ["==", ["get", "route_id"], routeId || "__NONE__"]);

    // Context reveal for R1 (button)
    const contextBlock =
      routeId === "R1"
        ? `
        <button id="revealBtn-R1" style="
          margin-top:10px;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.25);
          color: rgba(255,255,255,0.9);
          padding: 6px 10px;
          border-radius: 10px;
          cursor: pointer;
          font-size: 12px;"
          onclick="revealContext('R1')"
        >Reveal Context</button>

        <div id="context-R1" style="display:none; margin-top:10px; border-top:1px solid rgba(255,255,255,0.25); padding-top:10px; font-size:12px; line-height:1.4; opacity:0.95;">
          <div style="text-transform:uppercase; letter-spacing:0.12em; font-size:10px; opacity:0.7; margin-bottom:6px;">Context Reveal</div>
          <p style="margin:6px 0;">The transatlantic slave trade did not end exploitation—it reorganized it.</p>
          <p style="margin:6px 0;">After abolition, European empires turned to new labor systems to keep plantations and ports running. Indian indenture was framed as “free labor,” but in practice it often involved deception, debt, violence, and the inability to leave.</p>
          <p style="margin:6px 0;">African enslavement and Indian indenture were not the same—but they were connected. Both fed the same global economy. Both were governed by empire. And both reshaped what race, labor, and freedom would mean in the modern world.</p>
          <p style="margin:8px 0 0; font-style:italic; opacity:0.85;">What changes when exploitation is renamed instead of ended?</p>
        </div>
        `
        : "";

    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: 13px; line-height: 1.35;">
        <div style="letter-spacing:0.14em; text-transform:uppercase; font-size:10px; opacity:0.75;">
          ${label} — ${routeId || "NO_ID"}
        </div>
        <div style="margin-top:6px; font-weight:700;">
          ${logic ? logic : ""}
        </div>
        <div style="margin-top:6px; opacity:0.9;">${echo}</div>
        <div style="margin-top:10px; font-size:11px; opacity:0.7;">
          ${isNew ? "Collected!" : "Already collected"} • Total: ${inspected.size}/${UNLOCK_TARGET}
        </div>
        ${contextBlock}
      </div>
    `;

    new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "340px" })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  // Reset (if button exists)
  document.getElementById("reset")?.addEventListener("click", () => {
    inspected.clear();
    clearNodes();
    setStatus();
    hideUnlock();
    document.getElementById("synthesis")?.classList.add("hidden");
    map.setFilter("route-highlight", ["==", ["get", "route_id"], "__NONE__"]);
    map.easeTo({ center: START_CENTER, zoom: START_ZOOM, duration: 600 });
  });
});

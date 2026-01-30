alert("app.js is running");

// 1) Paste your Mapbox token here:
mapboxgl.accessToken = "pk.eyJ1Ijoic2hhcnJlbGwyNiIsImEiOiJjbWszZXU2NXAwczBtM2ZvZWEwdzJwNnp0In0.96o-A9UJXMVnihqx-M4jYA";

// ---- CONFIG ----
const START_CENTER = [-35, 18];
const START_ZOOM = 1.8;

// bigger = easier clicking (esp. mobile)
const CLICK_RADIUS_PX = 26;

// keep folks roughly in world view
const WORLD_BOUNDS = [[-180, -70], [180, 85]];

// unlock code when 4/4 collected
const UNLOCK_CODE_TEXT = "ROUTES";

// “R1 priority” — if multiple routes are under the click box, prefer R1 if not yet collected
const PRIORITY_ROUTE_ID = "R1";
// ----------------

// ---- tiny “collect” chime (no file needed) ----
let audioCtx = null;
function playCollectSound(isNew) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(isNew ? 0.18 : 0.09, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (isNew ? 0.18 : 0.12));

    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(isNew ? 784 : 523, t0); // G5 vs C5
    osc.connect(gain).connect(audioCtx.destination);

    const osc2 = audioCtx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(isNew ? 1046 : 659, t0);

    const gain2 = audioCtx.createGain();
    gain2.gain.setValueAtTime(0.0001, t0);
    gain2.gain.exponentialRampToValueAtTime(isNew ? 0.06 : 0.03, t0 + 0.01);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t0 + (isNew ? 0.12 : 0.09));
    osc2.connect(gain2).connect(audioCtx.destination);

    osc.start(t0);
    osc2.start(t0);
    osc.stop(t0 + (isNew ? 0.20 : 0.14));
    osc2.stop(t0 + (isNew ? 0.14 : 0.10));
  } catch {
    // silent fail if blocked
  }
}
// ----------------------------------------------

// ---- Overlay helpers (won’t crash if missing) ----
function showStamp() {
  const stamp = document.getElementById("stamp");
  if (!stamp) return;
  stamp.classList.remove("hidden");
  stamp.classList.remove("show");
  void stamp.offsetWidth; // restart animation
  stamp.classList.add("show");
  window.clearTimeout(showStamp._t);
  showStamp._t = window.setTimeout(() => {
    stamp.classList.add("hidden");
    stamp.classList.remove("show");
  }, 560);
}

function showUnlockCode(codeText = UNLOCK_CODE_TEXT) {
  const panel = document.getElementById("unlock");
  const code = document.getElementById("unlockCode");
  if (code) code.textContent = codeText;
  if (panel) panel.classList.remove("hidden");
}

function hideUnlockCode() {
  const panel = document.getElementById("unlock");
  if (panel) panel.classList.add("hidden");
}
// --------------------------------------------------

// ---- Map init: flat + fully explorable ----
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: START_CENTER,
  zoom: START_ZOOM,
  projection: "mercator",
  attributionControl: false,
  interactive: true
});

map.scrollZoom.enable();
map.dragPan.enable();
map.boxZoom.enable();
map.keyboard.enable();
map.doubleClickZoom.enable();
map.touchZoomRotate.enable({ rotation: false }); // pinch zoom ok, rotate off
map.dragRotate.disable();

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

map.setMaxBounds(WORLD_BOUNDS);
map.setMinZoom(1.2);
map.setMaxZoom(4.6);

map.on("load", async () => {
  map.setFog(null);

  // ---- State ----
  const inspected = new Set();
  let showConstraint = true;
  let showConcealment = true;
  let currentHighlightedRouteId = null;

  // ---- Helpers ----
  const normalizeRouteId = (raw) => String(raw || "").trim().toUpperCase();

  function setNodeFilled(routeId) {
    const node = document.getElementById(`node-${routeId}`);
    if (node) node.classList.add("filled");
  }

  function clearNodes() {
    ["R1","R2","R3","R4"].forEach(r => {
      const n = document.getElementById(`node-${r}`);
      if (n) n.classList.remove("filled");
    });
  }

  function updateEndState() {
    const synth = document.getElementById("synthesis");
    if (inspected.size >= 4) {
      if (synth) synth.classList.remove("hidden");
      showUnlockCode(UNLOCK_CODE_TEXT);
    }
  }

  function getLogicFilter() {
    if (showConstraint && !showConcealment) return ["==", ["get", "logic"], "CONSTRAINT"];
    if (!showConstraint && showConcealment) return ["==", ["get", "logic"], "CONCEALMENT"];
    if (!showConstraint && !showConcealment) return ["==", ["get", "logic"], "__NONE__"];
    return ["!=", ["get", "logic"], "__NONE__"];
  }

  function applyFilters() {
    const f = getLogicFilter();
    map.setFilter("routes-glow", f);
    map.setFilter("routes-core", f);
    map.setFilter("routes-hit", f);
    map.setFilter(
      "route-highlight",
      ["all", f, ["==", ["get", "route_id"], currentHighlightedRouteId || "__NONE__"]]
    );
  }

  function pulseHighlight() {
    map.setPaintProperty("route-highlight", "line-opacity", 0.98);
    map.setPaintProperty("route-highlight", "line-width", 9);
    window.clearTimeout(pulseHighlight._t);
    pulseHighlight._t = window.setTimeout(() => {
      map.setPaintProperty("route-highlight", "line-opacity", 0.82);
      map.setPaintProperty("route-highlight", "line-width", 7);
    }, 150);
  }

  function popupForFeature(feature, lngLat) {
    const routeId = normalizeRouteId(feature?.properties?.route_id);
    const label = feature?.properties?.label || "Route";
    const echo = feature?.properties?.echo || "";
    const logic = feature?.properties?.logic || "";

    const isNew = routeId && !inspected.has(routeId);
    if (routeId) {
      inspected.add(routeId);
      setNodeFilled(routeId);
      updateEndState();
    }

    playCollectSound(Boolean(isNew));
    if (isNew) showStamp();

    // Helpful: shows routeId so you can verify R1 is truly being clicked
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: 13px; line-height: 1.3;">
        <div style="letter-spacing:0.14em; text-transform:uppercase; font-size:10px; opacity:0.75;">
          ${label} — ${routeId || "NO_ID"}
        </div>
        <div style="margin-top:6px; font-weight:700;">
          ${logic === "CONSTRAINT" ? "Constraint" : (logic === "CONCEALMENT" ? "Concealment" : "")}
        </div>
        <div style="margin-top:6px; opacity:0.9;">${echo}</div>
        <div style="margin-top:10px; font-size:11px; opacity:0.7;">Collected: ${inspected.size}/4</div>
      </div>
    `;

    new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "320px" })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
  }

  // ✅ Priority rule function:
  // - Collect all nearby features
  // - If R1 is present and not collected, choose it
  // - Otherwise pick an uncollected route if available
  // - Otherwise pick the “most present” route in the hitbox (best overlap heuristic)
  function getNearestRouteFeature(point) {
    const r = CLICK_RADIUS_PX;
    const box = [
      [point.x - r, point.y - r],
      [point.x + r, point.y + r]
    ];

    const features = map.queryRenderedFeatures(box, { layers: ["routes-hit"] });
    if (!features || features.length === 0) return null;

    // Count occurrence of each route_id within the click box
    const counts = new Map();
    for (const f of features) {
      const id = normalizeRouteId(f?.properties?.route_id);
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    // 1) Hard priority: R1 first if present and not collected
    if (!inspected.has(PRIORITY_ROUTE_ID) && counts.has(PRIORITY_ROUTE_ID)) {
      // return any feature instance that is R1
      return features.find(f => normalizeRouteId(f?.properties?.route_id) === PRIORITY_ROUTE_ID) || features[0];
    }

    // 2) Prefer an uncollected route that is most present in the hitbox
    let bestUncollected = null;
    let bestCount = -1;
    for (const f of features) {
      const id = normalizeRouteId(f?.properties?.route_id);
      if (!id || inspected.has(id)) continue;
      const c = counts.get(id) || 0;
      if (c > bestCount) {
        bestCount = c;
        bestUncollected = f;
      }
    }
    if (bestUncollected) return bestUncollected;

    // 3) Otherwise choose the most present route in the hitbox
    let bestAny = null;
    bestCount = -1;
    for (const f of features) {
      const id = normalizeRouteId(f?.properties?.route_id);
      if (!id) continue;
      const c = counts.get(id) || 0;
      if (c > bestCount) {
        bestCount = c;
        bestAny = f;
      }
    }
    return bestAny || features[0];
  }

  // ---- Load routes geojson ----
  const res = await fetch("./routes.geojson");
  const data = await res.json();

  map.addSource("routes", { type: "geojson", data });

  // Visual layers
  map.addLayer({
    id: "routes-glow",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffcc66",
      "line-width": 4,
      "line-opacity": 0.35,
      "line-blur": 3
    }
  });

  map.addLayer({
    id: "routes-core",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffd38a",
      "line-width": 2,
      "line-opacity": 0.75
    }
  });

  map.addLayer({
    id: "route-highlight",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    filter: ["==", ["get", "route_id"], "__NONE__"],
    paint: {
      "line-color": "#ffe8b0",
      "line-width": 7,
      "line-opacity": 0.82,
      "line-blur": 0.6
    }
  });

  // ✅ Big invisible hit target for easy selection (updated line width)
  map.addLayer({
    id: "routes-hit",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 70,
      "line-opacity": 0.01
    }
  });

  applyFilters();

  // Cursor hint
  map.on("mousemove", (e) => {
    const f = getNearestRouteFeature(e.point);
    map.getCanvas().style.cursor = f ? "pointer" : "";
  });

  // Click/tap
  map.on("click", (e) => {
    const feature = getNearestRouteFeature(e.point);
    if (!feature) return;

    const routeId = normalizeRouteId(feature?.properties?.route_id);

    // Highlight
    currentHighlightedRouteId = routeId || null;
    map.setFilter("route-highlight", ["==", ["get", "route_id"], routeId || "__NONE__"]);
    pulseHighlight();

    // Popup + progress
    popupForFeature(feature, e.lngLat);
  });

  // Toggle buttons
  document.getElementById("toggle-constraint")?.addEventListener("click", () => {
    showConstraint = !showConstraint;
    applyFilters();
  });

  document.getElementById("toggle-concealment")?.addEventListener("click", () => {
    showConcealment = !showConcealment;
    applyFilters();
  });

  // Reset
  document.getElementById("reset")?.addEventListener("click", () => {
    inspected.clear();
    clearNodes();
    document.getElementById("synthesis")?.classList.add("hidden");
    hideUnlockCode();

    showConstraint = true;
    showConcealment = true;
    currentHighlightedRouteId = null;

    map.setFilter("route-highlight", ["==", ["get", "route_id"], "__NONE__"]);
    applyFilters();

    map.easeTo({ center: START_CENTER, zoom: START_ZOOM, duration: 700 });
  });
});

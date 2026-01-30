// 1) Paste your Mapbox token here:
mapboxgl.accessToken = "pk.eyJ1Ijoic2hhcnJlbGwyNiIsImEiOiJjbWszZXU2NXAwczBtM2ZvZWEwdzJwNnp0In0.96o-A9UJXMVnihqx-M4jYA ";

// ---- CONFIG YOU CAN TUNE ----
const START_CENTER = [-35, 18]; // Atlantic-centered
const START_ZOOM = 1.8;

// “Sticky click”: bigger = easier on mobile
const CLICK_RADIUS_PX = 20;

// Keep players roughly in world view
const WORLD_BOUNDS = [[-180, -70], [180, 85]]; // [SW], [NE]

// Unlock code shown after all 4 routes are collected
const UNLOCK_CODE_TEXT = "ROUTES";
// --------------------------------

// ---- Sound: tiny “collect” chime (no file needed) ----
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
    osc2.frequency.setValueAtTime(isNew ? 1046 : 659, t0); // C6 vs E5
    const gain2 = audioCtx.createGain();
    gain2.gain.setValueAtTime(0.0001, t0);
    gain2.gain.exponentialRampToValueAtTime(isNew ? 0.06 : 0.03, t0 + 0.01);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t0 + (isNew ? 0.12 : 0.09));
    osc2.connect(gain2).connect(audioCtx.destination);

    osc.start(t0);
    osc2.start(t0);
    osc.stop(t0 + (isNew ? 0.20 : 0.14));
    osc2.stop(t0 + (isNew ? 0.14 : 0.10));
  } catch (e) {
    // If audio is blocked, fail silently
  }
}
// ------------------------------------------------------

// ---- UI helpers: Stamp + Unlock Panel ----
function showStamp() {
  const stamp = document.getElementById("stamp");
  if (!stamp) return;

  // Ensure it is visible
  stamp.classList.remove("hidden");

  // Restart animation reliably
  stamp.classList.remove("show");
  void stamp.offsetWidth; // force reflow
  stamp.classList.add("show");

  // Hide after animation
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
// ------------------------------------------------------

// Map init: flat + explorable
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: START_CENTER,
  zoom: START_ZOOM,
  projection: "mercator",
  attributionControl: false,
  interactive: true
});

// Fully explorable controls (map-like, no rotation)
map.scrollZoom.enable();
map.dragPan.enable();
map.boxZoom.enable();
map.keyboard.enable();
map.doubleClickZoom.enable();
map.touchZoomRotate.enable({ rotation: false }); // pinch zoom allowed, rotation off
map.dragRotate.disable();

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

// Gentle constraints so players don’t get lost
map.setMaxBounds(WORLD_BOUNDS);
map.setMinZoom(1.2);
map.setMaxZoom(4.2);

// State
const inspected = new Set();
let showConstraint = true;
let showConcealment = true;
let currentHighlightedRouteId = null;

// Progress UI
function setNodeFilled(routeId) {
  const node = document.getElementById(`node-${routeId}`);
  if (node) node.classList.add("filled");
}

function clearNodes() {
  ["R1", "R2", "R3", "R4"].forEach((r) => {
    const n = document.getElementById(`node-${r}`);
    if (n) n.classList.remove("filled");
  });
}

// Reveal synthesis + unlock code after 4/4
function updateEndState() {
  const synth = document.getElementById("synthesis");
  if (inspected.size >= 4) {
    if (synth) synth.classList.remove("hidden");
    showUnlockCode(UNLOCK_CODE_TEXT);
  }
}

// Filtering (Constraint / Concealment toggles)
function getLogicFilter() {
  if (showConstraint && !showConcealment) {
    return ["==", ["get", "logic"], "CONSTRAINT"];
  }
  if (!showConstraint && showConcealment) {
    return ["==", ["get", "logic"], "CONCEALMENT"];
  }
  if (!showConstraint && !showConcealment) {
    return ["==", ["get", "logic"], "__NONE__"];
  }
  return ["!=", ["get", "logic"], "__NONE__"]; // show all
}

function applyFilters() {
  const logicFilter = getLogicFilter();
  map.setFilter("routes-glow", logicFilter);
  map.setFilter("routes-core", logicFilter);
  map.setFilter("routes-hit", logicFilter);

  // Keep highlight aligned with current filter
  map.setFilter(
    "route-highlight",
    ["all", logicFilter, ["==", ["get", "route_id"], currentHighlightedRouteId || "__NONE__"]]
  );
}

// “Fat click” helper: detect routes near pointer/tap
function getNearestRouteFeature(point) {
  const r = CLICK_RADIUS_PX;
  const box = [
    [point.x - r, point.y - r],
    [point.x + r, point.y + r]
  ];
  const features = map.queryRenderedFeatures(box, { layers: ["routes-hit"] });
  if (!features || features.length === 0) return null;
  return features[0];
}

// Highlight pulse
function pulseHighlight() {
  map.setPaintProperty("route-highlight", "line-opacity", 0.98);
  map.setPaintProperty("route-highlight", "line-width", 8);

  window.clearTimeout(pulseHighlight._t);
  pulseHighlight._t = window.setTimeout(() => {
    map.setPaintProperty("route-highlight", "line-opacity", 0.82);
    map.setPaintProperty("route-highlight", "line-width", 6);
  }, 140);
}

// Popup
function popupForFeature(feature, lngLat) {
  const routeId = feature.properties.route_id;
  const label = feature.properties.label;
  const echo = feature.properties.echo;
  const logic = feature.properties.logic;

  const isNew = !inspected.has(routeId);
  inspected.add(routeId);
  setNodeFilled(routeId);
  updateEndState();

  // Feedback
  playCollectSound(isNew);
  if (isNew) showStamp();

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: 13px; line-height: 1.3;">
      <div style="letter-spacing:0.14em; text-transform:uppercase; font-size:10px; opacity:0.75;">${label}</div>
      <div style="margin-top:6px; font-weight:700;">${logic === "CONSTRAINT" ? "Constraint" : "Concealment"}</div>
      <div style="margin-top:6px; opacity:0.9;">${echo}</div>
      <div style="margin-top:10px; font-size:11px; opacity:0.7;">Collected: ${inspected.size}/4</div>
    </div>
  `;

  new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "320px" })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);
}

map.on("load", async () => {
  map.setFog(null); // keep it clean/flat

  // Load routes geojson
  const res = await fetch("./routes.geojson");
  const data = await res.json();

  map.addSource("routes", { type: "geojson", data });

  // Glow base routes
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

  // Core base routes
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

  // Highlight route layer (starts hidden)
  map.addLayer({
    id: "route-highlight",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    filter: ["==", ["get", "route_id"], "__NONE__"],
    paint: {
      "line-color": "#ffe8b0",
      "line-width": 6,
      "line-opacity": 0.82,
      "line-blur": 0.6
    }
  });

  // Big invisible hit target for easy route selection
  map.addLayer({
    id: "routes-hit",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 44,
      "line-opacity": 0.01
    }
  });

  // Apply initial filtering
  applyFilters();

  // Cursor hint
  map.on("mousemove", (e) => {
    const f = getNearestRouteFeature(e.point);
    map.getCanvas().style.cursor = f ? "pointer" : "";
  });

  // Click/tap near any route → highlight + popup + progress + sound
  map.on("click", (e) => {
    const feature = getNearestRouteFeature(e.point);
    if (!feature) return;

    const routeId = feature.properties.route_id;

    // Highlight clicked route
    currentHighlightedRouteId = routeId;
    map.setFilter("route-highlight", ["==", ["get", "route_id"], routeId]);
    pulseHighlight();

    // Show hidden info
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

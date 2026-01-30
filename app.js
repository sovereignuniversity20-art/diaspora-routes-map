// 1) Paste your Mapbox token here:
mapboxgl.accessToken = "pk.eyJ1Ijoic2hhcnJlbGwyNiIsImEiOiJjbWszZXU2NXAwczBtM2ZvZWEwdzJwNnp0In0.96o-A9UJXMVnihqx-M4jYA";

// ---- CONFIG YOU CAN TUNE ----
const START_CENTER = [-35, 18]; // Atlantic-centered
const START_ZOOM = 1.8;
const CLICK_RADIUS_PX = 20;     // “sticky click” radius (increase for mobile)
const WORLD_BOUNDS = [[-180, -70], [180, 85]];
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
    // Slightly different pitch if it's a new route vs repeat click
    osc.frequency.setValueAtTime(isNew ? 784 : 523, t0); // G5 vs C5

    // Optional sparkle (second oscillator very quiet)
    const osc2 = audioCtx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(isNew ? 1046 : 659, t0); // C6 vs E5

    const gain2 = audioCtx.createGain();
    gain2.gain.setValueAtTime(0.0001, t0);
    gain2.gain.exponentialRampToValueAtTime(isNew ? 0.06 : 0.03, t0 + 0.01);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t0 + (isNew ? 0.12 : 0.09));

    osc.connect(gain).connect(audioCtx.destination);
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
map.touchZoomRotate.enable({ rotation: false });
map.dragRotate.disable();

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

map.setMaxBounds(WORLD_BOUNDS);
map.setMinZoom(1.2);
map.setMaxZoom(4.2);

const inspected = new Set();
let showConstraint = true;
let showConcealment = true;

function showStamp() {
  const stamp = document.getElementById("stamp");
  if (!stamp) return;
  stamp.classList.remove("hidden", "show");
  // force reflow so animation restarts
  void stamp.offsetWidth;
  stamp.classList.add("show");
  // hide again after animation
  window.clearTimeout(showStamp._t);
  showStamp._t = window.setTimeout(() => {
    stamp.classList.add("hidden");
    stamp.classList.remove("show");
  }, 560);
}

function showUnlockCode(codeText = "ROUTES") {
  const panel = document.getElementById("unlock");
  const code = document.getElementById("unlockCode");
  if (code) code.textContent = codeText;
  if (panel) panel.classList.remove("hidden");
}

function hideUnlockCode() {
  const panel = document.getElementById("unlock");
  if (panel) panel.classList.add("hidden");
}


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
function updateSynthesisVisibility() {
  const synth = document.getElementById("synthesis");
  if (inspected.size >= 4) {
    if (synth) synth.classList.remove("hidden");
    showUnlockCode("ROUTES");
  }
}

function applyFilters() {
  let filter;
  if (showConstraint && !showConcealment) {
    filter = ["==", ["get", "logic"], "CONSTRAINT"];
  } else if (!showConstraint && showConcealment) {
    filter = ["==", ["get", "logic"], "CONCEALMENT"];
  } else if (!showConstraint && !showConcealment) {
    filter = ["==", ["get", "logic"], "__NONE__"];
  } else {
    filter = ["!=", ["get", "logic"], "__NONE__"];
  }

  map.setFilter("routes-glow", filter);
  map.setFilter("routes-core", filter);
  map.setFilter("routes-hit", filter);

  // Keep highlight in sync with current filtering
  map.setFilter("route-highlight", ["all", filter, ["==", ["get", "route_id"], currentHighlightedRouteId || "__NONE__"]]);
}

function popupForFeature(feature, lngLat) {
  const routeId = feature.properties.route_id;
  const label = feature.properties.label;
  const echo = feature.properties.echo;
  const logic = feature.properties.logic;

  const isNew = !inspected.has(routeId);
  inspected.add(routeId);
  setNodeFilled(routeId);
  updateSynthesisVisibility();

  // Sound feedback
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

// Fat click helper
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

// Highlight state
let currentHighlightedRouteId = null;

// Pulse effect: quick brighten then settle
function pulseHighlight() {
  // brief “pop”
  map.setPaintProperty("route-highlight", "line-opacity", 0.95);
  map.setPaintProperty("route-highlight", "line-width", 7);

  window.clearTimeout(pulseHighlight._t);
  pulseHighlight._t = window.setTimeout(() => {
    map.setPaintProperty("route-highlight", "line-opacity", 0.80);
    map.setPaintProperty("route-highlight", "line-width", 6);
  }, 140);
}

map.on("load", async () => {
  map.setFog(null);

  const res = await fetch("./routes.geojson");
  const data = await res.json();

  map.addSource("routes", { type: "geojson", data });

  // Glow base
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

  // Core base
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

  // ✅ Highlight layer (starts hidden)
  map.addLayer({
    id: "route-highlight",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    filter: ["==", ["get", "route_id"], "__NONE__"],
    paint: {
      "line-color": "#ffe8b0",
      "line-width": 6,
      "line-opacity": 0.80,
      "line-blur": 0.6
    }
  });

  // Big invisible hit target
  map.addLayer({
    id: "routes-hit",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 44,     // ✅ very forgiving hit target
      "line-opacity": 0.01
    }
  });

  applyFilters();

  // Cursor hint
  map.on("mousemove", (e) => {
    const f = getNearestRouteFeature(e.point);
    map.getCanvas().style.cursor = f ? "pointer" : "";
  });

  // Click/tap near any route
  map.on("click", (e) => {
    const feature = getNearestRouteFeature(e.point);
    if (!feature) return;

    const routeId = feature.properties.route_id;

    // Set highlight to the clicked route
    currentHighlightedRouteId = routeId;
    map.setFilter("route-highlight", ["==", ["get", "route_id"], routeId]);
    pulseHighlight();

    // Show the info popup + update progress + play sound
    popupForFeature(feature, e.lngLat);
  });

  // Toggle buttons
  document.getElementById("toggle-constraint").addEventListener("click", () => {
    showConstraint = !showConstraint;
    applyFilters();
  });
  document.getElementById("toggle-concealment").addEventListener("click", () => {
    showConcealment = !showConcealment;
    applyFilters();
  });

  document.getElementById("reset").addEventListener("click", () => {
    inspected.clear();
    clearNodes();
    document.getElementById("synthesis").classList.add("hidden");

    hideUnlockCode();

    showConstraint = true;
    showConcealment = true;
    currentHighlightedRouteId = null;

    map.setFilter("route-highlight", ["==", ["get", "route_id"], "__NONE__"]);
    applyFilters();

    map.easeTo({ center: START_CENTER, zoom: START_ZOOM, duration: 700 });
  });
});

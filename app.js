// =========================
// Diaspora Routes — Route 0
// Flat map + forgiving clicks
// =========================

// 1) Mapbox token:
mapboxgl.accessToken = "pk.eyJ1Ijoic2hhcnJlbGwyNiIsImEiOiJjbWszZXU2NXAwczBtM2ZvZWEwdzJwNnp0In0.96o-A9UJXMVnihqx-M4jYA";

// --- Config ---
const START_CENTER = [-35, 18];
const START_ZOOM = 1.8;

const CLICK_RADIUS_PX = 26;     // forgiving click box radius
const HIT_LINE_WIDTH = 70;      // big invisible click target
const WORLD_BOUNDS = [[-180, -70], [180, 85]];

const UNLOCK_CODE_TEXT = "ROUTES";
const PRIORITY_ROUTE_ID = "R1"; // prefer R1 when overlaps happen
// -------------

// --- Helpers ---
const normalizeRouteId = (raw) => String(raw || "").trim().toUpperCase();

function $(id) {
  return document.getElementById(id);
}

// Stamp/unlock overlays (won’t crash if missing)
function showStamp() {
  const stamp = $("stamp");
  if (!stamp) return;
  stamp.classList.remove("hidden");
  stamp.classList.remove("show");
  void stamp.offsetWidth; // restart animation
  stamp.classList.add("show");
  clearTimeout(showStamp._t);
  showStamp._t = setTimeout(() => {
    stamp.classList.add("hidden");
    stamp.classList.remove("show");
  }, 560);
}

function showUnlockCode(text = UNLOCK_CODE_TEXT) {
  const panel = $("unlock");
  const code = $("unlockCode");
  if (code) code.textContent = text;
  if (panel) panel.classList.remove("hidden");
}

function hideUnlockCode() {
  const panel = $("unlock");
  if (panel) panel.classList.add("hidden");
}

// Tiny “collect” chime (no file)
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
    osc.frequency.setValueAtTime(isNew ? 784 : 523, t0);
    osc.connect(gain).connect(audioCtx.destination);

    osc.start(t0);
    osc.stop(t0 + (isNew ? 0.20 : 0.14));
  } catch {
    // ignore
  }
}

// ---------------------------
// 0) Create the map FIRST
// ---------------------------
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: START_CENTER,
  zoom: START_ZOOM,
  projection: "mercator",
  attributionControl: false,
  interactive: true
});

// Fully explorable (no rotation so it stays “map” not “globe”)
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
map.setMaxZoom(4.6);

map.on("load", () => {
  // Basemap loaded even if everything else fails
  map.setFog(null);
});

// ---------------------------
// 1) Route gameplay state
// ---------------------------
const inspected = new Set();
let currentHighlightedRouteId = null;

function setNodeFilled(routeId) {
  const node = $(`node-${routeId}`);
  if (node) node.classList.add("filled");
}

function clearNodes() {
  ["R1", "R2", "R3", "R4"].forEach((r) => {
    const n = $(`node-${r}`);
    if (n) n.classList.remove("filled");
  });
}

function updateEndState() {
  const synth = $("synthesis");
  if (inspected.size >= 4) {
    if (synth) synth.classList.remove("hidden");
    showUnlockCode(UNLOCK_CODE_TEXT);
  }
}

// Highlight pulse (never crashes if layer missing)
function pulseHighlight() {
  if (!map.getLayer("route-highlight")) return;

  map.setPaintProperty("route-highlight", "line-opacity", 0.98);
  map.setPaintProperty("route-highlight", "line-width", 9);

  clearTimeout(pulseHighlight._t);
  pulseHighlight._t = setTimeout(() => {
    if (!map.getLayer("route-highlight")) return;
    map.setPaintProperty("route-highlight", "line-opacity", 0.82);
    map.setPaintProperty("route-highlight", "line-width", 7);
  }, 150);
}

// “Fat click” feature picker with R1 priority
function getNearestRouteFeature(point) {
  const r = CLICK_RADIUS_PX;
  const box = [
    [point.x - r, point.y - r],
    [point.x + r, point.y + r]
  ];

  const features = map.queryRenderedFeatures(box, { layers: ["routes-hit"] });
  if (!features || features.length === 0) return null;

  // Normalize + count
  const counts = new Map();
  for (const f of features) {
    const id = normalizeRouteId(f?.properties?.route_id);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  // 1) Prefer R1 if it exists in this click box and hasn’t been collected
  if (!inspected.has(PRIORITY_ROUTE_ID) && counts.has(PRIORITY_ROUTE_ID)) {
    return features.find(f => normalizeRouteId(f?.properties?.route_id) === PRIORITY_ROUTE_ID) || features[0];
  }

  // 2) Prefer any uncollected route that’s most present in the box
  let best = null;
  let bestCount = -1;
  for (const f of features) {
    const id = normalizeRouteId(f?.properties?.route_id);
    if (!id || inspected.has(id)) continue;
    const c = counts.get(id) || 0;
    if (c > bestCount) {
      best = f;
      bestCount = c;
    }
  }
  if (best) return best;

  // 3) Otherwise, return the most present route
  best = null;
  bestCount = -1;
  for (const f of features) {
    const id = normalizeRouteId(f?.properties?.route_id);
    if (!id) continue;
    const c = counts.get(id) || 0;
    if (c > bestCount) {
      best = f;
      bestCount = c;
    }
  }
  return best || features[0];
}

function openPopupForFeature(feature, lngLat) {
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

  // Debug-friendly label so you can see what’s actually being counted
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

// ---------------------------
// 2) Load routes safely
// ---------------------------
map.on("load", async () => {
  try {
    const res = await fetch("./routes.geojson", { cache: "no-store" });
    if (!res.ok) throw new Error(`routes.geojson fetch failed: ${res.status}`);
    const data = await res.json();

    // Add source
    if (!map.getSource("routes")) {
      map.addSource("routes", { type: "geojson", data });
    }

    // Layers (glow, core, highlight, hit)
    if (!map.getLayer("routes-glow")) {
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
    }

    if (!map.getLayer("routes-core")) {
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
    }

    if (!map.getLayer("route-highlight")) {
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
    }

    if (!map.getLayer("routes-hit")) {
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
    }

    // Mouse cursor hint
    map.on("mousemove", (e) => {
      const f = getNearestRouteFeature(e.point);
      map.getCanvas().style.cursor = f ? "pointer" : "";
    });

    // Click/tap behavior
    map.on("click", (e) => {
      const feature = getNearestRouteFeature(e.point);
      if (!feature) return;

      const routeId = normalizeRouteId(feature?.properties?.route_id);

      // highlight clicked route
      currentHighlightedRouteId = routeId || null;
      map.setFilter("route-highlight", ["==", ["get", "route_id"], routeId || "__NONE__"]);
      pulseHighlight();

      openPopupForFeature(feature, e.lngLat);
    });

    // Buttons (safe if missing)
    $("toggle-constraint")?.addEventListener("click", () => {
      // You can wire logic filters later; keeping button alive now
      playCollectSound(false);
    });

    $("toggle-concealment")?.addEventListener("click", () => {
      playCollectSound(false);
    });

    $("reset")?.addEventListener("click", () => {
      inspected.clear();
      clearNodes();
      $("synthesis")?.classList.add("hidden");
      hideUnlockCode();
      currentHighlightedRouteId = null;

      if (map.getLayer("route-highlight")) {
        map.setFilter("route-highlight", ["==", ["get", "route_id"], "__NONE__"]);
      }

      map.easeTo({ center: START_CENTER, zoom: START_ZOOM, duration: 700 });
    });

  } catch (err) {
    // This ensures the basemap still works even if routes fail
    console.error("Route layer setup failed:", err);
  }
});

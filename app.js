// 1) Paste your Mapbox token here:
mapboxgl.accessToken = "pk.eyJ1Ijoic2hhcnJlbGwyNiIsImEiOiJjbWszZXU2NXAwczBtM2ZvZWEwdzJwNnp0In0.96o-A9UJXMVnihqx-M4jYA";

// ---- CONFIG YOU CAN TUNE ----
const START_CENTER = [-35, 18]; // global-ish Atlantic-centered
const START_ZOOM = 1.8;
const CLICK_RADIUS_PX = 16;     // bigger = easier clicking (mobile friendly)
// --------------------------------

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: START_CENTER,
  zoom: START_ZOOM,
  projection: "mercator",     // ✅ flat projection
  attributionControl: false,
  interactive: true
});

// “Static but interactive” = no panning/zooming/rotating, but clicking still works
map.scrollZoom.disable();
map.boxZoom.disable();
map.dragRotate.disable();
map.dragPan.disable();
map.keyboard.disable();
map.doubleClickZoom.disable();
map.touchZoomRotate.disableRotation();
// Allow touch drag? (kept off for “static mural” feel). If you want light panning later, we can enable dragPan.

const inspected = new Set();
let showConstraint = true;
let showConcealment = true;

function setNodeFilled(routeId) {
  const node = document.getElementById(`node-${routeId}`);
  if (node) node.classList.add("filled");
}
function updateSynthesisVisibility() {
  const synth = document.getElementById("synthesis");
  if (inspected.size >= 4) synth.classList.remove("hidden");
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
  // routes-hit stays unfiltered to preserve clickability? Usually keep it filtered too:
  map.setFilter("routes-hit", filter);
}

function popupForFeature(feature, lngLat) {
  const routeId = feature.properties.route_id;
  const label = feature.properties.label;
  const echo = feature.properties.echo;
  const logic = feature.properties.logic;

  inspected.add(routeId);
  setNodeFilled(routeId);
  updateSynthesisVisibility();

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: 13px; line-height: 1.3;">
      <div style="letter-spacing:0.14em; text-transform:uppercase; font-size:10px; opacity:0.75;">${label}</div>
      <div style="margin-top:6px; font-weight:700;">${logic === "CONSTRAINT" ? "Constraint" : "Concealment"}</div>
      <div style="margin-top:6px; opacity:0.9;">${echo}</div>
      <div style="margin-top:10px; font-size:11px; opacity:0.7;">Collected: ${inspected.size}/4</div>
    </div>
  `;

  new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "300px" })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);
}

// “Fat click” helper: finds a route near the pointer, not just exactly on the line
function getNearestRouteFeature(point) {
  const r = CLICK_RADIUS_PX;
  const box = [
    [point.x - r, point.y - r],
    [point.x + r, point.y + r]
  ];
  // Query rendered features from the clickable hit layer
  const features = map.queryRenderedFeatures(box, { layers: ["routes-hit"] });
  if (!features || features.length === 0) return null;

  // If multiple overlap, pick the first (good enough for 4 routes)
  return features[0];
}

map.on("load", async () => {
  map.setFog(null); // ✅ no globe fog; keep it clean/flat

  const res = await fetch("./routes.geojson");
  const data = await res.json();

  map.addSource("routes", { type: "geojson", data });

  // Soft glow (visual)
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

  // Brighter core
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

  // Big invisible hit target (for easy clicking)
  map.addLayer({
    id: "routes-hit",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 26,     // ✅ MUCH bigger click target
      "line-opacity": 0.01  // invisible but clickable
    }
  });

  applyFilters();

  // Cursor hint when hovering near a route (desktop)
  map.on("mousemove", (e) => {
    const f = getNearestRouteFeature(e.point);
    map.getCanvas().style.cursor = f ? "pointer" : "";
  });

  // ✅ Click anywhere near a route to trigger popup
  map.on("click", (e) => {
    const feature = getNearestRouteFeature(e.point);
    if (!feature) return;
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
    ["R1","R2","R3","R4"].forEach(r => {
      const n = document.getElementById(`node-${r}`);
      if (n) n.classList.remove("filled");
    });
    document.getElementById("synthesis").classList.add("hidden");
    showConstraint = true;
    showConcealment = true;
    applyFilters();
  });
});

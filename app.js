// 1) Paste your Mapbox token here:
mapboxgl.accessToken = "pk.eyJ1Ijoic2hhcnJlbGwyNiIsImEiOiJjbWszZXU2NXAwczBtM2ZvZWEwdzJwNnp0In0.96o-A9UJXMVnihqx-M4jYA";

// 2) Map init
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: [-30, 20],
  zoom: 1.6,
  projection: "globe",
  attributionControl: false
});

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

// State
const inspected = new Set(); // route_ids
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
  const filters = [];
  if (showConstraint && !showConcealment) {
    filters.push(["==", ["get", "logic"], "CONSTRAINT"]);
  } else if (!showConstraint && showConcealment) {
    filters.push(["==", ["get", "logic"], "CONCEALMENT"]);
  } else if (!showConstraint && !showConcealment) {
    // Show nothing
    filters.push(["==", ["get", "logic"], "__NONE__"]);
  } else {
    // Show all
    filters.push(["!=", ["get", "logic"], "__NONE__"]);
  }

  // Set the same filter to both route layers
  map.setFilter("routes-glow", filters[0]);
  map.setFilter("routes-hit", filters[0]);
}

map.on("load", async () => {
  // Make the globe look nicer
  map.setFog({
    color: "rgb(5, 8, 20)",
    "high-color": "rgb(20, 25, 60)",
    "horizon-blend": 0.2
  });

  // Load the GeoJSON
  const res = await fetch("./routes.geojson");
  const data = await res.json();

  map.addSource("routes", {
    type: "geojson",
    data
  });

  // Glow layer (visual)
  map.addLayer({
    id: "routes-glow",
    type: "line",
    source: "routes",
    paint: {
      "line-color": "#ffcc66",
      "line-width": 3,
      "line-opacity": 0.35,
      "line-blur": 2
    }
  });

  // Thinner bright core line
  map.addLayer({
    id: "routes-core",
    type: "line",
    source: "routes",
    paint: {
      "line-color": "#ffd38a",
      "line-width": 1.5,
      "line-opacity": 0.65
    }
  });

  // Invisible-but-clickable hit layer
  map.addLayer({
    id: "routes-hit",
    type: "line",
    source: "routes",
    paint: {
      "line-color": "#ffffff",
      "line-width": 10,
      "line-opacity": 0.01
    }
  });

  // Click handler for routes
  map.on("click", "routes-hit", (e) => {
    const feature = e.features && e.features[0];
    if (!feature) return;

    const routeId = feature.properties.route_id;
    const label = feature.properties.label;
    const echo = feature.properties.echo;
    const logic = feature.properties.logic;

    // Progress update
    inspected.add(routeId);
    setNodeFilled(routeId);
    updateSynthesisVisibility();

    // Popup at click location
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: 13px; line-height: 1.3;">
        <div style="letter-spacing:0.14em; text-transform:uppercase; font-size:10px; opacity:0.75;">${label}</div>
        <div style="margin-top:6px; font-weight:700;">${logic === "CONSTRAINT" ? "Constraint" : "Concealment"}</div>
        <div style="margin-top:6px; opacity:0.9;">${echo}</div>
        <div style="margin-top:10px; font-size:11px; opacity:0.7;">Collected: ${inspected.size}/4</div>
      </div>
    `;

    new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);

    // Optional: visually emphasize the clicked route by filtering a highlight layer
    // We'll do it by setting paint properties dynamically on core layer via feature-state:
    map.setFeatureState(
      { source: "routes", id: feature.id },
      { selected: true }
    );
  });

  // Cursor hint
  map.on("mouseenter", "routes-hit", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "routes-hit", () => {
    map.getCanvas().style.cursor = "";
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

  // Apply initial filters
  applyFilters();
});


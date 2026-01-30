mapboxgl.accessToken = "pk.eyJ1Ijoic2hhcnJlbGwyNiIsImEiOiJjbWszZXU2NXAwczBtM2ZvZWEwdzJwNnp0In0.96o-A9UJXMVnihqx-M4jYA";

const inspected = new Set();

function normalizeId(v) {
  return String(v || "").trim().toUpperCase();
}

function updateStatus() {
  const el = document.getElementById("status");
  if (el) el.textContent = `Collected: ${inspected.size}/4`;
}

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: [-35, 18],
  zoom: 1.8,
  projection: "mercator",   // ✅ flat
  attributionControl: false
});

// fully explorable (no rotation)
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
      "line-opacity": 0.8
    }
  });

  // Fat invisible hit target
  map.addLayer({
    id: "routes-hit",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 60,
      "line-opacity": 0.01
    }
  });

  updateStatus();

  // Cursor hint
  map.on("mousemove", (e) => {
    const feats = map.queryRenderedFeatures(e.point, { layers: ["routes-hit"] });
    map.getCanvas().style.cursor = feats.length ? "pointer" : "";
  });

  // Click = pick nearest feature in a small box (forgiving)
  map.on("click", (e) => {
    const r = 24;
    const box = [
      [e.point.x - r, e.point.y - r],
      [e.point.x + r, e.point.y + r]
    ];
    const feats = map.queryRenderedFeatures(box, { layers: ["routes-hit"] });
    if (!feats.length) return;

    // Pick the first feature; in this simplified build, we just need to confirm IDs
    const f = feats[0];
    const routeId = normalizeId(f.properties.route_id);

    // Count it
    if (routeId) inspected.add(routeId);

    updateStatus();

    // Show popup with the actual ID we detected
    new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
      .setLngLat(e.lngLat)
      .setHTML(`<b>Detected:</b> ${routeId || "NO_ID"}<br/><b>Collected:</b> ${inspected.size}/4`)
      .addTo(map);
  });

  // Reset
  document.getElementById("reset")?.addEventListener("click", () => {
    inspected.clear();
    updateStatus();
    map.easeTo({ center: [-35, 18], zoom: 1.8, duration: 600 });
  });
});

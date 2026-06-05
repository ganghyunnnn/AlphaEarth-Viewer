// Place name / coordinate search → map navigation.
//   - "lat, lng" (or "lng lat") numeric pair → immediate flyTo (assumes Google Maps paste order: lat first)
//   - Any other text → OpenStreetMap Nominatim geocoding (no API key required, CORS allowed) → result list
//
// Per Nominatim usage policy, queries are sent only on submit (Enter / button), not on every keystroke.
// Map B in compare mode has its camera synced to A, so moving A also moves B.
import { t, getLang } from "./i18n.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

export class SearchControl {
  constructor({ form, input, results, map }) {
    this.input = input;
    this.results = results;
    this.map = map;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this._run();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this._hide();
    });
    // Close results on outside click
    document.addEventListener("click", (e) => {
      if (!form.contains(e.target)) this._hide();
    });
  }

  _hide() {
    this.results.hidden = true;
    this.results.innerHTML = "";
  }

  _msg(text) {
    this.results.innerHTML = `<div class="search-msg"></div>`;
    this.results.firstChild.textContent = text; // safe insertion via textContent
    this.results.hidden = false;
  }

  async _run() {
    const q = this.input.value.trim();
    if (!q) return;

    const coord = this._parseCoord(q);
    if (coord) {
      this._flyTo(coord.lng, coord.lat, 12);
      this._hide();
      return;
    }

    this._msg(t("searching"));
    try {
      const url =
        `${NOMINATIM}?format=jsonv2&limit=5` +
        `&accept-language=${encodeURIComponent(getLang())}` +
        `&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        this._msg(t("noResults"));
        return;
      }
      this._renderResults(data);
    } catch {
      this._msg(t("noResults"));
    }
  }

  // "37.5665, 126.978" / "37.5665 126.978" → {lat,lng}. Auto-corrects lat/lng order based on valid range.
  _parseCoord(q) {
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b };
    if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lng: a };
    return null;
  }

  _flyTo(lng, lat, zoom) {
    this.map.flyTo({ center: [lng, lat], zoom, duration: 800 });
  }

  _renderResults(items) {
    this.results.innerHTML = "";
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "search-item";
      b.textContent = it.display_name;
      b.addEventListener("click", () => {
        this._fitItem(it);
        this.input.value = it.display_name;
        this._hide();
      });
      this.results.appendChild(b);
    }
    this.results.hidden = false;
  }

  _fitItem(it) {
    // Nominatim boundingbox: [south, north, west, east] (strings)
    if (Array.isArray(it.boundingbox) && it.boundingbox.length === 4) {
      const [s, n, w, e] = it.boundingbox.map(Number);
      this.map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 60, maxZoom: 14, duration: 800 },
      );
    } else {
      this._flyTo(Number(it.lon), Number(it.lat), 12);
    }
  }
}

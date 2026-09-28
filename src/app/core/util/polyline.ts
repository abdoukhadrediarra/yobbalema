/** Décode une polyligne encodée (algorithme Google, précision 5) en points [lat, lng]. */
export function decodePolyline(encoded: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng'] as const) {
      let result = 0, shift = 0, byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta; else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

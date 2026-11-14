// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Built-in places (offline, so no place name or position is ever sent anywhere).
// Coordinates are public site positions rounded to about 0.001° (≈100 m): plenty for the sky.
// tz = IANA time zone for showing the place's local time.

export const OBSERVATORIES = [
  { id: 'maunakea', name: 'Mauna Kea Observatories', country: 'USA (Hawaiʻi)', lat: 19.8207, lon: -155.4681, elev: 4205, tz: 'Pacific/Honolulu' },
  { id: 'paranal', name: 'Paranal Observatory', country: 'Chile', lat: -24.6272, lon: -70.4042, elev: 2635, tz: 'America/Santiago' },
  { id: 'lasilla', name: 'La Silla Observatory', country: 'Chile', lat: -29.2567, lon: -70.7346, elev: 2400, tz: 'America/Santiago' },
  { id: 'kittpeak', name: 'Kitt Peak National Observatory', country: 'USA (Arizona)', lat: 31.9583, lon: -111.5967, elev: 2096, tz: 'America/Phoenix' },
  { id: 'palomar', name: 'Palomar Observatory', country: 'USA (California)', lat: 33.3563, lon: -116.8650, elev: 1712, tz: 'America/Los_Angeles' },
  { id: 'sidingspring', name: 'Siding Spring Observatory', country: 'Australia', lat: -31.2733, lon: 149.0617, elev: 1165, tz: 'Australia/Sydney' },
  { id: 'alma', name: 'ALMA, Chajnantor plateau', country: 'Chile', lat: -23.0193, lon: -67.7532, elev: 5058, tz: 'America/Santiago' },
  { id: 'mtwilson', name: 'Mount Wilson Observatory', country: 'USA (California)', lat: 34.2257, lon: -118.0572, elev: 1742, tz: 'America/Los_Angeles' },
  { id: 'lapalma', name: 'Roque de los Muchachos Observatory', country: 'Spain (La Palma)', lat: 28.7606, lon: -17.8816, elev: 2396, tz: 'Atlantic/Canary' },
];

export const NASA_CENTRES = [
  { id: 'jpl', name: 'Jet Propulsion Laboratory', country: 'Pasadena, California', lat: 34.2013, lon: -118.1714, elev: 350, tz: 'America/Los_Angeles' },
  { id: 'goddard', name: 'Goddard Space Flight Center', country: 'Greenbelt, Maryland', lat: 38.9910, lon: -76.8520, elev: 50, tz: 'America/New_York' },
  { id: 'johnson', name: 'Johnson Space Center', country: 'Houston, Texas', lat: 29.5593, lon: -95.0900, elev: 10, tz: 'America/Chicago' },
  { id: 'kennedy', name: 'Kennedy Space Center', country: 'Merritt Island, Florida', lat: 28.5729, lon: -80.6490, elev: 3, tz: 'America/New_York' },
  { id: 'ames', name: 'Ames Research Center', country: 'Moffett Field, California', lat: 37.4150, lon: -122.0630, elev: 10, tz: 'America/Los_Angeles' },
  { id: 'marshall', name: 'Marshall Space Flight Center', country: 'Huntsville, Alabama', lat: 34.6460, lon: -86.6740, elev: 190, tz: 'America/Chicago' },
  { id: 'langley', name: 'Langley Research Center', country: 'Hampton, Virginia', lat: 37.0860, lon: -76.3800, elev: 3, tz: 'America/New_York' },
  { id: 'glenn', name: 'Glenn Research Center', country: 'Cleveland, Ohio', lat: 41.4150, lon: -81.8620, elev: 230, tz: 'America/New_York' },
  { id: 'armstrong', name: 'Armstrong Flight Research Center', country: 'Edwards, California', lat: 34.9550, lon: -117.8850, elev: 700, tz: 'America/Los_Angeles' },
  { id: 'stennis', name: 'Stennis Space Center', country: 'Hancock County, Mississippi', lat: 30.3800, lon: -89.6000, elev: 9, tz: 'America/Chicago' },
];

// Short offline city list for the Coordinates tab (DESIGN.md section 16: no online geocoding).
export const CITIES = [
  { id: 'colombo', name: 'Colombo', country: 'Sri Lanka', lat: 6.927, lon: 79.861, elev: 5, tz: 'Asia/Colombo' },
  { id: 'london', name: 'London', country: 'UK', lat: 51.507, lon: -0.128, elev: 20, tz: 'Europe/London' },
  { id: 'newyork', name: 'New York', country: 'USA', lat: 40.713, lon: -74.006, elev: 10, tz: 'America/New_York' },
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', lat: 35.676, lon: 139.650, elev: 40, tz: 'Asia/Tokyo' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', lat: -33.869, lon: 151.209, elev: 20, tz: 'Australia/Sydney' },
  { id: 'delhi', name: 'New Delhi', country: 'India', lat: 28.614, lon: 77.209, elev: 215, tz: 'Asia/Kolkata' },
  { id: 'nairobi', name: 'Nairobi', country: 'Kenya', lat: -1.292, lon: 36.822, elev: 1795, tz: 'Africa/Nairobi' },
  { id: 'saopaulo', name: 'São Paulo', country: 'Brazil', lat: -23.551, lon: -46.633, elev: 760, tz: 'America/Sao_Paulo' },
];

export const DEFAULT_PLACE = CITIES[0];
export const ALL_PRESETS = [...OBSERVATORIES, ...NASA_CENTRES, ...CITIES];

// "lat, long" (degrees, N/E positive; also accepts N/S/E/W letters) or a city name.
// Returns { place } or { error } with the DESIGN.md section 16 wording.
export function parsePlace(text) {
  const s = String(text || '').trim();
  if (!s) return { error: 'Type a big city (e.g. Colombo, London) or latitude, longitude like 6.93, 79.86.' };
  const m = /^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i.exec(s);
  if (m) {
    let lat = +m[1], lon = +m[3];
    if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
    if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'Latitude must be between −90 and 90, and longitude between −180 and 180.' };
    return { place: { id: 'coords', name: `${fmtLat(lat)}, ${fmtLon(lon)}`, country: '', lat, lon, elev: 0, tz: null } };
  }
  const key = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hit = ALL_PRESETS.find(p => p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === key)
    || ALL_PRESETS.find(p => p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(key));
  if (hit) return { place: hit };
  return { error: `We don't know “${s}”. Type a big city (e.g. Colombo, London) or latitude, longitude like 6.93, 79.86.` };
}

export const fmtLat = (v) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? 'N' : 'S'}`;
export const fmtLon = (v) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? 'E' : 'W'}`;

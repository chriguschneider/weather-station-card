// Per-language string table for sv.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const sv: LocaleEntry = {
  'tempHi': 'Temperatur max',
  'tempLo': 'Temperatur min',
  'precip': 'Nederbörd',
  'sunshine': 'Sol',
  'feelsLike': 'Känns som',
  'units': {
      'km/h': 'km/h',
      'm/s': 'm/s',
    'mph': 'mph',
    'Bft': 'Bft',
      'hPa': 'hPa',
      'mmHg': 'mm Hg',
      'mm': 'mm',
      'in': 'in'
  },
  'cardinalDirections': [
      'N', 'N-NE', 'NE', 'E-NE', 'E', 'E-SE', 'SE', 'S-SE',
      'S', 'S-SW', 'SW', 'W-SW', 'W', 'W-NW', 'NW', 'N-NW', 'N'
  ],
  'clear-night': 'Klar natt',
  'cloudy': 'Molnigt',
  'fog': 'Dimma',
  'hail': 'Hagel',
  'lightning': 'Åska',
  'lightning-rainy': 'Åska och regn',
  'partlycloudy': 'Varierat molntäcke',
  'pouring': 'Ösregn',
  'rainy': 'Regnigt',
  'snowy': 'Snöigt',
  'snowy-rainy': 'Snöblandat regn',
  'sunny': 'Soligt',
  'windy': 'Blåsigt',
  'windy-variant': 'Blåsigt'
};

export default sv;

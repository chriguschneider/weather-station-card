// Per-language string table for it.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const it: LocaleEntry = {
  'tempHi': 'Temperatura massima',
  'tempLo': 'Temperatura notte',
  'precip': 'Precipitazioni',
  'sunshine': 'Sole',
  'feelsLike': 'Percepito come',
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
  'clear-night': 'Sereno, notte',
  'cloudy': 'Nuvoloso',
  'fog': 'Nebbia',
  'hail': 'Grandine',
  'lightning': 'Tuoni',
  'lightning-rainy': 'Tuoni e pioggia',
  'partlycloudy': 'Parzialmente nuvoloso',
  'pouring': 'Forti piogge',
  'rainy': 'Pioggia',
  'snowy': 'Neve',
  'snowy-rainy': 'Neve e pioggia',
  'sunny': 'Soleggiato',
  'windy': 'Ventoso',
  'windy-variant': 'Ventoso'
};

export default it;

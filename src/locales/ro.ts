// Per-language string table for ro.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const ro: LocaleEntry = {
  'tempHi': 'Temperatură',
  'tempLo': 'Temperatură noaptea',
  'precip': 'Precipitații',
  'sunshine': 'Soare',
  'feelsLike': 'Se simte ca',
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
    'S', 'S-SV', 'SV', 'V-SV', 'V', 'V-NV', 'NV', 'N-NV', 'N'
  ],
  'clear-night': 'Cer senin, noapte',
  'cloudy': 'Noros',
  'fog': 'Ceață',
  'hail': 'Grindină',
  'lightning': 'Fulger',
  'lightning-rainy': 'Fulger, ploios',
  'partlycloudy': 'Parțial noros',
  'pouring': 'Plouă torențial',
  'rainy': 'Ploios',
  'snowy': 'Ninge',
  'snowy-rainy': 'Ninge, ploios',
  'sunny': 'Însorit',
  'windy': 'Vânt',
  'windy-variant': 'Vânt'
};

export default ro;

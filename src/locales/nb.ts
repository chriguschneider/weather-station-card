// Per-language string table for nb.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const nb: LocaleEntry = {
  'tempHi': 'Maksimumstemperatur',
  'tempLo': 'Minimumstemperatur',
  'precip': 'Nedbør',
  'sunshine': 'Sol',
  'feelsLike': 'Føles som',
  'units': {
    'km/h': 'km/t',
    'm/s': 'm/s',
    'mph': 'mph',
    'Bft': 'Bft',
    'hPa': 'hPa',
    'mmHg': 'mm Hg',
    'mm': 'mm',
    'in': 'in'
  },
  'cardinalDirections': [
      'N', 'N-NE', 'NE', 'Ø-NØ', 'Ø', 'Ø-SØ', 'SØ', 'S-SØ',
      'S', 'S-SV', 'SV', 'V-SV', 'V', 'V-NV', 'NV', 'N-NV', 'N'
  ],
  'clear-night': 'Klar natt',
  'cloudy': 'Overskyet',
  'fog': 'Tåke',
  'hail': 'Hagl',
  'lightning': 'Lyn',
  'lightning-rainy': 'Lyn og regn',
  'partlycloudy': 'Varierende skydekke',
  'pouring': 'Styrtregn',
  'rainy': 'Regn',
  'snowy': 'Snø',
  'snowy-rainy': 'Sludd',
  'sunny': 'Sol',
  'windy': 'Vind',
  'windy-variant': 'Vind'
};

export default nb;

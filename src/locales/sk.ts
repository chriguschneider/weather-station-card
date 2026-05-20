// Per-language string table for sk.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const sk: LocaleEntry = {
  'tempHi': 'Teplota',
  'tempLo': 'Teplota v noci',
  'precip': 'Zrážky',
  'sunshine': 'Slunce',
  'feelsLike': 'Pocitová teplota',
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
    'S', 'S-SV', 'SV', 'V-SV', 'V', 'V-JV', 'JV', 'J-JV',
    'J', 'J-JZ', 'JZ', 'Z-JZ', 'Z', 'Z-SZ', 'SZ', 'S-SZ', 'S'
  ],
  'clear-night': 'Jasná noc',
  'cloudy': 'Oblačno',
  'fog': 'Hmla',
  'hail': 'Krúpy',
  'lightning': 'Búrky',
  'lightning-rainy': 'Búrky, dážď',
  'partlycloudy': 'Polojasno',
  'pouring': 'Silný dážď',
  'rainy': 'Dážď',
  'snowy': 'Sneh',
  'snowy-rainy': 'Sneh s dažďom',
  'sunny': 'Jasno',
  'windy': 'Veterno',
  'windy-variant': 'Veterno'
};

export default sk;

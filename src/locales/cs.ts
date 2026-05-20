// Per-language string table for cs.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const cs: LocaleEntry = {
  'tempHi': 'Teplota',
  'tempLo': 'Teplota v noci',
  'precip': 'Srážky',
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
  'cloudy': 'Zataženo',
  'fog': 'Mlha',
  'hail': 'Kroupy',
  'lightning': 'Bouřky',
  'lightning-rainy': 'Bouřky, déšť',
  'partlycloudy': 'Polojasno',
  'pouring': 'Silný déšť',
  'rainy': 'Déšť',
  'snowy': 'Sníh',
  'snowy-rainy': 'Sníh s deštěm',
  'sunny': 'Jasno',
  'windy': 'Větrno',
  'windy-variant': 'Větrno'
};

export default cs;

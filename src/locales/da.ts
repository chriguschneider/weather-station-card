// Per-language string table for da.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const da: LocaleEntry = {
  'tempHi': 'Temperatur',
  'tempLo': 'Nattemperatur',
  'precip': 'Nedbør',
  'sunshine': 'Sol',
  'feelsLike': 'Føles som',
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
    'N', 'N-NØ', 'NO', 'Ø-NØ', 'Ø', 'Ø-SØ', 'SØ', 'S-SØ',
    'S', 'S-SV', 'SV', 'V-SV', 'V', 'V-NV', 'NV', 'N-NV', 'N'
  ],
  'clear-night': 'Klart',
  'cloudy': 'Overskyet',
  'fog': 'Tåget',
  'hail': 'Hagl',
  'lightning': 'Lyn',
  'lightning-rainy': 'Lyn, regnvejr',
  'partlycloudy': 'Delvist overskyet',
  'pouring': 'Styrtregn',
  'rainy': 'Regn',
  'snowy': 'Sne',
  'snowy-rainy': 'Slud',
  'sunny': 'Sol',
  'windy': 'Blæsende',
  'windy-variant': 'Blæsende'
};

export default da;

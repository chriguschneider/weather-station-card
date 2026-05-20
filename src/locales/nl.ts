// Per-language string table for nl.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const nl: LocaleEntry = {
  'tempHi': 'Temperatuur',
  'tempLo': 'Nachttemperatuur',
  'precip': 'Neerslag',
  'sunshine': 'Zon',
  'feelsLike': 'Voelt als',
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
    'N', 'N-NO', 'NO', 'O-NO', 'O', 'O-ZO', 'ZO', 'Z-ZO',
    'Z', 'Z-ZW', 'ZW', 'W-ZW', 'W', 'W-NW', 'NW', 'N-NW', 'N'
  ],
  'clear-night': 'Helder nacht',
  'cloudy': 'Bewolkt',
  'fog': 'Mist',
  'hail': 'Hagel',
  'lightning': 'Bliksem',
  'lightning-rainy': 'Bliksem, Regen',
  'partlycloudy': 'Gedeeltelijk bewolkt',
  'pouring': 'Regen',
  'rainy': 'Regenachtig',
  'snowy': 'Sneeuw',
  'snowy-rainy': 'Sneeuw, regen',
  'sunny': 'Zonnig',
  'windy': 'Winderig',
  'windy-variant': 'Winderig'
};

export default nl;

// Per-language string table for fi.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const fi: LocaleEntry = {
  'tempHi': 'Lämpötila ylin',
  'tempLo': 'Lämpötila alin',
  'precip': 'Sademäärä',
  'sunshine': 'Aurinko',
  'feelsLike': 'Tuntuu kuin',
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
  'clear-night': 'Y\u00f6, selke\u00e4\u00e4',
  'cloudy': 'Pilvist\u00e4',
  'fog': 'Sumuista',
  'hail': 'Raekuuroja',
  'lightning': 'Ukkoskuuroja',
  'lightning-rainy': 'Ukkosta, sateista',
  'partlycloudy': 'Osittain pilvist\u00e4',
  'pouring': 'Kaatosadetta',
  'rainy': 'Sateista',
  'snowy': 'Lumisadetta',
  'snowy-rainy': 'R\u00e4nt\u00e4sadetta',
  'sunny': 'Aurinkoista',
  'windy': 'Tuulista',
  'windy-variant': 'Tuulista'
};

export default fi;

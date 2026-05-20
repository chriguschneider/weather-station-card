// Per-language string table for lt.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const lt: LocaleEntry = {
  'tempHi': 'Dieną',
  'tempLo': 'Naktį',
  'precip': 'Krituliai',
  'sunshine': 'Saulė',
  'feelsLike': 'Jaučiama',
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
    'Š', 'Š-ŠR', 'ŠR', 'R-ŠR', 'R', 'R-PR', 'PR', 'P-PR',
    'P', 'P-PV', 'PV', 'V-PV', 'V', 'V-ŠV', 'ŠV', 'Š-ŠV', 'Š'
  ],
  'clear-night': 'Giedra naktis',
  'cloudy': 'Debesuota',
  'fog': 'Rūkas',
  'hail': 'Kruša',
  'lightning': 'Perkūnija',
  'lightning-rainy': 'Perkūnija, lietus',
  'partlycloudy': 'Apsiniaukę',
  'pouring': 'Liūtis',
  'rainy': 'Lietus',
  'snowy': 'Sniegas',
  'snowy-rainy': 'Šlapdriba',
  'sunny': 'Saulėta',
  'windy': 'Vėjuota',
  'windy-variant': 'Vėjuota'
};

export default lt;

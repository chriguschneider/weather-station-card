// Per-language string table for hu.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const hu: LocaleEntry = {
  'tempHi': 'Max. hőmérséklet',
  'tempLo': 'Min. hőmérséklet',
  'precip': 'Csapadék',
  'sunshine': 'Nap',
  'feelsLike': 'Hőérzet',
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
    'É', 'É-ÉK', 'ÉK', 'K-ÉK', 'K', 'K-DK', 'DK', 'D-DK',
    'D', 'D-DNY', 'DNY', 'NY-DNY', 'NY', 'NY-ÉNY', 'ÉNY', 'É-ÉNY', 'É'
  ],
  'clear-night': 'Tiszta, éjszaka',
  'cloudy': 'Felhős',
  'fog': 'Ködös',
  'hail': 'Jégeső',
  'lightning': 'Villám',
  'lightning-rainy': 'Zivatar',
  'partlycloudy': 'Részben felhős',
  'pouring': 'Szakadó eső',
  'rainy': 'Esős',
  'snowy': 'Havas',
  'snowy-rainy': 'Havas eső',
  'sunny': 'Napos',
  'windy': 'Szeles',
  'windy-variant': 'Szeles'
};

export default hu;

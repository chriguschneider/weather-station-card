// Per-language string table for pl.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const pl: LocaleEntry = {
  'tempHi': 'Temperatura',
  'tempLo': 'Temperatura w nocy',
  'precip': 'Opady',
  'sunshine': 'Słońce',
  'feelsLike': 'Odczuwalna',
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
  'clear-night': 'Bezchmurna noc',
  'cloudy': 'Pochmurnie',
  'fog': 'Mgła',
  'hail': 'Grad',
  'lightning': 'Błyskawice',
  'lightning-rainy': 'Burza z błyskawicami',
  'partlycloudy': 'Częściowe zachmurzenie',
  'pouring': 'Ulewa',
  'rainy': 'Deszczowo',
  'snowy': 'Śnieg',
  'snowy-rainy': 'Śnieg z deszczem',
  'sunny': 'Słonecznie',
  'windy': 'Wietrznie',
  'windy-variant': 'Zmienny wiatr'
};

export default pl;

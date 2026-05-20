// Per-language string table for es.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const es: LocaleEntry = {
  'tempHi': 'Temperatura máxima',
  'tempLo': 'Temperatura mínima',
  'precip': 'Precipitación',
  'sunshine': 'Sol',
  'feelsLike': 'Sensación térmica',
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
  'clear-night': 'Despejado, noche',
  'cloudy': 'Nublado',
  'fog': 'Niebla',
  'hail': 'Granizo',
  'lightning': 'Truenos',
  'lightning-rainy': 'Lluvia y truenos',
  'partlycloudy': 'Nublado parcialmente',
  'pouring': 'Lluvia fuerte',
  'rainy': 'Lluvia',
  'snowy': 'Nieve',
  'snowy-rainy': 'Aguanieve',
  'sunny': 'Soleado',
  'windy': 'Viento',
  'windy-variant': 'Viento variable'
};

export default es;

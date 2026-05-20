// Per-language string table for ca.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const ca: LocaleEntry = {
  'tempHi': 'Temperatura màxima',
  'tempLo': 'Temperatura mínima',
  'precip': 'Precipitació',
  'sunshine': 'Sol',
  'feelsLike': 'Sensació tèrmica',
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
    'S', 'S-SO', 'SO', 'O-SO', 'O', 'O-NO', 'NO', 'N-NO', 'N'
  ],
  'clear-night': 'Serè',
  'cloudy': 'Ennuvolat',
  'fog': 'Boira',
  'hail': 'Calamarsa',
  'lightning': 'Tempesta elèctrica',
  'lightning-rainy': 'Tempesta',
  'partlycloudy': 'Parcialment ennuvolat',
  'pouring': 'Aiguat',
  'rainy': 'Plujós',
  'snowy': 'Neu',
  'snowy-rainy': 'Aiguaneu',
  'sunny': 'Assolellat',
  'windy': 'Ventós',
  'windy-variant': 'Ràfegues de vent'
};

export default ca;

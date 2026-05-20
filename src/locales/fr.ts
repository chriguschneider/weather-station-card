// Per-language string table for fr.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const fr: LocaleEntry = {
  'tempHi': 'Température max',
  'tempLo': 'Température min',
  'precip': 'Précipitations',
  'sunshine': 'Soleil',
  'feelsLike': 'Ressenti',
  'units': {
    'km/h': 'km/h',
    'm/s': 'm/s',
    'mph': 'mph',
    'Bft': 'Bft',
    'hPa': 'hPa',
    'mmHg': 'mm Hg',
    'mm': 'mm',
    'in': 'po'
  },
  'cardinalDirections': [
    'N', 'N-NE', 'NE', 'E-NE', 'E', 'E-SE', 'SE', 'S-SE',
    'S', 'S-SO', 'SO', 'O-SO', 'O', 'O-NO', 'NO', 'N-NO', 'N'
  ],
  'clear-night': 'Nuit dégagée',
  'cloudy': 'Nuageux',
  'fog': 'Brouillard',
  'hail': 'Grêle',
  'lightning': 'Orage',
  'lightning-rainy': 'Orage et Pluie',
  'partlycloudy': 'Éclaircies',
  'pouring': 'Fortes Pluies',
  'rainy': 'Pluie',
  'snowy': 'Neige',
  'snowy-rainy': 'Neige et Pluie',
  'sunny': 'Ensoleillé',
  'windy': 'Venteux',
  'windy-variant': 'Venteux'
};

export default fr;

// Per-language string table for ru.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const ru: LocaleEntry = {
  'tempHi': 'Температура',
  'tempLo': 'Температура ночью',
  'precip': 'Осадки',
  'sunshine': 'Солнце',
  'feelsLike': 'Ощущается как',
  'units': {
    'km/h': 'км/ч',
    'm/s': 'м/с',
    'mph': 'mph',
    'Bft': 'Bft',
    'hPa': 'гПа',
    'mmHg': 'мм рт.ст.',
    'mm': 'мм',
    'in': 'in'
  },
  'cardinalDirections': [
    'С', 'С-СВ', 'СВ', 'В-СВ', 'В', 'В-ЮВ', 'ЮВ', 'Ю-ЮВ',
    'Ю', 'Ю-ЮЗ', 'ЮЗ', 'З-ЮЗ', 'З', 'З-СЗ', 'СЗ', 'С-СЗ', 'С'
  ],
  'clear-night': 'Ясно',
  'cloudy': 'Облачно',
  'fog': 'Туман',
  'hail': 'Град',
  'lightning': 'Гроза',
  'lightning-rainy': 'Дождь с грозой',
  'partlycloudy': 'Переменная облачность',
  'pouring': 'Ливень',
  'rainy': 'Дождь',
  'snowy': 'Снег',
  'snowy-rainy': 'Снег с дождем',
  'sunny': 'Ясно',
  'windy': 'Ветрено',
  'windy-variant': 'Ветрено'
};

export default ru;

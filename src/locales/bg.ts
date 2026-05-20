// Per-language string table for bg.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const bg: LocaleEntry = {
  'tempHi': 'Максимална температура',
  'tempLo': 'Минимална температура',
  'precip': 'Валежи',
  'sunshine': 'Солнце',
  'feelsLike': 'Усеща се като',
  'units': {
    'km/h': 'км/ч',
    'm/s': 'м/с',
    'mph': 'mph',
    'Bft': 'Bft',
    'hPa': 'hPa',
    'mmHg': 'mmHg',
    'mm': 'мм',
    'in': 'in'
  },
  'cardinalDirections': [
    'С', 'С-СИ', 'СИ', 'И-СИ', 'И', 'И-ЮИ', 'ЮИ', 'Ю-ЮИ',
    'Ю', 'Ю-ЮЗ', 'ЮЗ', 'З-ЮЗ', 'З', 'З-СЗ', 'СЗ', 'С-СЗ', 'С'
  ],
  'clear-night': 'Ясно,нощ',
  'cloudy': 'Облачно',
  'fog': 'Мъгла',
  'hail': 'Градушка',
  'lightning': 'Гръмотевици',
  'lightning-rainy': 'Гръмотевици с дъжд',
  'partlycloudy': 'Разкъсана облачност',
  'pouring': 'Обилни валежи',
  'rainy': 'Дъжд',
  'snowy': 'Сняг',
  'snowy-rainy': 'Сняг с дъжд',
  'sunny': 'Ясно',
  'windy': 'Ветровито',
  'windy-variant': 'Ветровито'
};

export default bg;

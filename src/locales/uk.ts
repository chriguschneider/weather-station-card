// Per-language string table for uk.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const uk: LocaleEntry = {
  'tempHi': 'Температура',
  'tempLo': 'Температура вночі',
  'precip': 'Опади',
  'sunshine': 'Солнце',
  'feelsLike': 'Відчувається як',
  'units': {
    'km/h': 'км/год',
    'm/s': 'м/с',
    'mph': 'миль/год',
    'Bft': 'Bft',
    'hPa': 'гПа',
    'mmHg': 'мм рт. ст.',
    'mm': 'мм',
    'in': 'in'
  },
  'cardinalDirections': [
    'Пн', 'Пн-ПнСх', 'ПнСх', 'Сх-ПнСх', 'Сх', 'Сх-ПдСх', 'ПдСх', 'Пд-ПдСх',
    'Пд', 'Пд-ПдЗх', 'ПдЗх', 'Зх-ПдЗх', 'Зх', 'Зх-ПнЗх', 'ПнЗх', 'Пн-ПнЗх', 'Пн'
  ],
  'clear-night': 'Ясно, ніч',
  'cloudy': 'Хмарно',
  'fog': 'Туман',
  'hail': 'Град',
  'lightning': 'Гроза',
  'lightning-rainy': 'Гроза з дощем',
  'partlycloudy': 'Мінлива хмарність',
  'pouring': 'Злива',
  'rainy': 'Дощ',
  'snowy': 'Сніг',
  'snowy-rainy': 'Мокрий сніг',
  'sunny': 'Сонячно',
  'windy': 'Вітряно',
  'windy-variant': 'Вітряно'
};

export default uk;

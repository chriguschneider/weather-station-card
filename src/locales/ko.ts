// Per-language string table for ko.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale.js';

const ko: LocaleEntry = {
  'tempHi': '최고 기온',
  'tempLo': '최저 기온',
  'precip': '강수',
  'sunshine': '햇빛',
  'feelsLike': '체감',
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
    '북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동',
    '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서', '북'
  ],
  'clear-night': '맑음(밤)',
  'cloudy': '흐림',
  'fog': '안개',
  'hail': '우박',
  'lightning': '번개',
  'lightning-rainy': '번개, 뇌우',
  'partlycloudy': '조금 흐림',
  'pouring': '폭우',
  'rainy': '비',
  'snowy': '눈',
  'snowy-rainy': '진눈깨비',
  'sunny': '맑음',
  'windy': '바람',
  'windy-variant': '강풍'
};

export default ko;

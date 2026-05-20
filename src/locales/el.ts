// Per-language string table for el.
// One file per language so rollup can lazy-load on demand.
// Shape and fallback resolution rules live in ../locale.ts.
import type { LocaleEntry } from '../locale-types.js';

const el: LocaleEntry = {
  'tempHi': 'Μέγιστη θερμοκρασία',
  'tempLo': 'Ελάχιστη θερμοκρασία νύχτας',
  'precip': 'Υετός',
  'sunshine': 'Ήλιος',
  'feelsLike': 'Αίσθηση σαν',
  'units': {
    'km/h': 'χλμ/ώρα',
    'm/s': 'μ/δ',
    'mph': 'mph',
    'Bft': 'Bft',
    'hPa': 'hPa',
    'mmHg': 'χιλ. υδράργυρου',
    'mm': 'χιλ.',
    'in': 'ίντσες'
  },
  'cardinalDirections': [
    'Β', 'Β-ΒΔ', 'ΒΔ', 'Δ-ΒΔ', 'Δ', 'Δ-ΝΔ', 'ΝΔ', 'Ν-ΝΔ',
    'Ν', 'Ν-ΒΔ', 'ΒΔ', 'Β-ΒΔ', 'Β', 'Β-ΒΔ', 'ΒΔ', 'Β-ΒΔ', 'Β'
  ],
  'clear-night': 'Καθαρός ουρανός, νύχτα',
  'cloudy': 'Συννεφιά',
  'fog': 'Ομίχλη',
  'hail': 'Χαλάζι',
  'lightning': 'Κεραυνοί',
  'lightning-rainy': 'Κεραυνοί και βροχή',
  'partlycloudy': 'Μερικώς συννεφιασμένο',
  'pouring': 'Πολύ δυνατή βροχή',
  'rainy': 'Βροχερό',
  'snowy': 'Χιονισμένο',
  'snowy-rainy': 'Χιονόνερο',
  'sunny': 'Ηλιόλουστο',
  'windy': 'Ανεμώδης',
  'windy-variant': 'Ανεμώδης'
};

export default el;

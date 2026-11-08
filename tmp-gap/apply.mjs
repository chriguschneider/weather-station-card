import fs from 'node:fs';
const HOME = {
  bg: ['Домашно време', 'Дом'], ca: ['Hora de casa', 'Casa'], cs: ['Domácí čas', 'Domov'],
  da: ['Hjemmetid', 'Hjem'], el: ['Ώρα σπιτιού', 'Σπίτι'], es: ['Hora de casa', 'Casa'],
  fi: ['Kotiaika', 'Koti'], fr: ['Heure du domicile', 'Domicile'], hu: ['Otthoni idő', 'Otthon'],
  it: ['Ora di casa', 'Casa'], ko: ['집 시간', '집'], lt: ['Namų laikas', 'Namai'],
  nb: ['Hjemmetid', 'Hjem'], nl: ['Thuistijd', 'Thuis'], pl: ['Czas domowy', 'Dom'],
  pt: ['Hora de casa', 'Casa'], ro: ['Ora de acasă', 'Acasă'], ru: ['Домашнее время', 'Дом'],
  sk: ['Domáci čas', 'Domov'], sr: ['Кућно време', 'Кућа'], 'sr-Latn': ['Kućno vreme', 'Kuća'],
  sv: ['Hemtid', 'Hem'], uk: ['Домашній час', 'Дім'],
};
const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const [lang, [homeTime, home]] of Object.entries(HOME)) {
  const file = `src/locales/${lang}.ts`;
  let src = fs.readFileSync(file, 'utf8');
  const trPath = `tmp-gap/tr/${lang}.json`;
  const tr = fs.existsSync(trPath) ? JSON.parse(fs.readFileSync(trPath, 'utf8')) : {};
  tr['editor.time_zone_server'] = homeTime;
  tr['editor.location_summary_home'] = home;
  const topAdd = [];
  const edAdd = [];
  for (const [k, v] of Object.entries(tr)) {
    const editor = k.startsWith('editor.');
    const key = editor ? k.slice(7) : k;
    const indent = editor ? '    ' : '  ';
    const re = new RegExp(`^${indent}'${esc(key)}': '(?:[^'\\\\]|\\\\.)*'(,?)\\s*$`, 'm');
    if (re.test(src)) {
      src = src.replace(re, (m, c) => `${indent}'${key}': ${q(v)}${c}`);
    } else (editor ? edAdd : topAdd).push(`${indent}'${key}': ${q(v)},`);
  }
  if (topAdd.length) {
    if (!/^  'units': \{/m.test(src)) throw new Error(lang + ' no units');
    src = src.replace(/^  'units': \{/m, topAdd.join('\n') + "\n  'units': {");
  }
  if (edAdd.length) {
    if (!/^  'editor': \{\n/m.test(src)) throw new Error(lang + ' no editor');
    src = src.replace(/^  'editor': \{\n/m, (m) => m + edAdd.join('\n') + '\n');
  }
  fs.writeFileSync(file, src);
  console.log(lang, Object.keys(tr).length, 'added', topAdd.length + edAdd.length);
}

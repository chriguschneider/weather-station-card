// usage: node gap.mjs  (run from repo root; needs vitest-free TS import via esbuild-free regex parse)
import fs from 'node:fs';
const dir = 'src/locales/';
function load(f) {
  let s = fs.readFileSync(dir + f, 'utf8');
  s = s.replace(/^\s*export default\s*/m, 'return ').replace(/^import .*$/gm, '').replace(/\bexport\b/g, '');
  s = s.replace(/^(const \w+)\s*:\s*\w+\s*=/m, '$1 =');
  return new Function(s)();
}
const en = load('en.ts');
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' && v ? flat(v, p + k + '.') : [[p + k, v]]);
const enFlat = Object.fromEntries(flat(en));
const out = {};
for (const f of fs.readdirSync(dir)) {
  if (f === 'en.ts') continue;
  const l = f.replace('.ts', '');
  let t; try { t = Object.fromEntries(flat(load(f))); } catch (e) { console.log(l, 'ERR', e.message); continue; }
  out[l] = Object.keys(enFlat).filter((k) => !(k in t) || t[k] === enFlat[k]);
}
for (const [l, k] of Object.entries(out)) console.log(l, k.length);
fs.writeFileSync('tmp-gap/gap.json', JSON.stringify({ en: enFlat, gaps: out }, null, 1));

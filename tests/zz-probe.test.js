import { it } from 'vitest';
import fs from 'node:fs';
import en from '../src/locales/en.js';

it('p', async () => {
  const out = {};
  for (const f of fs.readdirSync('src/locales')) {
    const l = (await import('../src/locales/' + f.replace('.ts', '.js'))).default;
    const miss = Object.keys(en.editor).filter((k) => typeof l.editor?.[k] !== 'string');
    for (const k of miss) (out[k] ??= []).push(f.replace('.ts', ''));
  }
  process.stderr.write('PROBE' + JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])) ) + '\n');
});

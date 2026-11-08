import fs from 'node:fs';
const g = JSON.parse(fs.readFileSync('tmp-gap/gap.json', 'utf8'));
fs.mkdirSync('tmp-gap/todo', { recursive: true });
fs.mkdirSync('tmp-gap/tr', { recursive: true });
for (const [l, keys] of Object.entries(g.gaps)) {
  const todo = {};
  for (const k of keys) {
    if (k.startsWith('units.') || k.startsWith('cardinalDirections.') || k === 'pressure_tooltip_template') continue;
    todo[k] = g.en[k];
  }
  fs.writeFileSync(`tmp-gap/todo/${l}.json`, JSON.stringify(todo, null, 1));
  console.log(l, Object.keys(todo).length);
}

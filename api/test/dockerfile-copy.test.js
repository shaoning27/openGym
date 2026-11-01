/* The api image carries only the files named on api/Dockerfile's COPY line (plus coach/). A
   root-level module that server.ts imports and that line forgets is invisible to every test run
   from the source tree and shows up only when the published image boots — as
   ERR_MODULE_NOT_FOUND, on every instance that pulled it. So the line is checked here, for
   server.ts's own imports and for whatever those modules import from the api root in turn. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(API, f), 'utf8');

// Every `./name.js` a file imports, statically or dynamically — root-level only; coach/ is
// copied as a whole directory.
const rootImports = src => [...src.matchAll(/(?:from\s+|import\s*\(\s*)['"]\.\/([^'"/]+\.[jt]s)['"]/g)].map(m => m[1]);

test('every root-level module server.ts needs is on the Dockerfile COPY line', () => {
  const line = read('Dockerfile').split('\n').find(l => /^COPY\s+/.test(l) && l.includes('*.ts'));
  assert.ok(line, 'the COPY line that carries server.ts');
  const copied = new Set(read('Dockerfile').split('\n')
    .filter(l => /^COPY\s+/.test(l) && !l.includes('--from='))
    .flatMap(l => l.trim().split(/\s+/).slice(1, -1))
    .flatMap(f => f === '*.ts' || f === '*.js' ? fs.readdirSync(API).filter(n => n.endsWith(f.slice(1))) : [f]));

  const needed = new Set(['server.ts']);
  const queue = ['server.ts'];
  while (queue.length) {
    for (const dep of rootImports(read(queue.shift()))) {
      if (!needed.has(dep)) { needed.add(dep); queue.push(dep); }
    }
  }
  assert.ok(needed.has('media.ts'), 'the walk finds the media store');
  assert.ok(needed.has('durable.ts'), 'the walk follows JS compatibility exports into TypeScript');
  const missing = [...needed].filter(f => !copied.has(f));
  assert.deepEqual(missing, [], `add ${missing.join(', ')} to the COPY line in api/Dockerfile`);
  for (const f of copied) {
    if (!f.includes('*')) assert.ok(fs.existsSync(path.join(API, f)), `${f} is copied but does not exist`);
  }
});

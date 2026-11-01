import { readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const source = new URL('../src/service-worker.ts', import.meta.url)
const output = new URL('../public/sw.js', import.meta.url)
const code = stripTypeScriptTypes(readFileSync(source, 'utf8'), { mode: 'strip' })
// Keep the public cache identifiers readable for runtime compatibility checks.
const classic = code.replace(/\b(const|let|var) ([A-Z_]+) +(?==)/g, '$1 $2 ')
const expected = '// GENERATED from src/service-worker.ts; do not edit.\n' + classic
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== expected) throw new Error('Service worker artifact is stale: npm run build:worker')
} else if (readFileSync(output, 'utf8') !== expected) writeFileSync(output, expected)

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const resources = new Set([
  'frontend/src/lib/hevy-id-map.js', 'frontend/src/lib/catalogue-langs.js',
  'frontend/src/lib/exercises-data.js', 'frontend/src/lib/body-paths.js',
  'api/nudge-copy.js', 'api/coach/core/prompts.js', 'api/coach/core/library-data.js',
])
const packs = /^(?:frontend\/src\/(?:locales|instr|exercise-names|exercise-desc))\//
const migrated = [], bridges = [], data = [], unexpected = [], debt = []
function walk(dir) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`
    if (['node_modules', 'test', 'scripts'].includes(entry.name)) continue
    if (entry.isDirectory()) { walk(file); continue }
    if (/\.test\.|\.d\.ts$/.test(file) || !/\.[jt]sx?$/.test(file)) continue
    const source = readFileSync(join(root, file), 'utf8')
    if (/\.tsx?$/.test(file)) {
      migrated.push(file)
      // This is a reproducible syntactic debt count, not a claim of domain coverage.
      const count = (source.match(/:\s*any\b|\bas any\b|<any(?:[,>])/g) || []).length
      if (count) debt.push({ file, explicitDynamicTypes: count })
    } else if (resources.has(file) || packs.test(file)) data.push(file)
    else if (/^(?:\/\/[^\n]*\n)*export \* from ['"]\.\/[^'"]+\.tsx?['"];?\n(?:export \{ default \} from ['"]\.\/[^'"]+\.tsx?['"];?\n)?$/.test(source)) {
      const target = source.match(/from ['"]\.\/([^'"]+)['"]/)?.[1]
      if (!target || !existsSync(join(root, dir, target))) unexpected.push(file)
      else bridges.push(file)
    } else unexpected.push(file)
  }
}
for (const dir of ['frontend/src', 'api', 'mcp/src']) walk(dir)
if (unexpected.length) throw new Error(`Unmigrated JS business implementations:\n${unexpected.join('\n')}`)
const report = {
  standard: 'Full TS/TSX language migration; explicit legacy dynamic types remain.',
  implementations: migrated.sort(), compatibilityEntries: bridges.sort(), resourceModules: data.sort(),
  explicitDynamicTypes: debt.reduce((sum, item) => sum + item.explicitDynamicTypes, 0),
  debt: debt.sort((a, b) => b.explicitDynamicTypes - a.explicitDynamicTypes || a.file.localeCompare(b.file)),
}
const content = JSON.stringify(report, null, 2) + '\n'
const reportPath = join(root, 'docs/typescript-type-debt.json')
if (process.argv.includes('--write')) writeFileSync(reportPath, content)
else if (readFileSync(reportPath, 'utf8') !== content) throw new Error('Migration inventory is stale: node scripts/ci/check-typescript-migration.mjs --write')
console.log(`${migrated.length} TS/TSX modules; ${bridges.length} compatibility entries; ${data.length} resource modules; ${report.explicitDynamicTypes} explicit dynamic type annotations; no JS business implementations.`)

import fs from 'node:fs/promises'
import path from 'node:path'
import { globAbsolute } from './globAbsolute.js'

const README_PATTERN = '{components,extensions,menu,theme}/*/README.md'

/**
 * Reads the README.md of installed content plugins from the framework src directory
 * @param {String} srcDir The framework's src directory
 * @param {String} [name] Limit the result to a single named plugin
 * @returns {Promise<Object<string,string>>} Map of plugin name to README contents
 */
export async function getPluginReadmes (srcDir, name) {
  const pattern = name ? `{components,extensions,menu,theme}/${name}/README.md` : README_PATTERN
  const readmePaths = await globAbsolute(pattern, srcDir)
  const entries = await Promise.all(readmePaths.map(async p => [
    path.basename(path.dirname(p)),
    await fs.readFile(p, 'utf8')
  ]))
  return Object.fromEntries(entries)
}

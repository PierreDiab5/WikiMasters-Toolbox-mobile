import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ORIGIN = 'https://www.wiki-masters.com'

/**
 * Both extension scripts run in one page world on mobile (WebView or userscript).
 * They already talk through a window CustomEvent, so no other change is needed.
 */
export function assemble(network, content) {
  const guard = (name, code) =>
    `  try {\n${code}\n  } catch (error) {\n    console.error('[WikiMasters Toolbox] ${name}', error)\n  }`
  return [
    '(() => {',
    `  if (window.top !== window || location.origin !== '${ORIGIN}') return`,
    guard('network', network),
    guard('content', content),
    '})()',
    '',
  ].join('\n')
}

export function userscript(version, body, repo = '') {
  // On CI, the script updates itself from the `mobile` branch (see mobile.yml).
  const raw = repo
    ? `https://raw.githubusercontent.com/${repo}/mobile/wikimasters-toolbox.user.js`
    : ''
  return [
    '// ==UserScript==',
    '// @name         WikiMasters Toolbox (mobile)',
    '// @namespace    https://github.com/henchoznoe/WikiMasters-Toolbox',
    `// @version      ${version}`,
    '// @description  Prix des cartes et statistiques de paquets pour WikiMasters',
    `// @match        ${ORIGIN}/*`,
    '// @run-at       document-start',
    '// @grant        none',
    '// @noframes',
    ...(raw ? [`// @updateURL    ${raw}`, `// @downloadURL  ${raw}`] : []),
    '// ==/UserScript==',
    '',
    body,
  ].join('\n')
}

async function bundle(root, css, entry) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(entry, root))],
    outfile: 'bundle.js',
    write: false,
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome111', 'firefox115'],
    define: { WM_TOOLBOX_CSS: JSON.stringify(css) },
  })
  return outputFiles[0].text
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url)
  const out = new URL('../dist-mobile/', import.meta.url)
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const css = await readFile(new URL('src/toolbox.css', root), 'utf8')
  // The run number makes every CI build a newer version for userscript managers.
  const version = process.env.GITHUB_RUN_NUMBER
    ? `${pkg.version}.${process.env.GITHUB_RUN_NUMBER}`
    : pkg.version
  // Same order as manifest.json: network first, so fetch/XHR are patched early.
  const network = await bundle(root, css, 'src/network.ts')
  const content = await bundle(root, css, 'src/content.ts')
  const body = assemble(network, content)
  await mkdir(out, { recursive: true })
  await writeFile(new URL('toolbox.js', out), body)
  await writeFile(
    new URL('wikimasters-toolbox.user.js', out),
    userscript(version, body, process.env.GITHUB_REPOSITORY),
  )
  console.log(`dist-mobile/ : ${(body.length / 1024).toFixed(0)} Ko`)
}

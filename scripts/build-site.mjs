/**
 * Build the game as ONE self-contained HTML file (JS + CSS inlined) for static
 * hosting such as GitHub Pages:  npm run build:site  ->  site/index.html
 */
import { build } from 'vite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

await build({ logLevel: 'warn', build: { sourcemap: false } });

const html = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync('dist/assets');
const js = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.js'))}`, 'utf8')
  .replace(/<\/script/gi, '<\\/script');
const css = readFileSync(`dist/assets/${assets.find((f) => f.endsWith('.css'))}`, 'utf8');
const icon = (html.match(/<link rel="icon"[^>]*>/) || [''])[0];

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#06101c">
<meta name="description" content="AEROVANT: an original 2D arcade fighter-jet combat game.">
<title>AEROVANT</title>
${icon}
<style>${css}
html,body{height:100%;margin:0;background:#06101c;color-scheme:dark}</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="ui"></div>
<noscript>AEROVANT needs JavaScript enabled.</noscript>
<script type="module">${js}</script>
</body>
</html>
`;
mkdirSync('site', { recursive: true });
writeFileSync('site/index.html', page);
writeFileSync('site/.nojekyll', '');
console.log(`site/index.html written (${(page.length / 1024).toFixed(0)} KB)`);

'use strict';

// Runs inside Electron (started by capture.js): lays the raw window captures out on a
// backdrop, like windows on a desktop, and saves the finished pictures.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');
const { scenes } = require('./scenes');

const arg = (name) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const rawDir = arg('raw');
const outDir = arg('out');
const only = arg('only') ? arg('only').split(',') : null;
const SCALE = Number(arg('scale')) || 2.5; // must match the --force-device-scale-factor the captures used

const BACKDROPS = {
  bloom: 'radial-gradient(60% 80% at 15% 20%, #FFE7A3 0%, transparent 60%), radial-gradient(55% 70% at 85% 25%, #C9B8FF 0%, transparent 60%), radial-gradient(70% 80% at 60% 100%, #9FD8FF 0%, transparent 65%), linear-gradient(135deg, #FFF4D6, #EDE6FF 50%, #DCEFFF)',
  lilac: 'radial-gradient(60% 80% at 20% 15%, #E9DDFF 0%, transparent 60%), radial-gradient(60% 80% at 90% 90%, #FFD6E8 0%, transparent 60%), linear-gradient(135deg, #F4EEFF, #FBEFF6)',
  sun: 'radial-gradient(60% 80% at 15% 10%, #FFE89A 0%, transparent 60%), radial-gradient(60% 80% at 95% 95%, #FFC9A3 0%, transparent 60%), linear-gradient(135deg, #FFF8DC, #FFEBDD)',
  sea: 'radial-gradient(60% 80% at 10% 15%, #BDEFE4 0%, transparent 60%), radial-gradient(60% 80% at 90% 90%, #BFDBFF 0%, transparent 60%), linear-gradient(135deg, #E8FBF6, #E6F0FF)',
  mint: 'radial-gradient(60% 80% at 10% 10%, #CFF5D6 0%, transparent 60%), radial-gradient(60% 80% at 95% 90%, #FFF0B8 0%, transparent 60%), linear-gradient(135deg, #EEFBF0, #FFF9E3)',
  peach: 'radial-gradient(60% 80% at 15% 15%, #FFD9C2 0%, transparent 60%), radial-gradient(60% 80% at 90% 85%, #FFE89A 0%, transparent 60%), linear-gradient(135deg, #FFF0E6, #FFF8DC)',
  sky: 'radial-gradient(60% 80% at 15% 15%, #C4E2FF 0%, transparent 60%), radial-gradient(60% 80% at 90% 90%, #FFF0B0 0%, transparent 60%), linear-gradient(135deg, #EAF4FF, #FFF9E6)',
  night: 'radial-gradient(60% 80% at 15% 15%, #3A2F63 0%, transparent 60%), radial-gradient(60% 80% at 90% 90%, #1E4A63 0%, transparent 60%), linear-gradient(135deg, #17161F, #101820)',
  plum: 'radial-gradient(60% 80% at 15% 15%, #E3D2FF 0%, transparent 60%), radial-gradient(60% 80% at 90% 90%, #CFE3FF 0%, transparent 60%), linear-gradient(135deg, #F3ECFF, #ECF3FF)'
};

// Windows draws the caption buttons for windows that use titleBarOverlay; a page capture
// doesn't include them, so draw them back in, in the area the page left free for them.
function captionButtons(dark, area) {
  const c = dark ? '#e8e8ea' : '#2b2b2b';
  const w = Math.min(46, (area.width || 138) / 3);
  const h = area.height || 44;
  const icon = (d) => `<span style="width:${w}px;height:${h}px"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="${c}" stroke-width="1">${d}</svg></span>`;
  return `<div class="caption">${icon('<path d="M0 5.5h10"/>')}${icon('<rect x="0.5" y="0.5" width="9" height="9" rx="1.5"/>')}${icon('<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>')}</div>`;
}

function overlayArea(sceneName, shot) {
  try { return JSON.parse(fs.readFileSync(path.join(rawDir, `${sceneName}--${shot}.json`), 'utf8')); }
  catch { return {}; }
}

function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function windowHtml(item, sceneName, dark) {
  const file = path.join(rawDir, `${sceneName}--${item.shot}.png`);
  const size = pngSize(file);
  const scale = item.scale || 1;
  const w = (size.width / SCALE) * scale;
  const h = (size.height / SCALE) * scale;
  const chrome = item.chrome === 'caption' ? captionButtons(dark, overlayArea(sceneName, item.shot)) : '';
  return `<div class="win${dark ? ' dark' : ''}" style="left:${item.x}px;top:${item.y}px;width:${w}px;height:${h}px">
    <img src="${pathToFileURL(file)}" width="${w}" height="${h}">${chrome}</div>`;
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; overflow: hidden; }
  body { position: relative; font-family: "Segoe UI Variable Display", "Segoe UI", Inter, system-ui, sans-serif; }
  .win { position: absolute; border-radius: 8px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0,0,0,.07), 0 2px 6px rgba(0,0,0,.08), 0 18px 40px -8px rgba(40,30,10,.28); }
  .win.dark { box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 2px 6px rgba(0,0,0,.3), 0 20px 44px -8px rgba(0,0,0,.6); }
  .win img { display: block; }
  .caption { position: absolute; top: 0; right: 0; display: flex; }
  .caption span { display: grid; place-items: center; }
`;

function sceneHtml(scene) {
  const dark = scene.theme === 'dark';
  const { width, height, backdrop } = scene.canvas;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    body { width: ${width}px; height: ${height}px; background: ${BACKDROPS[backdrop]}; }
  </style></head><body>${scene.layout.map(item => windowHtml(item, scene.name, dark)).join('')}</body></html>`;
}

// Social preview card (Open Graph / GitHub): wordmark on the left, a few notes on the right.
function socialHtml() {
  const icon = pathToFileURL(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  const layout = [
    { shot: 'nweekendhike', x: 690, y: 96 },
    { shot: 'nlaunchweek', x: 1000, y: 190 }
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    body { width: 1280px; height: 640px; background: ${BACKDROPS.bloom}; }
    .brand { position: absolute; left: 88px; top: 150px; width: 560px; color: #1E1B14; }
    .brand img { width: 112px; height: 112px; margin-left: -10px; }
    .brand h1 { font-size: 76px; line-height: 1; margin: 18px 0 18px; letter-spacing: -0.03em; font-weight: 800; }
    .brand p { font-size: 30px; line-height: 1.3; margin: 0 0 30px; color: #3D3828; font-weight: 500; }
    .brand .meta { font-size: 20px; color: #5E5640; font-weight: 600; }
  </style></head><body>
    <div class="brand"><img src="${icon}"><h1>OpenStickies</h1><p>Sticky notes, rebuilt for the Windows desktop.</p>
    <div class="meta">Free &amp; open source · Windows 10 &amp; 11</div></div>
    ${layout.map(item => windowHtml(item, 'hero', false)).join('')}
  </body></html>`;
}

async function render(html, width, height, outFile, targetWidth) {
  const tmp = path.join(rawDir, `_compose-${path.basename(outFile, '.png')}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ width, height, x: 0, y: 0, show: true, frame: false, useContentSize: true, webPreferences: { sandbox: true } });
  await win.loadFile(tmp);
  await win.webContents.executeJavaScript('Promise.all([...document.images].map(i => i.decode())).then(() => document.fonts.ready).then(() => true)');
  await new Promise(r => setTimeout(r, 300));
  let image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
  if (targetWidth && image.getSize().width !== targetWidth) image = image.resize({ width: targetWidth, quality: 'best' });
  fs.writeFileSync(outFile, image.toPNG());
  win.destroy();
  fs.rmSync(tmp, { force: true });
  const s = image.getSize();
  console.log(`  ${path.relative(process.cwd(), outFile)}  ${s.width}×${s.height}`);
}

// Each picture gets a fresh window; don't let closing the previous one quit the app.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    for (const scene of scenes) {
      if (only && !only.includes(scene.name)) continue;
      const { width, height, outputWidth } = scene.canvas;
      await render(sceneHtml(scene), width, height, path.join(outDir, `${scene.name}.png`), outputWidth || Math.round(width * SCALE));
    }
    if (!only || only.includes('social-preview')) {
      await render(socialHtml(), 1280, 640, path.join(outDir, 'social-preview.png'), 1280);
    }
    app.exit(0);
  } catch (err) {
    console.error('compose:', err && err.stack || err);
    app.exit(1);
  }
});

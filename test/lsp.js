// Opens a Python file with a type error; expects pyright diagnostics as Monaco markers (owner 'lsp').
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-lsp-' + Date.now(); fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'app.py'), 'def add(a: int, b: int) -> int:\n    return a + b\n\nresult: int = add(1, "two")\nprint(undefined_name)\n');
  const app = await electron.launch({ executablePath: process.env.EXE || require('electron'), args: [process.env.EXE ? '' : path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj].filter(Boolean) });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(7000);
  await page.click('text=app.py');
  let markers = [];
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(1000); markers = await page.evaluate(() => window.monaco ? window.monaco.editor.getModelMarkers({ owner: 'lsp' }).map(m => m.startLineNumber + ': ' + m.message.slice(0, 80)) : []); if (markers.length) break; }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '21-lsp-diagnostics.png') });
  console.log('[lsp]', JSON.stringify({ markers, status: await page.evaluate(() => document.body.innerText.match(/LSP:[^\n]*/)?.[0]) }));
  await app.close();
})();

// Opens a file in the built-in editor, edits, saves with Ctrl+S, checks disk and diagnostics markers.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs'); const { spawnSync } = require('child_process');
(async () => {
  const proj = '/tmp/cc-editor-' + Date.now(); fs.mkdirSync(proj); spawnSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'main.js'), 'function hello(name) {\n  return "hi " + name;\n}\nconst x = ;\n');
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj] });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(7000);
  await page.click('text=main.js'); await page.waitForTimeout(5000);
  const hasMonaco = await page.evaluate(() => !!(window.monaco && document.querySelector('.monaco-editor')));
  await page.click('.monaco-editor .view-lines'); await page.keyboard.press('Control+Home');
  await page.keyboard.type('// edited in Cordoval Code\n');
  await page.keyboard.press('Control+s'); await page.waitForTimeout(2500);
  const saved = fs.readFileSync(path.join(proj, 'main.js'), 'utf8').startsWith('// edited in Cordoval Code');
  const markers = await page.evaluate(() => window.monaco ? window.monaco.editor.getModelMarkers({}).length : -1);
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '14-editor.png') });
  console.log('[editor]', JSON.stringify({ hasMonaco, saved, markers }));
  await app.close();
})();

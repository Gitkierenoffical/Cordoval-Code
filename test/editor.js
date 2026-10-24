// Opens a file in the built-in editor, edits, saves with Ctrl+S and checks the disk.
const L = require('./lib');
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
(async () => {
  const proj = L.tmp('editor'); spawnSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'main.js'), 'function hello(name) {\n  return "hi " + name;\n}\nconst x = ;\n');
  const { app, page } = await L.launch(proj);
  await page.click('text=main.js'); await page.waitForTimeout(4000);
  const hasMonaco = await page.evaluate(() => !!(window.monaco && document.querySelector('.monaco-editor')));
  await page.click('.monaco-editor .view-lines'); await page.keyboard.press('Control+Home');
  await page.keyboard.type('// edited in Cordoval Code\n');
  await page.keyboard.press('Control+s'); await page.waitForTimeout(2000);
  const saved = fs.readFileSync(path.join(proj, 'main.js'), 'utf8').startsWith('// edited in Cordoval Code');
  const markers = await page.evaluate(() => window.monaco ? window.monaco.editor.getModelMarkers({}).length : -1);
  await L.shot(page, '14-editor.png');
  await app.close();
  L.report('editor', { hasMonaco, saved }, { markers });
})().catch(e => { console.error(e); process.exit(1); });

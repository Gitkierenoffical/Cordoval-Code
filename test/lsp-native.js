// LANG=go|rust|kotlin: opens a file with an error and waits for native LSP markers (fetched on first use).
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
const L = process.env.LANG_ID || 'go';
const CASES = {
  go: { files: { 'go.mod': 'module demo\n\ngo 1.21\n', 'main.go': 'package main\n\nfunc main() {\n\tvar x int = "text"\n\t_ = x\n}\n' }, open: 'main.go' },
  rust: { files: { 'Cargo.toml': '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n', 'src/main.rs': 'fn main() {\n    let x: i32 = "text";\n    println!("{}", x);\n}\n' }, open: 'main.rs', dir: 'src' },
  kotlin: { files: { 'settings.gradle.kts': 'rootProject.name = "demo"\n', 'Main.kt': 'fun main() {\n    val x: Int = "text"\n    println(x)\n}\n' }, open: 'Main.kt' },
};
(async () => {
  const c = CASES[L]; const proj = '/tmp/cc-lsp-' + L + '-' + Date.now();
  for (const [f, t] of Object.entries(c.files)) { fs.mkdirSync(path.dirname(path.join(proj, f)), { recursive: true }); fs.writeFileSync(path.join(proj, f), t); }
  const app = await electron.launch({ executablePath: process.env.EXE || require('electron'), args: [process.env.EXE ? '' : path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj].filter(Boolean) });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(7000);
  if (c.dir) await page.evaluate((p) => window.CodeEditor.open(p), c.dir + '/' + c.open);
  else await page.click('text=' + c.open);
  let markers = []; const t0 = Date.now(); let st = '';
  while (Date.now() - t0 < (Number(process.env.WAIT_MS) || 300000)) {
    await page.waitForTimeout(3000);
    markers = await page.evaluate(() => window.monaco ? window.monaco.editor.getModelMarkers({ owner: 'lsp' }).map(m => m.startLineNumber + ': ' + m.message.slice(0, 90)) : []);
    st = await page.evaluate(() => (document.getElementById('editor-status') || {}).textContent || '');
    if (markers.length) break;
  }
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '22-lsp-' + L + '.png') });
  console.log('[lsp-' + L + ']', JSON.stringify({ secs: Math.round((Date.now() - t0) / 1000), markers, status: st }));
  await app.close();
})();

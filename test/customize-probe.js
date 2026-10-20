const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-cust-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj] });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(6000);
  for (const t of ['mcp', 'agents', 'commands', 'permissions']) {
    await page.evaluate((t) => window.Customize.open(t), t); await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/probe-' + t + '.png' });
  }
  console.log(await page.evaluate(() => Array.from(document.querySelectorAll('#customize-backdrop button')).map(b => b.textContent.trim()).filter(Boolean).slice(0, 60).join(' | ')));
  await app.close();
})();

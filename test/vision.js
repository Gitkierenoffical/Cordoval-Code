// Attach an image with a text-only model, expect warning + working switch button.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-vision-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj] });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(7000);
  await page.selectOption('#model-picker', 'opencode/nemotron-3.5-lightning-free');
  await page.setInputFiles('#attach-input', '/tmp/test-image.png'); await page.waitForTimeout(800);
  const r = { warning: await page.isVisible('#vision-warning'), text: await page.textContent('#vision-warning').catch(() => '') };
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '18-vision-warning.png') });
  await page.click('#btn-vision-switch'); await page.waitForTimeout(500);
  r.after = await page.$eval('#model-picker', s => s.value); r.hidden = !(await page.isVisible('#vision-warning'));
  console.log('[vision]', JSON.stringify(r)); await app.close();
})();

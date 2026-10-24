// Running dot on a background project tab while its agent works.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const a = '/tmp/cc-dotA-' + Date.now(), b = '/tmp/cc-dotB-' + Date.now(); fs.mkdirSync(a); fs.mkdirSync(b);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + a], env: { ...process.env, CORDOVAL_MOCK_PROVIDER: '1', CORDOVAL_USER_DATA: '/tmp/cc-ud-dot-' + Date.now() } });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await app.evaluate(({ dialog }, b) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [b] }); }, b);
  await page.waitForTimeout(6000);
  await page.fill('#composer-input', 'Write a 400 word essay about tides. Do not use tools.'); await page.keyboard.press('Enter');
  await page.waitForSelector('#btn-stop', { state: 'visible', timeout: 30000 });
  await page.click('#btn-tab-new'); await page.waitForTimeout(3500);
  const r = { dotOnA: await page.locator('.project-tab[data-dir="' + a + '"] .project-tab-dot.is-busy').count(), dotOnB: await page.locator('.project-tab[data-dir="' + b + '"] .project-tab-dot.is-busy').count() };
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '52-tab-running-dot.png') });
  for (let i = 0; i < 60 && (await page.locator('.project-tab-dot.is-busy').count()); i++) await page.waitForTimeout(2000);
  r.clearedAfter = (await page.locator('.project-tab-dot.is-busy').count()) === 0;
  await app.close(); require('./lib').report('tab-dot', { dotOnBackgroundTab: r.dotOnA === 1, noDotOnActive: r.dotOnB === 0, dotClears: r.clearedAfter }, r);
})();

// Points Settings > Updates at a local feed advertising a newer version and checks the UI reports it.
const { _electron: electron } = require('playwright-core');
const path = require('path');
(async () => {
  const app = await electron.launch({ executablePath: process.env.EXE, args: ['--no-sandbox'], env: { ...process.env } });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(6000);
  await page.click('#btn-welcome-settings'); await page.click('.modal-tab[data-stab="updates"]');
  const before = await page.textContent('#update-status');
  await page.check('#updates-enabled'); await page.fill('#update-feed', process.env.FEED || 'http://127.0.0.1:8765');
  await page.click('#btn-update-check');
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); const t = await page.textContent('#update-status'); if (/available|latest|error/i.test(t)) break; }
  const after = await page.textContent('#update-status');
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '23-updates.png') });
  await page.uncheck('#updates-enabled'); await page.fill('#update-feed', ''); await page.click('#btn-update-save');
  console.log('[updater]', JSON.stringify({ before, after, version: await page.textContent('#app-version'), downloadShown: await page.isVisible('#btn-update-download') }));
  await app.close();
})();

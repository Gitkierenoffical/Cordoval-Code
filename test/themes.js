// Theme family picker: switch families in both modes, take screenshots, check persistence.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
const shots = path.join(__dirname, '..', 'screenshots');
(async () => {
  const proj = '/tmp/cc-themes-' + Date.now(); fs.mkdirSync(proj); fs.writeFileSync(proj + '/a.js', 'const x = 1;\n');
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_MOCK_PROVIDER: '1', CORDOVAL_USER_DATA: '/tmp/cc-ud-th-' + Date.now() } });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(6000);
  const r = { count: await page.evaluate(() => window.Themes.list().length) };
  await page.evaluate(() => window.CordovalApp.openSettings());
  await page.click('.modal-tab[data-stab="appearance"]'); await page.waitForTimeout(500);
  r.picker = await page.locator('.theme-option').count();
  await page.click('.theme-option[data-theme="nord"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '30-theme-picker.png') });
  await page.keyboard.press('Escape'); await page.evaluate(() => { const c = document.querySelector('.modal-backdrop:not([hidden]) [data-close], #btn-settings-close'); if (c) c.click(); });
  for (const [id, mode, n] of [['tokyonight', 'dark', '31-theme-tokyonight'], ['gruvbox', 'light', '32-theme-gruvbox-light'], ['catppuccin', 'dark', '33-theme-catppuccin']]) {
    await page.evaluate(([i, m]) => { window.CordovalApp.applyTheme(m); window.Themes.set(i); }, [id, mode]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, n + '.png') });
  }
  r.bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg'));
  await page.evaluate(() => window.Themes.set('cordoval'));
  r.reset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  await app.close(); require('./lib').report('themes', { themes: r.count >= 30, pickerListsAll: r.picker === r.count, themeApplies: !!r.bg && r.bg !== r.reset, resetWorks: !!r.reset }, r);
})();

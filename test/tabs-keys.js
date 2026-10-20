// Project tabs in the title bar, and rebinding a shortcut.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
const shots = path.join(__dirname, '..', 'screenshots');
(async () => {
  const a = '/tmp/cc-tabA-' + Date.now(), b = '/tmp/cc-tabB-' + Date.now();
  fs.mkdirSync(a); fs.mkdirSync(b); fs.writeFileSync(a + '/alpha.txt', 'a'); fs.writeFileSync(b + '/beta.txt', 'b');
  const ud = '/tmp/cc-ud-tabs-' + Date.now();
  const launch = () => electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + a], env: { ...process.env, CORDOVAL_USER_DATA: ud } });
  let app = await launch();
  let page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await app.evaluate(({ dialog }, b) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [b] }); }, b);
  await page.waitForTimeout(6000);
  const r = {};
  await page.click('#btn-tab-new'); await page.waitForTimeout(3000);
  r.tabs = await page.locator('.project-tab').count();
  r.activeB = (await page.evaluate(() => window.CordovalApp.directory())) === b;
  r.filesB = (await page.textContent('#view-files')).includes('beta.txt');
  await page.screenshot({ path: path.join(shots, '50-project-tabs.png') });
  await page.keyboard.press('Control+Tab'); await page.waitForTimeout(2500);
  r.ctrlTabToA = (await page.evaluate(() => window.CordovalApp.directory())) === a;
  r.filesA = (await page.textContent('#view-files')).includes('alpha.txt');
  // rebind "Toggle terminal" to Ctrl+Shift+Y
  await page.keyboard.press('Control+/'); await page.waitForTimeout(400);
  await page.click('.shortcut-row[data-command="terminal.toggle"] .shortcut-keys');
  await page.keyboard.press('Control+Shift+Y'); await page.waitForTimeout(300);
  r.shown = await page.textContent('.shortcut-row[data-command="terminal.toggle"] .shortcut-keys');
  await page.screenshot({ path: path.join(shots, '51-rebind-shortcut.png') });
  await page.click('#btn-shortcuts-close');
  await page.keyboard.press('Control+Shift+Y'); await page.waitForTimeout(1000);
  r.newKeyWorks = await page.evaluate(() => !document.getElementById('terminal-dock').hidden);
  await page.keyboard.press('Control+`'); await page.waitForTimeout(600);
  r.oldKeyInert = await page.evaluate(() => !document.getElementById('terminal-dock').hidden);
  await app.close();
  // persists across restart, tabs too
  app = await launch(); page = await app.firstWindow(); await page.waitForTimeout(6000);
  r.persistTabs = await page.locator('.project-tab').count();
  r.persistKey = await page.evaluate(() => window.Palette.commands.find(c => c.id === 'terminal.toggle').keys.join(','));
  await page.click('.project-tab[data-dir="' + b + '"] .project-tab-close'); await page.waitForTimeout(800);
  r.afterClose = await page.locator('.project-tab').count();
  console.log('[tabs-keys]', JSON.stringify(r)); await app.close();
})();

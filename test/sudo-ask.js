// Default permissions: sudo commands ask first on a fresh profile.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-sudo-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_USER_DATA: '/tmp/cc-ud-sudo-' + Date.now() } });
  const page = await app.firstWindow();
  await page.waitForTimeout(6000);
  const r = { seeded: JSON.stringify((await page.evaluate(() => window.cordoval.getEngineConfig())).permission) };
  await page.fill('#composer-input', 'Run exactly this shell command with your bash tool: sudo -n true'); await page.keyboard.press('Enter');
  for (let i = 0; i < 45; i++) { await page.waitForTimeout(2000); if (await page.$('.permission-card')) { r.asked = true; break; } }
  r.cardText = r.asked ? (await page.textContent('.permission-card')).slice(0, 120) : '';
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '53-sudo-asks.png') });
  console.log('[sudo]', JSON.stringify(r)); await app.close();
})();

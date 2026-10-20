// Reasoning effort picker: lists the model's variants and sends the chosen one.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-var-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_USER_DATA: '/tmp/cc-ud-var-' + Date.now() } });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(6000);
  const r = {};
  await page.selectOption('#model-picker', 'opencode/nemotron-3.5-lightning-free'); await page.waitForTimeout(200);
  r.hiddenForNoVariants = !(await page.isVisible('#variant-picker'));
  await page.selectOption('#model-picker', 'opencode/glm-5.3-flash-free'); await page.waitForTimeout(200);
  r.options = await page.$$eval('#variant-picker option', o => o.map(x => x.textContent));
  await page.selectOption('#variant-picker', 'high');
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '48-reasoning-effort.png') });
  await page.fill('#composer-input', 'Reply with OK.'); await page.keyboard.press('Enter');
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(2000); const m = await page.evaluate(async () => window.Api.getMessages(window.CordovalApp.sessionId())); const a = m.filter(x => x.info.role === 'assistant').pop(); if (a && a.info.time.completed) { r.userVariant = m[0].info.variant || (m[0].info.model && m[0].info.model.variant); r.asstVariant = a.info.variant; r.ok = !a.info.error; break; } }
  r.persisted = await page.evaluate(() => document.getElementById('variant-picker').value);
  console.log('[variant]', JSON.stringify(r)); await app.close();
})();

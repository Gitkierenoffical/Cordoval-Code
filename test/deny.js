// Permissions: with edit denied, the agent must not be able to create a file.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-deny-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_USER_DATA: '/tmp/cc-ud-deny-' + Date.now() } });
  const page = await app.firstWindow();
  await page.waitForTimeout(6000);
  const cfg = await page.evaluate(() => window.cordoval.getEngineConfig());
  cfg.permission = { edit: 'deny', bash: 'deny' };
  await page.evaluate((c) => window.CordovalApp.saveEngineConfig(c), cfg);
  await page.waitForTimeout(1500);
  await page.fill('#composer-input', 'Create a file named blocked.txt containing the word hi using your write tool. Then say DONE.');
  await page.keyboard.press('Enter');
  let r = {};
  for (let i = 0; i < 90; i++) { await page.waitForTimeout(2000); const m = await page.evaluate(async () => window.Api.getMessages(window.CordovalApp.sessionId())); const a = m.filter(x => x.info.role === 'assistant'); if (a.length && a[a.length - 1].info.time.completed && !(await page.isVisible('#btn-stop'))) { r.tools = a.flatMap(x => x.parts.filter(p => p.type === 'tool').map(p => p.tool + ':' + p.state.status)); r.text = a.flatMap(x => x.parts.filter(p => p.type === 'text').map(p => p.text)).join(' ').slice(0, 200); break; } }
  r.fileExists = fs.existsSync(proj + '/blocked.txt');
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '45-permission-denied.png') });
  console.log('[deny]', JSON.stringify(r)); await app.close();
})();

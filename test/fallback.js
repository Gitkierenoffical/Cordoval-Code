// Simulates a free-model refusal and checks the app switches to another free model and continues.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-fb-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj] });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await page.waitForTimeout(7000);
  await page.fill('#composer-input', 'Reply with the single word READY.'); await page.press('#composer-input', 'Enter');
  await page.waitForTimeout(1500);
  const sid = await page.evaluate(async () => { const l = await (await fetch(window.Api.engineUrl() + '/session?directory=' + encodeURIComponent(window.CordovalApp.directory()))).json(); return l[0].id; });
  await page.evaluate((sid) => window.CordovalApp._handleEvent({ type: 'session.error', properties: { sessionID: sid, error: { data: { message: "OpenCode's free models aren't available from your current network" } } } }), sid);
  await page.waitForTimeout(1000);
  const picked = await page.$eval('#model-picker', s => s.value);
  for (let i = 0; i < 40 && await page.isVisible('#btn-stop'); i++) await page.waitForTimeout(1500);
  await page.waitForTimeout(3000);
  const msgs = await page.evaluate(async (sid) => (await (await fetch(window.Api.engineUrl() + '/session/' + sid + '/message?directory=' + encodeURIComponent(window.CordovalApp.directory()))).json()).map(m => m.info.role + ':' + (m.info.modelID || '')), sid);
  console.log('[fallback]', JSON.stringify({ picked, msgs }));
  await app.close();
})();

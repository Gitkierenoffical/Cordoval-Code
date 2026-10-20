// Customise changes apply without an engine restart, and wait for a running session.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-live-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_USER_DATA: '/tmp/cc-ud-live-' + Date.now() } });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  page.on('dialog', d => d.accept());
  await page.waitForTimeout(6000);
  const r = {}; const url0 = await page.evaluate(() => window.Api.engineUrl());
  const agents = () => page.evaluate(async () => (await window.Api.request('/agent')).map(a => a.name));
  let cfg = await page.evaluate(() => window.cordoval.getEngineConfig());
  cfg.agent = { alpha: { description: 'a', mode: 'primary', prompt: 'Be brief.' } };
  r.mode1 = await page.evaluate((c) => window.CordovalApp.saveEngineConfig(c), cfg);
  r.added = (await agents()).includes('alpha');
  delete cfg.agent.alpha;
  r.mode2 = await page.evaluate((c) => window.CordovalApp.saveEngineConfig(c), cfg);
  r.removed = !(await agents()).includes('alpha');
  r.sameEngine = url0 === await page.evaluate(() => window.Api.engineUrl());
  // while busy
  await page.fill('#composer-input', 'Write a 300 word story about a lighthouse keeper. Do not use tools.');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#btn-stop', { state: 'visible', timeout: 30000 });
  cfg.agent = { beta: { description: 'b', mode: 'primary', prompt: 'Be brief.' } };
  r.mode3 = await page.evaluate((c) => window.CordovalApp.saveEngineConfig(c), cfg);
  r.notYet = !(await agents()).includes('beta');
  for (let i = 0; i < 120 && await page.isVisible('#btn-stop'); i++) await page.waitForTimeout(1000);
  await page.waitForTimeout(2500);
  const m = await page.evaluate(async () => window.Api.getMessages(window.CordovalApp.sessionId()));
  const a = m.filter(x => x.info.role === 'assistant').pop();
  r.sessionFinished = !!(a && a.info.time.completed && !a.info.error);
  r.storyWords = a ? a.parts.filter(p => p.type === 'text').map(p => p.text).join(' ').split(/\s+/).length : 0;
  r.appliedAfter = (await agents()).includes('beta');
  console.log('[live]', JSON.stringify(r)); await app.close();
})();

// Custom primary agent shows next to Build/Plan and is used for the next prompt.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-agents-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_MOCK_PROVIDER: '1', CORDOVAL_USER_DATA: '/tmp/cc-ud-ag-' + Date.now(), CORDOVAL_MOCK_PROVIDER: '1' } });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(6000);
  const cfg = await page.evaluate(() => window.cordoval.getEngineConfig());
  cfg.agent = { pirate: { description: 'Talks like a pirate', mode: 'primary', model: 'mock/scripted', prompt: 'Always answer in one short sentence that starts with the word Arr.' } };
  await page.evaluate((c) => window.CordovalApp.saveEngineConfig(c), cfg);
  await page.waitForTimeout(1500);
  const r = { button: await page.locator('.agent-btn[data-agent="pirate"]').count() };
  await page.click('.agent-btn[data-agent="pirate"]');
  r.active = await page.evaluate(() => window.CordovalApp.agent());
  await page.fill('#composer-input', 'Say hello.'); await page.keyboard.press('Enter');
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(2000); const m = await page.evaluate(async () => window.Api.getMessages(window.CordovalApp.sessionId())); const a = m.find(x => x.info.role === 'assistant' && x.info.time && x.info.time.completed); if (a) { r.msgAgent = a.info.agent || a.info.mode; r.text = a.parts.filter(p => p.type === 'text').map(p => p.text).join(' ').slice(0, 120); break; } }
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '44-custom-agent.png') });
  await app.close(); require('./lib').report('agents', { agentButton: r.button === 1, agentActive: r.active === 'pirate', messageUsesAgent: r.msgAgent === 'pirate', replied: !!r.text }, r);
})();

// Permissions: with edit denied, the agent must not be able to create a file.
const L = require('./lib');
const fs = require('fs');
(async () => {
  const proj = L.tmp('deny');
  const { app, page } = await L.launch(proj);
  const cfg = await page.evaluate(() => window.cordoval.getEngineConfig());
  cfg.permission = { edit: 'deny', bash: 'deny' };
  await page.evaluate((c) => window.CordovalApp.saveEngineConfig(c), cfg);
  await page.waitForTimeout(800);
  await L.send(page, 'Create a file named blocked.txt containing the word hi using your write tool. Then say DONE.');
  await L.waitIdle(page, 60000, false);
  const a = (await L.messages(page)).filter(x => x.info.role === 'assistant').pop();
  const tools = a.parts.filter(p => p.type === 'tool').map(p => p.tool + ':' + p.state.status);
  const r = { toolErrored: tools.includes('write:error'), fileMissing: !fs.existsSync(proj + '/blocked.txt'), finished: !!a.info.time.completed };
  await L.shot(page, '45-permission-denied.png');
  await app.close();
  L.report('deny', r, { tools });
})().catch(e => { console.error(e); process.exit(1); });

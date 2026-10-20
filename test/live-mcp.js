// MCP and permission changes apply without restarting the engine.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-lm-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_USER_DATA: '/tmp/cc-ud-lm-' + Date.now() } });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await page.waitForTimeout(6000);
  const save = (c) => page.evaluate((c) => window.CordovalApp.saveEngineConfig(c), c);
  const mcp = () => page.evaluate(() => window.Api.request('/mcp'));
  let cfg = await page.evaluate(() => window.cordoval.getEngineConfig());
  await save(cfg); // first save normalises the file
  const url0 = await page.evaluate(() => window.Api.engineUrl());
  const r = {};
  cfg.mcp = { echo: { type: 'local', command: ['node', '/tmp/mcp-echo.js'] } };
  r.add = await save(cfg); await page.waitForTimeout(1500); r.addStatus = ((await mcp()).echo || {}).status;
  cfg.mcp.echo.enabled = false; r.disable = await save(cfg); r.disStatus = ((await mcp()).echo || {}).status;
  cfg.mcp.echo.enabled = true; r.enable = await save(cfg); await page.waitForTimeout(1500); r.enStatus = ((await mcp()).echo || {}).status;
  cfg.permission = { webfetch: 'deny' }; r.perm = await save(cfg);
  r.permLive = await page.evaluate(async () => JSON.stringify((await window.Api.request('/config')).permission));
  delete cfg.mcp.echo; r.remove = await save(cfg); r.remStatus = ((await mcp()).echo || {}).status;
  r.sameEngine = url0 === await page.evaluate(() => window.Api.engineUrl());
  cfg.command = { zz: { template: 'x' } }; r.command = await save(cfg);
  console.log('[live-mcp]', JSON.stringify(r)); await app.close();
})();

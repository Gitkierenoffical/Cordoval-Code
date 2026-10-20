// Remote MCP server that requires OAuth: expect needs-auth status and a working Sign in start.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs');
(async () => {
  const proj = '/tmp/cc-auth-' + Date.now(); fs.mkdirSync(proj);
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_USER_DATA: '/tmp/cc-ud-auth-' + Date.now() } });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow, shell }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await page.waitForTimeout(6000);
  const cfg = await page.evaluate(() => window.cordoval.getEngineConfig());
  cfg.mcp = { secure: { type: 'remote', url: 'http://127.0.0.1:8765/mcp' } };
  await page.evaluate((c) => window.CordovalApp.saveEngineConfig(c), cfg);
  await page.waitForTimeout(4000);
  const r = { status: (await page.evaluate(() => window.Api.request('/mcp')))['secure'] };
  await page.evaluate(() => window.Customize.open('mcp')); await page.waitForTimeout(2500);
  r.signInButton = await page.locator('#customize-backdrop button', { hasText: /^Sign in$/ }).count();
  if (r.signInButton) { await page.locator('#customize-backdrop button', { hasText: /^Sign in$/ }).click(); await page.waitForTimeout(4000); }
  r.opened = (await page.evaluate(() => window.__opened)).concat(await app.evaluate(() => global.__opened)).map(u => String(u).slice(0, 90));
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '43-mcp-auth.png') });
  console.log('[mcp-auth]', JSON.stringify(r)); await app.close();
})();

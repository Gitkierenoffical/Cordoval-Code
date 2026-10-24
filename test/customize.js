// Customise panel end to end: MCP (local + remote, enable/disable, tools, remove),
// agents and commands (global config and project .cordoval files), permissions.
const L = require('./lib');
const path = require('path'); const fs = require('fs');
const shots = L.SHOTS;
const ECHO = 'node ' + path.join(__dirname, 'fixtures', 'mcp-echo.js');
(async () => {
  const proj = L.tmp('cust');
  const { app, page } = await L.launch(proj);
  page.on('dialog', d => d.accept());
  const cfgPath = await page.evaluate(() => window.cordoval.engineConfigPath());
  const cfg = () => JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const B = '#customize-backdrop ';
  const btn = (t) => page.locator(B + 'button', { hasText: new RegExp('^\\s*' + t + '\\s*$') });
  const field = (f) => page.locator(B + `[data-field^="${f}"]`).last();
  const saveForm = async () => { await page.locator(B + 'button', { hasText: /^\s*(Save|Create)\s*$/ }).last().click(); await page.waitForTimeout(2500); };
  const api = (p) => page.evaluate((p) => window.Api.request(p), p);
  const r = {};
  // --- MCP local
  await page.evaluate(() => window.Customize.open('mcp')); await page.waitForTimeout(800);
  await btn('Add server').click(); await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/cust-form.png' });
  await field('Name').fill('echo');
  await field('Command').fill(ECHO);
  await saveForm();
  r.cfgLocal = JSON.stringify(cfg().mcp && cfg().mcp.echo);
  const st = await api('/mcp'); r.status = st.echo && st.echo.status;
  await page.waitForTimeout(3000); r.mcpTool = (await page.textContent('#customize-backdrop')).includes('echo_say');
  // --- MCP remote (unreachable, should show failed)
  await btn('Add server').click(); await page.waitForTimeout(300);
  await field('Name').fill('remote-test');
  await field('Type').selectOption('remote'); await page.waitForTimeout(200);
  await field('URL').fill('http://127.0.0.1:9/mcp');
  await saveForm();
  r.remoteSaved = !!(cfg().mcp || {})['remote-test']; await page.waitForTimeout(3000); r.remoteChip = await page.evaluate(() => /remote-test[\s\S]*?failed/.test(document.querySelector('#customize-backdrop').textContent));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(shots, '38-mcp-servers.png') });
  // disable echo
  await page.locator(B + 'button', { hasText: /^Disable$/ }).first().click(); await page.waitForTimeout(2500);
  r.disabledCfg = cfg().mcp.echo.enabled === false; r.disabledStatus = ((await api('/mcp')).echo || {}).status;
  await page.locator(B + 'button', { hasText: /^Enable$/ }).first().click(); await page.waitForTimeout(2500);
  r.reenabled = ((await api('/mcp')).echo || {}).status;
  // remove remote: last Remove button belongs to remote-test (alphabetical or insertion)
  const rows = await page.locator(B + 'button', { hasText: /^Remove$/ }).count();
  await page.locator(B + 'button', { hasText: /^Remove$/ }).nth(rows - 1).click(); await page.waitForTimeout(2500);
  r.afterRemove = Object.keys(cfg().mcp || {});
  // --- Agents
  await page.click(B + '[data-tab="agents"], ' + B + 'button:has-text("Agents")'); await page.waitForTimeout(800);
  await btn('New agent').click(); await page.waitForTimeout(300);
  await field('Name').fill('reviewer');
  await field('Scope').selectOption('global');
  await field('Description').fill('Reviews code without editing');
  await field('Model').fill('mock/scripted').catch(async () => field('Model').selectOption('mock/scripted'));
  await field('Prompt').fill('You review code and never edit files.');
  await field('Permission for edit').selectOption('deny').catch(e => r.permEditErr = e.message.slice(0, 80));
  await page.screenshot({ path: path.join(shots, '39-agent-editor.png') });
  await saveForm();
  r.agentCfg = JSON.stringify(cfg().agent && cfg().agent.reviewer).slice(0, 200);
  r.agentLive = (await api('/agent')).some(a => a.name === 'reviewer');
  await btn('New agent').click(); await page.waitForTimeout(300);
  await field('Name').fill('docs');
  await field('Scope').selectOption('project');
  await field('Description').fill('Writes docs');
  await field('Prompt').fill('You write documentation.');
  await saveForm();
  const agentFile = [proj + '/.cordoval/agent/docs.md', proj + '/.cordoval/agents/docs.md'].find(f => fs.existsSync(f));
  r.projectAgentFile = agentFile ? fs.readFileSync(agentFile, 'utf8').slice(0, 160) : null;
  r.projectAgentLive = (await api('/agent')).some(a => a.name === 'docs');
  // --- Commands
  await page.click(B + 'button:has-text("Commands")'); await page.waitForTimeout(800);
  await btn('New command').click(); await page.waitForTimeout(300);
  await field('Name').fill('shout'); await field('Scope').selectOption('global'); await field('Description').fill('Shouts'); await field('Template').fill('Reply in capitals: $ARGUMENTS');
  await saveForm();
  r.cmdCfg = JSON.stringify(cfg().command && cfg().command.shout);
  await btn('New command').click(); await page.waitForTimeout(300);
  await field('Name').fill('hi'); await field('Scope').selectOption('project'); await field('Template').fill('Say hi to $1');
  await saveForm();
  r.cmdFile = [proj + '/.cordoval/command/hi.md', proj + '/.cordoval/commands/hi.md'].some(f => fs.existsSync(f));
  const cmds = (await api('/command')).map(c => c.name); r.cmdLive = cmds.includes('shout') && cmds.includes('hi');
  await page.screenshot({ path: path.join(shots, '40-commands.png') });
  // --- Permissions
  await page.click(B + 'button:has-text("Permissions")'); await page.waitForTimeout(800);
  const sels = page.locator(B + 'select');
  await sels.nth(0).selectOption({ label: 'Deny' }).catch(async () => sels.nth(0).selectOption('deny'));
  await sels.nth(1).selectOption({ label: 'Ask' }).catch(async () => sels.nth(1).selectOption('ask'));
  await btn('Add rule').click(); await page.waitForTimeout(200);
  const ruleInputs = page.locator(B + 'input[type="text"]');
  await ruleInputs.last().fill('git status');
  const allSel = page.locator(B + 'select'); await allSel.last().selectOption({ label: 'Allow' }).catch(async () => allSel.last().selectOption('allow'));
  await page.screenshot({ path: path.join(shots, '41-permissions.png') });
  await btn('Save permissions').click(); await page.waitForTimeout(2500);
  r.perm = JSON.stringify(cfg().permission);
  // agents list screenshot
  await page.click(B + 'button:has-text("Agents")'); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(shots, '42-agents.png') });
  await app.close();
  const perm = JSON.parse(r.perm || '{}');
  L.report('customize', {
    mcpLocalSaved: /mcp-echo\.js/.test(r.cfgLocal || ''), mcpConnected: r.status === 'connected', mcpToolListed: r.mcpTool,
    mcpRemoteSaved: r.remoteSaved, mcpRemoteFailed: r.remoteChip, mcpDisable: r.disabledCfg && r.disabledStatus === 'disabled', mcpReenable: r.reenabled === 'connected',
    mcpRemoved: JSON.stringify(r.afterRemove) === '["echo"]', agentGlobal: /review code/.test(r.agentCfg || '') && r.agentLive, agentProject: !!r.projectAgentFile && r.projectAgentLive,
    commandGlobal: /capitals/.test(r.cmdCfg || ''), commandProject: r.cmdFile, commandsLive: r.cmdLive,
    permissionsSaved: !!perm.bash && JSON.stringify(perm).includes('git status'),
  }, r);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

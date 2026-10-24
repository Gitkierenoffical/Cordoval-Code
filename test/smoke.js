// Smoke test: launch, chat with a tool call, changes diff, files and terminal, settings, dark theme.
// Set EXE to a packaged binary (for example the AppImage) to smoke-test a build.
const L = require('./lib');
const fs = require('fs');
const path = require('path');
(async () => {
  const proj = L.tmp('smoke');
  require('child_process').spawnSync('git', ['init', '-q'], { cwd: proj });
  const exe = process.env.EXE;
  const { app, page } = await L.launch(proj, exe ? { executablePath: exe, env: { APPIMAGE_EXTRACT_AND_RUN: '1' } } : {});
  const r = {};
  if (exe) r.version = (await page.evaluate(() => window.cordoval.appVersion())) === require('../package.json').version;
  await L.shot(page, '01-start.png');
  r.engineUp = !!(await page.evaluate(() => window.Api.engineUrl()));
  if (exe) {
    // Packaged build: L.launch sets CORDOVAL_MOCK_PROVIDER=1, yet the test provider must stay off.
    const prov = await page.evaluate(() => window.Api.request('/config/providers'));
    r.mockHookGated = !prov.providers.some(p => p.id === 'mock');
    r.noMockInPicker = !(await page.$('#model-picker option[value^="mock/"]'));
    await page.click('#btn-terminal-toggle'); await page.waitForTimeout(2500);
    await page.click('#terminal-host').catch(() => {}); await page.keyboard.type('echo pty-ok-$((40+2))\n'); await page.waitForTimeout(2000);
    r.terminal = (await page.textContent('#terminal-host')).includes('pty-ok-42');
    await page.click('#btn-settings'); await page.waitForTimeout(800);
    await page.click('.modal-tab[data-stab="permissions"]'); await page.waitForTimeout(800);
    r.permissionsPage = (await page.textContent('#settings-permissions')).includes('Always-allow rules');
    await L.shot(page, 'packaged-09.png');
    await app.close();
    return L.report('smoke-packaged', r);
  }
  await L.send(page, 'Create a file named index.html containing Hello from Cordoval Code.');
  r.idle = await L.waitIdle(page, 60000);
  r.file = fs.existsSync(path.join(proj, 'index.html')) && fs.readFileSync(path.join(proj, 'index.html'), 'utf8').includes('Hello from Cordoval Code');
  r.toolCard = (await page.locator('.tool-card .tool-name', { hasText: 'write' }).count()) > 0;
  await L.shot(page, '03-chat-done.png');
  await page.click('.right-tab[data-tab="changes"]'); await page.waitForTimeout(1500);
  r.diff = (await page.textContent('#changes-list')).includes('index.html');
  await L.shot(page, '04-changes-diff.png');
  await page.click('.right-tab[data-tab="files"]'); await page.click('#btn-files-refresh'); await page.waitForTimeout(800);
  r.tree = (await page.textContent('#file-tree')).includes('index.html');
  await page.click('#btn-terminal-toggle'); await page.waitForTimeout(2500);
  await page.click('#terminal-host').catch(() => {}); await page.keyboard.type('ls -la\n'); await page.waitForTimeout(2000);
  r.terminal = (await page.textContent('#terminal-host')).includes('index.html');
  await L.shot(page, '05-files-terminal.png');
  await page.click('#btn-settings'); await page.waitForTimeout(1000);
  r.settings = (await page.textContent('#settings-providers')).includes('OpenRouter');
  await L.shot(page, '06-settings.png');
  await page.click('#btn-settings-close');
  await page.click('#btn-theme'); await page.waitForTimeout(500);
  r.dark = (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark';
  await L.shot(page, '07-dark.png');
  await page.click('#btn-theme');
  await app.close();
  L.report(exe ? 'smoke (packaged)' : 'smoke', r);
})().catch(e => { console.error(e); process.exit(1); });

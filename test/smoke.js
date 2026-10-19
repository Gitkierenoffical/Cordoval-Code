// Smoke test: launches Cordoval Code, opens a project, screenshots, sends a prompt to a free model.
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const shots = path.join(__dirname, '..', 'screenshots');
const proj = process.env.SMOKE_DIR || ('/tmp/cordoval-smoke-' + Date.now());
fs.rmSync(proj, { recursive: true, force: true }); fs.mkdirSync(proj, { recursive: true }); if (!process.env.NO_GIT) require('child_process').spawnSync('git', ['init', '-q'], { cwd: proj });
const shot = (p, n) => p.screenshot({ path: path.join(shots, n) }).then(() => console.log('shot', n));
(async () => {
  const app = await electron.launch({ recordVideo: undefined,
    executablePath: require('electron'),
    args: [path.join(__dirname, '..'), '--no-sandbox', process.env.NO_PROJECT ? '' : '--project=' + proj].filter(Boolean),
    env: { ...process.env, CORDOVAL_USER_DATA: process.env.CORDOVAL_USER_DATA || '' },
  });
  const page = await app.firstWindow();
  page.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text()); });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); });
  await page.waitForTimeout(8000);
  await shot(page, (process.env.PREFIX || '') + '01-start.png');
  const step = process.env.STEP || 'all';
  if (step === 'start') { await app.close(); return; }
  const prompt = process.env.PROMPT || 'Create a tiny static web project here: index.html with a heading "Hello from Cordoval Code", style.css with a lavender background, and app.js that logs "ready". Keep it short.';
  if (process.env.MODEL) await page.waitForSelector('#model-picker option[value="' + process.env.MODEL + '"]', { state: 'attached', timeout: 30000 }).catch(() => console.log('model option missing'));
  if (process.env.MODEL) await page.selectOption('#model-picker', process.env.MODEL).catch(e => console.log('model select failed', e.message));
  await page.fill('#composer-input', prompt);
  await page.press('#composer-input', 'Enter');
  await page.waitForTimeout(6000);
  await shot(page, '02-streaming.png');
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    // approve any permission request automatically for the smoke test
    const allow = await page.$('#permission-host button, .permission-card button');
    if (allow) { await allow.click().catch(() => {}); }
    if (fs.existsSync(path.join(proj, 'index.html')) && fs.existsSync(path.join(proj, 'app.js')) && !(await page.isVisible('#btn-stop'))) break;
    await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(3000);
  await shot(page, '03-chat-done.png');
  await page.click('.right-tab[data-tab="changes"]'); await page.waitForTimeout(2500);
  await shot(page, '04-changes-diff.png');
  await page.click('.right-tab[data-tab="files"]'); await page.click('#btn-files-refresh'); await page.waitForTimeout(2000);
  await page.click('#btn-terminal-toggle'); await page.waitForTimeout(3000);
  await page.click('#terminal-host').catch(()=>{}); await page.keyboard.type('ls -la\n'); await page.waitForTimeout(2000);
  await shot(page, '05-files-terminal.png');
  await page.click('#btn-settings'); await page.waitForTimeout(1500);
  await shot(page, '06-settings.png');
  await page.click('#btn-settings-close');
  await page.click('#btn-theme'); await page.waitForTimeout(1000);
  await shot(page, '07-dark.png');
  await page.click('#btn-theme');
  console.log('files', fs.readdirSync(proj));
  fs.writeFileSync('/tmp/smoke-dom.html', await page.content());
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });

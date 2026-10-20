// Per-line review comments on the diff, sent to the agent as one message.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const shots = path.join(__dirname, '..', 'screenshots');
(async () => {
  const proj = '/tmp/cc-rev-' + Date.now(); fs.mkdirSync(proj);
  fs.writeFileSync(proj + '/app.js', 'function add(a, b) {\n  return a + b;\n}\n');
  execSync('git init -q && git add . && git -c user.email=t@t -c user.name=t commit -qm init', { cwd: proj });
  fs.writeFileSync(proj + '/app.js', 'function add(a, b) {\n  return a - b;\n}\nconsole.log(add(1, 2));\n');
  const ud = '/tmp/cc-ud-rev-' + Date.now();
  let app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_USER_DATA: ud } });
  let page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(6000);
  const r = {};
  await page.click('.right-tab[data-tab="changes"]'); await page.waitForTimeout(2500);
  const row = page.locator('.diff-line.add', { hasText: 'a - b' }).first();
  r.lineNo = await row.getAttribute('data-line');
  await row.hover(); await row.locator('.diff-comment-btn').click();
  await page.fill('.diff-comment-editor textarea', 'This should add, not subtract.');
  await page.click('.diff-comment-editor .btn-primary'); await page.waitForTimeout(1500);
  r.thread = await page.locator('.diff-comment').count();
  r.bar = await page.textContent('#review-count');
  await page.screenshot({ path: path.join(shots, '49-review-comments.png') });
  r.message = await page.evaluate(() => window.ReviewComments.message());
  // restart: comment must still be there
  const sid = await page.evaluate(() => window.CordovalApp.sessionId());
  await app.close();
  app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj], env: { ...process.env, CORDOVAL_USER_DATA: ud } });
  page = await app.firstWindow(); await page.waitForTimeout(6000);
  await page.evaluate((sid) => window.CordovalApp.selectSession(sid), sid); await page.waitForTimeout(800);
  await page.click('.right-tab[data-tab="changes"]'); await page.waitForTimeout(2500);
  r.afterRestart = await page.locator('.diff-comment').count();
  await page.click('#btn-review-send');
  for (let i = 0; i < 90; i++) { await page.waitForTimeout(2000); const m = await page.evaluate(async () => window.Api.getMessages(window.CordovalApp.sessionId())); const a = m.filter(x => x.info.role === 'assistant').pop(); if (a && a.info.time.completed && !(await page.isVisible('#btn-stop'))) break; }
  r.fixed = fs.readFileSync(proj + '/app.js', 'utf8').includes('a + b');
  r.barHidden = await page.evaluate(() => document.getElementById('review-bar').hidden);
  console.log('[review]', JSON.stringify(r)); await app.close();
})();

// Create a worktree from the sidebar, check it opens, then remove it.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs'); const { spawnSync } = require('child_process');
(async () => {
  const proj = '/tmp/cc-wt-' + Date.now(); fs.mkdirSync(proj); fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  for (const a of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) spawnSync('git', a, { cwd: proj });
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj] });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  page.on('dialog', d => d.accept());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(7000);
  const r = {};
  await page.click('#btn-new-worktree'); await page.waitForTimeout(8000);
  r.dir = await page.evaluate(() => window.CordovalApp.directory());
  r.switched = r.dir !== proj && fs.existsSync(path.join(r.dir, 'a.txt'));
  r.rows = await page.$$eval('.worktree-item', e => e.map(x => x.textContent));
  r.gitList = spawnSync('git', ['worktree', 'list'], { cwd: proj }).stdout.toString().trim().split('\n').length;
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', '19-worktrees.png') });
  await page.hover('.worktree-item.is-active'); await page.click('.worktree-item.is-active .worktree-remove'); await page.waitForTimeout(5000);
  r.back = (await page.evaluate(() => window.CordovalApp.directory())) === proj;
  r.removed = !fs.existsSync(r.dir);
  console.log('[worktree]', JSON.stringify(r)); await app.close();
})();

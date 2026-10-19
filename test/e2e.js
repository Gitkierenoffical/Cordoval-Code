// End-to-end checks. Usage: STEPS=model,plan,stop,revert,search,templates xvfb-run -a node test/e2e.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const shots = path.join(__dirname, '..', 'screenshots');
const STEPS = (process.env.STEPS || 'model,plan,stop,revert,search').split(',');
const ALT = process.env.ALT_MODEL || 'opencode/deepseek-v4.1-flash-free';
const results = {};
const log = (...a) => console.log('[e2e]', ...a);

async function launch(proj) {
  const args = [path.join(__dirname, '..'), '--no-sandbox'];
  if (proj) args.push('--project=' + proj);
  const app = await electron.launch({ executablePath: require('electron'), args });
  const page = await app.firstWindow();
  page.on('pageerror', e => log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(7000);
  return { app, page };
}
const engine = page => page.evaluate(() => window.Api && window.Api.engineUrl());
async function api(page, p) {
  return page.evaluate(async (p) => { const r = await fetch(window.Api.engineUrl() + p); return r.json(); }, p);
}
async function sid(page) { return page.evaluate(() => document.querySelector('.session-item.is-active, .session.is-active, [aria-current="true"]')?.dataset?.id || null); }
async function send(page, text) { await page.fill('#composer-input', text); await page.press('#composer-input', 'Enter'); }
async function waitIdle(page, ms = 240000) {
  const t0 = Date.now();
  await page.waitForTimeout(2500);
  while (Date.now() - t0 < ms) {
    const btn = await page.$('.permission-card button');
    if (btn) await btn.click().catch(() => {});
    if (!(await page.isVisible('#btn-stop'))) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}
async function messages(page, dir) {
  const list = await api(page, '/session?directory=' + encodeURIComponent(dir));
  const s = list.sort((a, b) => b.time.updated - a.time.updated)[0];
  return { s, msgs: await api(page, '/session/' + s.id + '/message?directory=' + encodeURIComponent(dir)) };
}

(async () => {
  const proj = '/tmp/cc-e2e-' + Date.now();
  fs.mkdirSync(proj); spawnSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'alpha line\nbeta needle line\n');
  spawnSync('git', ['add', '.'], { cwd: proj }); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: proj });
  const { app, page } = await launch(proj);
  try {
    if (STEPS.includes('model')) {
      const opts = await page.$$eval('#model-picker option', os => os.map(o => o.value + '|' + o.textContent));
      log('model options', opts.length, opts.slice(0, 6));
      await page.selectOption('#model-picker', ALT);
      await send(page, 'Reply with the single word PONG.');
      await waitIdle(page);
      const { msgs } = await messages(page, proj);
      const a = msgs.filter(m => m.info.role === 'assistant').pop();
      results.model = a && a.info.modelID === ALT.split('/')[1] ? 'pass' : 'fail:' + (a && a.info.modelID);
      await page.screenshot({ path: path.join(shots, '10-model-picker.png') });
    }
    if (STEPS.includes('plan')) {
      await page.click('#btn-agent-plan');
      await send(page, 'Plan only: how would you add a README.md here? Do not edit files.');
      await waitIdle(page);
      const { msgs } = await messages(page, proj);
      const a = msgs.filter(m => m.info.role === 'assistant').pop();
      results.plan = a && (a.info.agent === 'plan' || a.info.mode === 'plan') && !fs.existsSync(path.join(proj, 'README.md')) ? 'pass' : 'fail:' + (a && a.info.agent);
      await page.screenshot({ path: path.join(shots, '11-plan-mode.png') });
      await page.click('#btn-agent-build');
    }
    if (STEPS.includes('stop')) {
      await send(page, 'Write a 2000 word essay about the history of compilers.');
      await page.waitForSelector('#btn-stop', { state: 'visible', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);
      await page.click('#btn-stop').catch(e => log('stop click', e.message));
      const ok = await waitIdle(page, 30000);
      results.stop = ok ? 'pass' : 'fail';
    }
    if (STEPS.includes('revert')) {
      await send(page, 'Create a file called revert-me.txt containing the word hello. Use the write tool.');
      await waitIdle(page);
      const created = fs.existsSync(path.join(proj, 'revert-me.txt'));
      const btns = await page.$$('text=Revert to here');
      await btns[btns.length - 1].click();
      await page.waitForTimeout(4000);
      const gone = !fs.existsSync(path.join(proj, 'revert-me.txt'));
      const banner = await page.isVisible('#revert-banner');
      await page.screenshot({ path: path.join(shots, '12-reverted.png') });
      await page.click('#btn-unrevert').catch(() => {});
      await page.waitForTimeout(4000);
      const back = fs.existsSync(path.join(proj, 'revert-me.txt'));
      results.revert = `created=${created} removed=${gone} banner=${banner} restored=${back}`;
    }
    if (STEPS.includes('search')) {
      await page.click('.right-tab[data-tab="search"]');
      await page.fill('#search-input', 'needle');
      await page.press('#search-input', 'Enter');
      await page.waitForTimeout(2500);
      const txt = await page.textContent('#search-results');
      results.search = /notes\.txt/.test(txt) ? 'pass' : 'fail:' + txt.slice(0, 120);
      await page.screenshot({ path: path.join(shots, '13-search.png') });
    }
  } catch (e) { log('error', e.message); }
  log('RESULTS', JSON.stringify(results));
  await app.close();
})();

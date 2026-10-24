// End to end: model switch, Plan is read-only, Stop, revert/unrevert, project search.
const L = require('./lib');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ALT = process.env.ALT_MODEL || 'mock/scripted-alt';
(async () => {
  const proj = L.tmp('e2e');
  spawnSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'alpha line\nbeta needle line\n');
  spawnSync('git', ['add', '.'], { cwd: proj }); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: proj });
  const { app, page } = await L.launch(proj);
  const r = {};
  const last = async () => (await L.messages(page)).filter(m => m.info.role === 'assistant').pop();
  // model
  await page.selectOption('#model-picker', ALT);
  await L.send(page, 'Reply with exactly the single word PONG.');
  await L.waitIdle(page);
  let a = await last();
  r.model = !!a && a.info.modelID === ALT.split('/').slice(1).join('/') && a.parts.some(p => p.type === 'text' && /PONG/.test(p.text));
  await L.shot(page, '10-model-picker.png');
  // plan
  await page.click('#btn-agent-plan');
  await L.send(page, 'Plan only: how would you add a README.md here? Do not edit files.');
  await L.waitIdle(page);
  a = await last();
  r.plan = !!a && a.info.agent === 'plan' && !fs.existsSync(path.join(proj, 'README.md'));
  await L.shot(page, '11-plan-mode.png');
  await page.click('#btn-agent-build');
  // stop
  await L.send(page, 'Write a 2000 word essay about the history of compilers.');
  await page.waitForSelector('#btn-stop', { state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.click('#btn-stop');
  r.stop = await L.waitIdle(page, 10000);
  a = await last();
  r.stopRecorded = !!a && a.info.error && a.info.error.name === 'MessageAbortedError';
  // revert
  await L.send(page, 'Create a file called revert-me.txt containing the word hello. Use the write tool.');
  await L.waitIdle(page);
  r.created = fs.existsSync(path.join(proj, 'revert-me.txt'));
  const btns = await page.$$('text=Revert to here');
  await btns[btns.length - 1].click();
  await page.waitForTimeout(2000);
  r.reverted = !fs.existsSync(path.join(proj, 'revert-me.txt'));
  r.banner = await page.isVisible('#revert-banner');
  await L.shot(page, '12-reverted.png');
  await page.click('#btn-unrevert');
  await page.waitForTimeout(2000);
  r.unreverted = fs.existsSync(path.join(proj, 'revert-me.txt'));
  // search
  await page.click('.right-tab[data-tab="search"]');
  await page.fill('#search-input', 'needle');
  await page.press('#search-input', 'Enter');
  await page.waitForTimeout(1500);
  r.search = /notes\.txt/.test(await page.textContent('#search-results'));
  await L.shot(page, '13-search.png');
  await app.close();
  L.report('e2e', r);
})().catch(e => { console.error(e); process.exit(1); });

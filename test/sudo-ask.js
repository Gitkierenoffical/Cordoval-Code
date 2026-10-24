// Default permissions: sudo asks first on a fresh profile; Deny stops it, Allow once runs it.
const L = require('./lib');
(async () => {
  const proj = L.tmp('sudo');
  const { app, page } = await L.launch(proj);
  const perm = (await page.evaluate(() => window.cordoval.getEngineConfig())).permission || {};
  const r = { seeded: !!(perm.bash && perm.bash['sudo *'] === 'ask' && perm.bash['rm -rf *'] === 'ask' && perm.bash['git push*'] === 'ask' && perm.bash['npm publish*'] === 'ask' && perm.bash['curl * | sh*'] === 'ask') };
  await L.send(page, 'Run exactly this shell command with your bash tool: sudo -n true');
  await page.waitForSelector('.permission-card', { timeout: 20000 }).catch(() => {});
  r.asked = !!(await page.$('.permission-card'));
  r.cardText = r.asked && /sudo -n true/.test(await page.textContent('.permission-card'));
  r.threeChoices = (await page.$$eval('.permission-card button', b => b.map(x => x.textContent))).join('|') === 'Allow once|Always allow|Deny';
  await L.shot(page, '53-sudo-asks.png');
  await page.click('.permission-card .btn-danger');
  await L.waitIdle(page, 20000, false);
  const a = (await L.messages(page)).filter(x => x.info.role === 'assistant').pop();
  r.denied = a.parts.some(p => p.type === 'tool' && p.tool === 'bash' && p.state.status === 'error' && /denied/.test(p.state.error));
  // a plain command needs no approval
  await L.send(page, 'Run exactly this shell command with your bash tool: echo plain-ok');
  await L.waitIdle(page, 20000, false);
  const b = (await L.messages(page)).filter(x => x.info.role === 'assistant').pop();
  r.plainRuns = b.parts.some(p => p.type === 'tool' && p.tool === 'bash' && p.state.status === 'completed' && /plain-ok/.test(p.state.output));
  await app.close();
  L.report('sudo-ask', r);
})().catch(e => { console.error(e); process.exit(1); });

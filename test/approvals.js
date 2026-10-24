// Web fetch permission per website, Plan-mode block, pending-approvals indicator, the
// Settings > Permissions list with revoke, outside-project write prompt, cost display and
// the read-only research subagent.
const L = require('./lib');
const fs = require('fs');
const path = require('path');
const http = require('http');
(async () => {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/redirect') { res.writeHead(302, { location: '/page' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><script>x()</script></head><body><h1>Hello fetch</h1><p>Body <a href="https://example.org">link</a></p></body></html>');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const proj = L.tmp('approvals');
  const outside = L.tmp('outside');
  const { app, page } = await L.launch(proj);
  const r = {};
  const last = async () => (await L.messages(page)).filter(m => m.info.role === 'assistant').pop();
  const tool = (a, name) => a.parts.filter(p => p.type === 'tool' && p.tool === name).pop();
  const card = () => page.waitForSelector('.permission-card', { timeout: 20000 });

  // 1. web fetch asks, shows the URL and risk note, and the indicator counts it
  await L.send(page, 'Fetch the page ' + base + '/page and summarise it.');
  await card();
  const cardText = await page.textContent('.permission-card');
  r.fetchAsks = /Fetch a web page/.test(cardText) && cardText.includes('127.0.0.1:') && cardText.includes(base + '/page') && /Risk:/.test(cardText);
  r.noRequestBeforeApproval = hits.length === 0;
  r.pendingIndicator = (await page.isVisible('#status-approvals')) && /Pending approvals: 1/.test(await page.textContent('#status-approvals'));
  await L.shot(page, '60-webfetch-approval.png');
  await page.click('.permission-card button:has-text("Always allow")');
  await L.waitIdle(page, 30000, false);
  let a = await last();
  let t = tool(a, 'webfetch');
  r.fetchWorks = t && t.state.status === 'completed' && /# Hello fetch/.test(t.state.output) && !/x\(\)/.test(t.state.output);
  r.indicatorClears = !(await page.isVisible('#status-approvals'));
  await L.shot(page, '61-webfetch-result.png');

  // 2. always-allow covers the same website (and a redirect on it) without asking
  await L.send(page, 'Fetch the page ' + base + '/redirect please.');
  await L.waitIdle(page, 30000, false);
  t = tool(await last(), 'webfetch');
  r.alwaysRemembered = t && t.state.status === 'completed' && hits.filter(h => h === '/page').length === 2;

  // 3. cost: priced mock model shows dollars, the unpriced one shows unknown
  const costs = await page.$$eval('.message-cost', ns => ns.map(n => n.textContent));
  r.costShown = costs.length > 0 && costs.every(c => /^Cost: \$\d/.test(c)) && /Session cost: \$/.test(await page.textContent('#status-cost'));
  await L.shot(page, '62-cost.png');
  await page.selectOption('#model-picker', 'mock/scripted-alt');
  await L.send(page, 'Reply with exactly the single word PONG.');
  await L.waitIdle(page, 30000, false);
  const costs2 = await page.$$eval('.message-cost', ns => ns.map(n => n.textContent));
  r.costUnknown = /^Cost: unknown/.test(costs2[costs2.length - 1]) && /unknown/.test(await page.textContent('#status-cost'));
  await page.selectOption('#model-picker', 'mock/scripted');

  // 4. Settings > Permissions lists the rule; revoke makes it ask again
  await page.click('#btn-settings');
  await page.click('.modal-tab[data-stab="permissions"]');
  await page.waitForSelector('.perm-rule', { timeout: 5000 }).catch(() => {});
  const rules = await page.$$eval('.perm-rule', ns => ns.map(n => n.textContent));
  r.rulesListed = rules.length === 1 && /Fetch a web page/.test(rules[0]) && rules[0].includes('127.0.0.1:');
  await L.shot(page, '63-permissions-page.png');
  await page.click('.perm-rule button:has-text("Revoke")');
  await page.waitForSelector('.perm-rules-empty', { timeout: 5000 }).catch(() => {});
  r.revoked = (await page.$$('.perm-rule')).length === 0;
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const b = document.getElementById('settings-backdrop'); if (b) b.hidden = true; });
  const before = hits.length;
  await L.send(page, 'Fetch the page ' + base + '/page again.');
  await card();
  await page.click('.permission-card button:has-text("Deny")');
  await L.waitIdle(page, 30000, false);
  t = tool(await last(), 'webfetch');
  r.asksAgainAfterRevoke = t && t.state.status === 'error' && hits.length === before;

  // 5. Plan mode blocks web fetch outright
  await page.click('#btn-agent-plan');
  await L.send(page, 'Fetch the page ' + base + '/page in plan mode.');
  await L.waitIdle(page, 30000, false);
  a = await last();
  t = tool(a, 'webfetch');
  r.planBlocksFetch = a.info.agent === 'plan' && (!t || t.state.status === 'error') && hits.length === before && !(await page.$('.permission-card'));
  await page.click('#btn-agent-build');

  // 6. writing outside the project asks, with the risk note; deny keeps the file out
  const target = path.join(outside, 'escape.txt');
  await L.send(page, 'Create a file named ' + target + ' containing the word nope.');
  await card();
  const outText = await page.textContent('.permission-card');
  r.outsideAsks = /outside the project/i.test(outText) && outText.includes(outside) && (await page.$('.permission-card.is-risky')) !== null;
  await L.shot(page, '64-outside-write-approval.png');
  await page.click('.permission-card button:has-text("Deny")');
  await L.waitIdle(page, 30000, false);
  r.outsideDenied = !fs.existsSync(target);

  // 7. research subagent: read-only sub-session, kept out of the session list
  fs.writeFileSync(path.join(proj, 'findme.txt'), 'x');
  await L.send(page, 'Research with a subagent: List the project files');
  await L.waitIdle(page, 30000, true);
  t = tool(await last(), 'task');
  const all = await page.evaluate(() => window.Api.request('/session', { query: { children: '1' } }));
  const child = all.find(s => s.parentID);
  const childMsgs = child ? await page.evaluate((id) => window.Api.getMessages(id), child.id) : [];
  const childTools = childMsgs.flatMap(m => m.parts.filter(p => p.type === 'tool').map(p => p.tool));
  const listed = await page.evaluate(() => window.Api.listSessions());
  r.subagent = t && t.state.status === 'completed' && /Subagent report/.test(t.state.output) && !!child && childTools.includes('list') && childTools.every(n => ['read', 'list', 'glob', 'grep'].includes(n)) && !listed.some(s => s.parentID);

  await app.close();
  srv.close();
  L.report('approvals', r, { hits: hits.length });
})().catch(e => { console.error(e); process.exit(1); });

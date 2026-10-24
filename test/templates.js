// New project from a template: the folder is created with git, the template's brief is sent
// to the agent and the turn finishes cleanly (scripted provider). TEMPLATES=a,b to pick.
const L = require('./lib');
const fs = require('fs');
const path = require('path');
(async () => {
  const parent = L.tmp('templates');
  const ids = (process.env.TEMPLATES || 'react-vite').split(',');
  const r = {};
  for (const id of ids) {
    const name = id + '-' + Date.now().toString(36);
    const { app, page } = await L.launch(null);
    await page.click('#btn-welcome-template');
    await page.click(`.template-item[data-id="${id}"]`);
    await page.fill('#template-name', name);
    await page.evaluate((p) => { const i = document.getElementById('template-parent'); i.removeAttribute('readonly'); i.value = p; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }, parent);
    await page.click('#btn-template-create');
    await page.waitForTimeout(2000);
    const done = await L.waitIdle(page, 60000, true);
    const dir = path.join(parent, name);
    const msgs = await L.messages(page).catch(() => []);
    const user = msgs.find(m => m.info.role === 'user');
    const a = msgs.filter(m => m.info.role === 'assistant').pop();
    r[id + 'Folder'] = fs.existsSync(path.join(dir, '.git'));
    r[id + 'ProjectOpen'] = (await page.evaluate(() => window.CordovalApp.directory())) === dir;
    r[id + 'BriefSent'] = !!user && user.parts.some(p => p.type === 'text' && p.text.length > 100);
    r[id + 'Finished'] = done && !!a && !!a.info.time.completed && !a.info.error;
    await L.shot(page, `20-template-${id}.png`);
    await app.close();
  }
  L.report('templates', r);
})().catch(e => { console.error(e); process.exit(1); });

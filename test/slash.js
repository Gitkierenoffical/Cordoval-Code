// /help /model /undo /redo /compact /init and a project-defined command from .cordoval/command.
const L = require('./lib');
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
async function cmd(page, text) { await page.fill('#composer-input', text); await page.waitForTimeout(300); await page.press('#composer-input', 'Enter'); await page.waitForTimeout(1000); }
(async () => {
  const proj = L.tmp('slash'); fs.mkdirSync(path.join(proj, '.cordoval', 'command'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.cordoval', 'command', 'shout.md'), '---\ndescription: Reply in capitals\n---\nReply with only the word $ARGUMENTS in capital letters.\n');
  spawnSync('git', ['init', '-q'], { cwd: proj });
  const { app, page } = await L.launch(proj);
  const r = {};
  const lastAssistant = async () => (await L.messages(page)).filter(x => x.info.role === 'assistant').pop();
  await page.fill('#composer-input', '/sh'); await page.waitForTimeout(800);
  r.projectCmdListed = (await page.$$eval('.slash-item .slash-name', e => e.map(x => x.textContent))).includes('/shout');
  await cmd(page, '/help'); r.help = await page.evaluate(() => /\/undo/.test(document.body.innerText)); await L.shot(page, '17-slash-help.png');
  await page.keyboard.press('Escape'); await page.click('.modal-close, [id$="-close"]:visible').catch(() => {});
  await cmd(page, '/model'); r.model = await page.evaluate(() => document.activeElement && document.activeElement.id === 'model-picker');
  await cmd(page, 'Create a file named undo-me.txt containing hi.'); await L.waitIdle(page);
  r.created = fs.existsSync(path.join(proj, 'undo-me.txt'));
  await cmd(page, '/undo'); await page.waitForTimeout(2000); r.undo = !fs.existsSync(path.join(proj, 'undo-me.txt'));
  await cmd(page, '/redo'); await page.waitForTimeout(2000); r.redo = fs.existsSync(path.join(proj, 'undo-me.txt'));
  await cmd(page, '/shout hello'); await L.waitIdle(page);
  r.projectCmd = (await lastAssistant()).parts.filter(p => p.type === 'text').map(p => p.text).join(' ').includes('HELLO');
  await cmd(page, '/compact'); await L.waitIdle(page);
  const c = await lastAssistant(); r.compact = !!c.info.summary && c.parts.some(p => p.type === 'text' && /Summary/.test(p.text));
  await cmd(page, '/init'); await L.waitIdle(page); r.init = fs.existsSync(path.join(proj, 'AGENTS.md'));
  await app.close();
  L.report('slash', r);
})().catch(e => { console.error(e); process.exit(1); });

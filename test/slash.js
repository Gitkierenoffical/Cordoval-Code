// Tests /help /model /undo /redo /compact /init and a project-defined command.
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs'); const { spawnSync } = require('child_process');
const shots = path.join(__dirname, '..', 'screenshots');
const r = {};
async function waitIdle(page, ms = 180000) { const t = Date.now(); await page.waitForTimeout(2500); while (Date.now() - t < ms) { const b = await page.$('.permission-card button'); if (b) await b.click().catch(() => {}); if (!(await page.isVisible('#btn-stop'))) return true; await page.waitForTimeout(2000); } return false; }
async function cmd(page, text) { await page.fill('#composer-input', text); await page.waitForTimeout(300); await page.press('#composer-input', 'Enter'); await page.waitForTimeout(1200); }
async function msgs(page) { return page.evaluate(async () => { const b = window.Api.engineUrl(); const d = encodeURIComponent(window.__ccDir); const l = await (await fetch(b + '/session?directory=' + d)).json(); const s = l.sort((a, c) => c.time.updated - a.time.updated)[0]; const m = await (await fetch(b + '/session/' + s.id + '/message?directory=' + d)).json(); return { s, m: m.map(x => ({ role: x.info.role, summary: !!x.info.summary, text: x.parts.filter(p => p.type === 'text').map(p => p.text).join(' ').slice(0, 120) })) }; }); }
(async () => {
  const proj = '/tmp/cc-slash-' + Date.now(); fs.mkdirSync(path.join(proj, '.opencode', 'command'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.opencode', 'command', 'shout.md'), '---\ndescription: Reply in capitals\n---\nReply with only the word $ARGUMENTS in capital letters.\n');
  spawnSync('git', ['init', '-q'], { cwd: proj });
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox', '--project=' + proj] });
  const page = await app.firstWindow(); page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(7000); await page.evaluate(d => { window.__ccDir = d; }, proj);
  try {
    await page.fill('#composer-input', '/sh'); await page.waitForTimeout(800);
    r.projectCmdListed = (await page.$$eval('.slash-item .slash-name', e => e.map(x => x.textContent))).includes('/shout');
    await cmd(page, '/help'); r.help = await page.evaluate(() => /\/undo/.test(document.body.innerText)); await page.screenshot({ path: path.join(shots, '17-slash-help.png') });
    await page.keyboard.press('Escape'); await page.click('.modal-close, [id$="-close"]:visible').catch(() => {});
    await cmd(page, '/model'); r.model = await page.evaluate(() => document.activeElement && document.activeElement.id === 'model-picker');
    await cmd(page, 'Create a file named undo-me.txt containing hi.'); await waitIdle(page);
    r.created = fs.existsSync(path.join(proj, 'undo-me.txt'));
    await cmd(page, '/undo'); await page.waitForTimeout(3000); r.undo = !fs.existsSync(path.join(proj, 'undo-me.txt'));
    await cmd(page, '/redo'); await page.waitForTimeout(3000); r.redo = fs.existsSync(path.join(proj, 'undo-me.txt'));
    await cmd(page, '/shout hello'); await waitIdle(page); r.projectCmd = (await msgs(page)).m.filter(x => x.role === 'assistant').pop()?.text;
    await cmd(page, '/compact'); await waitIdle(page); r.compact = JSON.stringify((await msgs(page)).m.slice(-2)).slice(0, 200);
    await cmd(page, '/init'); await waitIdle(page, 300000); r.init = fs.existsSync(path.join(proj, 'AGENTS.md'));
  } catch (e) { console.log('err', e.message); }
  console.log('[slash]', JSON.stringify(r));
  await app.close();
})();

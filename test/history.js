// Palette, shortcuts and session history (search, rename, export md/json, delete, import).
const L = require('./lib');
const path = require('path'); const fs = require('fs');
const shots = L.SHOTS;
const MODEL = process.env.MODEL || 'mock/scripted';
(async () => {
  const proj = L.tmp('hist'); fs.writeFileSync(proj + '/notes.txt', 'hello\n');
  const out = L.tmp('hist-out');
  const { app, page } = await L.launch(proj);
  page.on('dialog', d => d.accept());
  await app.evaluate(({ dialog }, out) => {
    let n = 0;
    dialog.showSaveDialog = async (w, o) => ({ canceled: false, filePath: out + '/' + (++n) + '-' + String((o || w).defaultPath).split('/').pop() });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [global.__importFile] });
  }, out);
  const r = {};
  // palette
  await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
  r.paletteOpen = await page.isVisible('#palette-input');
  await page.keyboard.type('terminal'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(shots, '34-command-palette.png') });
  await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  r.terminalAfterPalette = await page.evaluate(() => { const t = document.getElementById('terminal-dock'); return !!t && !t.hidden; });
  await page.keyboard.press('Control+Shift+P'); await page.waitForTimeout(200);
  r.paletteAlt = await page.isVisible('#palette-input'); await page.keyboard.press('Escape');
  await page.keyboard.press('Control+/'); await page.waitForTimeout(300);
  r.shortcutsHelp = await page.isVisible('#shortcuts-backdrop');
  await page.screenshot({ path: path.join(shots, '35-shortcuts.png') });
  await page.click('#btn-shortcuts-close');
  const before = await page.locator('.session-item').count();
  await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(1500);
  r.sessCounts = [before, await page.locator('.session-item').count()];
  r.newSessionShortcut = r.sessCounts[1] === before + 1;
  // an exchange with the scripted test model
  await page.selectOption('#model-picker', MODEL).catch(e => r.modelErr = e.message);
  await page.fill('#composer-input', 'Reply with exactly the single word PINEAPPLE and nothing else. Do not use tools.');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(1000); if ((await page.textContent('#messages').catch(() => '')).includes('PINEAPPLE') && !(await page.isVisible('#btn-stop'))) break; }
  const sid = await page.evaluate(() => window.CordovalApp.sessionId());
  // rename via API hook so search can find title too
  await page.evaluate(async (sid) => { await window.Api.renameSession(sid, 'Fruit test'); await window.CordovalApp.refreshSessions(); }, sid);
  await page.keyboard.press('Control+Shift+N').catch(()=>{});
  await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(1200);
  await page.keyboard.press('Control+Shift+F'); await page.keyboard.type('pineapple'); await page.waitForTimeout(3000);
  r.searchHits = await page.locator('.session-result').count();
  r.searchText = (await page.textContent('#session-results')).slice(0, 160);
  await page.screenshot({ path: path.join(shots, '36-session-search.png') });
  await page.click('.session-result'); await page.waitForTimeout(1500);
  r.openedFromSearch = (await page.evaluate(() => window.CordovalApp.sessionId())) === sid;
  await page.fill('#session-search', ''); await page.dispatchEvent('#session-search', 'input');
  const md = await page.evaluate(() => window.SessionsUI.exportMarkdown());
  r.md = !!md && fs.existsSync(md) && fs.readFileSync(md, 'utf8').includes('PINEAPPLE');
  const js = await page.evaluate(() => window.SessionsUI.exportJson());
  r.json = !!js && fs.existsSync(js) && JSON.parse(fs.readFileSync(js, 'utf8')).info.id === sid;
  await app.evaluate((_, f) => { global.__importFile = f; }, js);
  await page.evaluate((sid) => window.CordovalApp._deleteSession ? 0 : 0, sid);
  await page.evaluate(async (sid) => { await window.Api.deleteSession(sid); await window.CordovalApp.refreshSessions(); }, sid);
  r.deleted = !(await page.evaluate(async (sid) => (await window.Api.listSessions()).some(s => s.id === sid), sid));
  const imp = await page.evaluate(() => window.SessionsUI.importJson());
  r.imported = !!imp && imp.id === sid && (await page.evaluate(async (sid) => (await window.Api.listSessions()).some(s => s.id === sid), sid));
  await page.waitForTimeout(1500);
  r.importedHasText = (await page.textContent('#messages')).includes('PINEAPPLE');
  await page.screenshot({ path: path.join(shots, '37-session-imported.png') });
  await app.close();
  const checks = {};
  for (const k of ['paletteOpen', 'terminalAfterPalette', 'paletteAlt', 'shortcutsHelp', 'newSessionShortcut', 'openedFromSearch', 'md', 'json', 'deleted', 'imported', 'importedHasText']) checks[k] = !!r[k];
  checks.searchHits = r.searchHits > 0;
  if (process.env.DEBUG) console.log(r);
  L.report('history', checks, { modelErr: r.modelErr });
})().catch(e => { console.error('FAIL', e); process.exit(1); });

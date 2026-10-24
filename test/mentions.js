// @-mentions: autocomplete files and agents, and the mentioned file reaches the model.
const L = require('./lib');
const path = require('path'); const fs = require('fs');
const shots = L.SHOTS;
(async () => {
  const proj = L.tmp('ment'); fs.mkdirSync(proj + '/src', { recursive: true });
  fs.writeFileSync(proj + '/src/secret-notes.txt', 'The launch code word is BANANA42.\n');
  const { app, page } = await L.launch(proj);
  const r = {};
  await page.click('#composer-input');
  await page.keyboard.type('@expl'); await page.waitForTimeout(1200);
  r.agentItem = await page.locator('.mention-item', { hasText: 'explore' }).count();
  await page.fill('#composer-input', '');
  await page.keyboard.type('What is the code word in @secret'); await page.waitForTimeout(1500);
  r.fileItems = await page.locator('.mention-item').allTextContents();
  await page.screenshot({ path: path.join(shots, '46-mentions.png') });
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  r.value = await page.inputValue('#composer-input');
  await page.keyboard.type('? Answer with just the word, no tools.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(1000); const m = await page.evaluate(async () => window.Api.getMessages(window.CordovalApp.sessionId())); const a = m.filter(x => x.info.role === 'assistant').pop(); if (a && a.info.time.completed && !(await page.isVisible('#btn-stop'))) { r.userParts = m[0].parts.map(p => p.type + (p.filename ? ':' + p.filename : '')); r.tools = a.parts.filter(p => p.type === 'tool').map(p => p.tool); r.answer = a.parts.filter(p => p.type === 'text').map(p => p.text).join(' ').slice(0, 80); break; } }
  await page.screenshot({ path: path.join(shots, '47-mention-answer.png') });
  await app.close();
  L.report('mentions', { agentListed: r.agentItem > 0, fileListed: (r.fileItems || []).some(t => t.includes('src/secret-notes.txt')), insertedMention: /@src\/secret-notes\.txt/.test(r.value || ''), fileReachedEngine: (r.userParts || []).includes('file:src/secret-notes.txt'), answered: /BANANA42/.test(r.answer || '') }, r);
})();

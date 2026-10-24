// Live check against OpenRouter with a real key (skipped when OPENROUTER_TEST_KEY is not set).
// The key is written to a throwaway profile's key store before launch, never sent to the window.
const L = require('./lib');
const fs = require('fs'); const path = require('path');
const KEY = process.env.OPENROUTER_TEST_KEY || process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.LIVE_MODEL || 'openrouter/openai/gpt-4.1-mini';
(async () => {
  if (!KEY) { console.log('SKIP live-openrouter (no key in env)'); return; }
  const proj = L.tmp('live'); require('child_process').spawnSync('git', ['init', '-q'], { cwd: proj });
  const ud = L.tmp('ud-live');
  fs.writeFileSync(path.join(ud, 'keys.json'), JSON.stringify({ v: 1, providers: { openrouter: { t: 'plain', d: Buffer.from(KEY).toString('base64') } }, custom: [] }), { mode: 0o600 });
  const { app, page } = await L.launch(proj, { live: true, userData: ud });
  const r = {};
  r.modelListed = await page.waitForSelector('#model-picker option[value="' + MODEL + '"]', { state: 'attached', timeout: 20000 }).then(() => true, () => false);
  await page.selectOption('#model-picker', MODEL).catch(() => {});
  await L.send(page, 'Use the write tool to create a file named hello.txt containing exactly: Hello from Cordoval Code. Then reply with one short sentence.');
  r.idle = await L.waitIdle(page, 120000);
  const msgs = await L.messages(page);
  const a = msgs.filter(m => m.info.role === 'assistant');
  r.file = fs.existsSync(path.join(proj, 'hello.txt')) && /Hello from Cordoval Code/.test(fs.readFileSync(path.join(proj, 'hello.txt'), 'utf8'));
  r.toolCall = a.some(m => m.parts.some(p => p.type === 'tool' && p.tool === 'write' && p.state.status === 'completed'));
  r.noError = !a.some(m => m.info.error);
  const dump = JSON.stringify(msgs) + (await page.content());
  r.keyNotInMessagesOrDom = !dump.includes(KEY);
  if (process.env.LIVE_SHOT) await L.shot(page, process.env.LIVE_SHOT);
  await app.close();
  L.report('live-openrouter', r, { model: MODEL, error: (a.find(m => m.info.error) || { info: {} }).info.error });
})().catch(e => { console.error(e); process.exit(1); });

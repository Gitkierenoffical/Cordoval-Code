// Proves API keys never leak: a fake OpenAI-compatible provider must receive the key in the
// Authorization header, and the key must not appear in prompts, messages, tool output, events,
// the renderer, logs, session files or anywhere else in the profile.
// First draft written with the opencode CLI as a coding helper, then corrected by hand.
const { tmp, launch, messages, report } = require('./lib.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createServer } = require('http');
const crypto = require('crypto');

// Generate canaries
const CANARY = 'sk-cordoval-canary-' + crypto.randomBytes(12).toString('hex');
const CANARY2 = 'sk-or-v1-canary' + crypto.randomBytes(16).toString('hex');
const chunk = (res, delta, finish, usage) => res.write('data: ' + JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish || null }], ...(usage ? { usage } : {}) }) + '\n\n');

async function runTest() {
  // Start fake server
  const server = createServer();
  const requests = [];
  
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body
      });
      
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
      } else if (req.url === '/v1/chat/completions') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        
        let reqBody = {};
        try { reqBody = JSON.parse(body); } catch (e) {}
        const msgs = reqBody.messages || [];
        const last = msgs[msgs.length - 1] || {};
        const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
        const toolTurns = msgs.filter(m => m.role === 'tool').length;
        if (toolTurns === 1) {
          // Second step: fetch a web page from another host. The key must not go there.
          chunk(res, { role: 'assistant', tool_calls: [{ index: 0, id: 'call_leak2', type: 'function', function: { name: 'webfetch', arguments: JSON.stringify({ url: 'http://127.0.0.1:' + fetchPort + '/fetched?q=1' }) } }] });
          chunk(res, {}, 'tool_calls', usage);
        } else if (last.role === 'tool') {
          chunk(res, { role: 'assistant', content: 'All done.' });
          chunk(res, {}, 'stop', usage);
        } else {
          chunk(res, { role: 'assistant', tool_calls: [{ index: 0, id: 'call_leak1', type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: 'leak-check.txt', content: 'ok\n' }) } }] });
          chunk(res, {}, 'tool_calls', usage);
        }
        // Done signal
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // A separate "website" for the web fetch tool, logging everything it receives.
  const fetched = [];
  const fetchServer = createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => { fetched.push({ url: req.url, headers: req.headers, body }); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>Fetched page</h1>'); });
  });
  await new Promise(r => fetchServer.listen(0, '127.0.0.1', r));
  const fetchPort = fetchServer.address().port;
  
  // Create temp project
  const proj = tmp('leak');
  execSync('git init -q', { cwd: proj });
  
  // Launch app
  const { app, page, userData } = await launch(proj, { live: true, env: { ELECTRON_ENABLE_LOGGING: '1', CORDOVAL_TEST_PRIVATE_FETCH: '1' } });
  const logs = { stdout: '', stderr: '' };
  const proc = app.process();
  proc.stdout.on('data', data => logs.stdout += data.toString());
  proc.stderr.on('data', data => logs.stderr += data.toString());
  page.on('console', m => { logs.stdout += m.text() + '\n'; });

  // Set up event collection
  await page.evaluate(() => {
    window.__events = [];
    window.Api.on('message', msg => {
      window.__events.push(JSON.stringify(msg));
    });
  });

  // Configure keys and custom endpoint the same way the Settings page does
  await page.evaluate(async ([canary, canary2, port]) => {
    await window.cordoval.setKey('openrouter', canary2);
    await window.cordoval.setCustom([{
      name: 'Fake',
      baseURL: `http://127.0.0.1:${port}/v1`,
      models: ['fake-model'],
      apiKey: canary
    }]);
  }, [CANARY, CANARY2, port]);
  
  // Send prompt
  const sessionId = await page.evaluate(() => window.CordovalApp.sessionId());
  await page.evaluate(async ([sessionId, model]) => {
    await window.Api.promptAsync(sessionId, {
      model,
      agent: 'build',
      parts: [{ type: 'text', text: 'Create leak-check.txt. My key is not here.' }]
    });
  }, [sessionId, { providerID: 'fake', modelID: 'fake-model' }]);
  
  // Wait for completion
  let done = false;
  let attempts = 0;
  while (!done && attempts < 60) {
    attempts++;
    const btn = await page.$('.permission-card button');
    if (btn) await btn.click().catch(() => {});
    const msgs = await messages(page);
    const lastMsg = msgs.filter(m => m.info.role === 'assistant').pop();
    if (lastMsg && lastMsg.info.time && lastMsg.info.time.completed) {
      const status = await page.evaluate(() => window.Api.request('/session/status'));
      if (!Object.keys(status || {}).length) done = true;
    }
    await page.waitForTimeout(1000);
  }
  
  // Collect data
  const [
    messagesData,
    providersData,
    sessionsData,
    events,
    dom,
    localStorageData,
    keysData,
    customData
  ] = await Promise.all([
    messages(page),
    page.evaluate(() => window.Api.request('/config/providers')),
    page.evaluate(() => window.Api.request('/session')),
    page.evaluate(() => window.__events),
    page.evaluate(() => document.documentElement.outerHTML),
    page.evaluate(() => JSON.parse(JSON.stringify(localStorage))),
    page.evaluate(() => window.cordoval.getKeys()),
    page.evaluate(() => window.cordoval.getCustom())
  ]);
  
  // Read userData files
  const userDataFiles = {};
  const walkDir = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filepath = path.join(dir, file);
      const stat = fs.statSync(filepath);
      if (stat.isDirectory()) {
        walkDir(filepath);
      } else if (stat.size < 20 * 1024 * 1024) { // Skip files over 20MB
        userDataFiles[filepath] = fs.readFileSync(filepath, 'utf8');
      }
    }
  };
  walkDir(userData);
  
  // Read project files
  const projectFiles = {};
  const projFiles = fs.readdirSync(proj);
  for (const file of projFiles) {
    const filepath = path.join(proj, file);
    const stat = fs.statSync(filepath);
    if (stat.isFile() && stat.size < 20 * 1024 * 1024) {
      projectFiles[file] = fs.readFileSync(filepath, 'utf8');
    }
  }
  
  // Check for leaks
  const checks = {};
  
  // Check that provider got key in Authorization header only
  const authHeaderFound = requests.some(req => 
    req.headers.authorization === `Bearer ${CANARY}`
  );
  checks['provider got key in Authorization header only'] = authHeaderFound;
  
  // Check that tool call ran
  checks['tool call ran'] = projectFiles['leak-check.txt'] !== undefined;
  const fetchedText = JSON.stringify(fetched);
  checks['web fetch ran'] = fetched.length === 1 && fetched[0].url === '/fetched?q=1';
  checks['no key sent to fetched URL'] = !fetchedText.includes(CANARY) && !fetchedText.includes(CANARY2) && !fetched.some(f => f.headers.authorization || f.headers.cookie || f.headers['x-api-key'] || f.headers['x-cordoval-token']);
  checks['key reached only the chat endpoint host'] = requests.every(r => !r.headers.authorization || r.headers.authorization === 'Bearer ' + CANARY);
  
  // Check all surfaces for key leaks
  const surfaces = [
    { name: 'request bodies', data: requests.map(r => r.body).join('\n') },
    { name: 'request URLs', data: requests.map(r => r.url).join('\n') },
    { name: 'messages', data: JSON.stringify(messagesData) },
    { name: 'providers API', data: JSON.stringify(providersData) },
    { name: 'sessions API', data: JSON.stringify(sessionsData) },
    { name: 'SSE events', data: events.join('\n') },
    { name: 'renderer DOM', data: dom },
    { name: 'localStorage', data: JSON.stringify(localStorageData) },
    { name: 'keys IPC results', data: JSON.stringify(keysData) },
    { name: 'custom IPC results', data: JSON.stringify(customData) },
    { name: 'user-data files', data: Object.values(userDataFiles).join('\n') },
    { name: 'project files', data: Object.values(projectFiles).join('\n') },
    { name: 'logs', data: logs.stdout + logs.stderr }
  ];
  
  for (const { name, data } of surfaces) {
    const noCanary = !data.includes(CANARY) && !data.includes(CANARY2);
    checks[`no key in ${name}`] = noCanary;
  }
  
  // Cleanup
  await app.close();
  server.close();
  fetchServer.close();
  
  // Report results
  report('keys-never-leak', checks, { requests: requests.length, userDataFiles: Object.keys(userDataFiles).length });
}

runTest().catch(e => {
  console.error(e);
  process.exit(1);
});
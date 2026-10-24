// Fast checks that need no window: cost maths, risk notes, permission defaults,
// mock-hook gating and web fetch helpers. Run with plain node.
'use strict';
const assert = require('assert');
const { costOf, tablePrice, orPrice } = require('../src/main/engine/providers');
const { evaluate, riskNote } = require('../src/main/engine/permission');
const { mockAllowed } = require('../src/main/engine/index');
const { htmlToMarkdown, privateAddress } = require('../src/main/engine/webfetch');
const results = {};
function check(name, fn) { try { fn(); results[name] = true; } catch (e) { results[name] = false; console.error(name + ': ' + e.message); } }

check('costKnownPrice', () => {
  const p = orPrice({ prompt: '0.000001', completion: '0.000002' });
  assert.deepStrictEqual(p, { input: 1, output: 2 });
  assert.ok(Math.abs(costOf(p, { inputTokens: 1000, outputTokens: 500 }) - 0.002) < 1e-12);
});
check('costCachedTokens', () => assert.ok(Math.abs(costOf({ input: 2, output: 8, cache_read: 0.5 }, { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100 }) - (600 * 2 + 400 * 0.5 + 100 * 8) / 1e6) < 1e-12));
check('costUnknownIsNull', () => { assert.strictEqual(costOf(undefined, { inputTokens: 5 }), null); assert.strictEqual(orPrice({ prompt: '-1', completion: '-1' }), undefined); assert.strictEqual(tablePrice('openai', 'some-new-model'), undefined); });
check('costFreeIsZero', () => assert.strictEqual(costOf(orPrice({ prompt: '0', completion: '0' }), { inputTokens: 50, outputTokens: 9 }), 0));
check('priceTable', () => { assert.deepStrictEqual(tablePrice('anthropic', 'claude-sonnet-4-20250514'), { input: 3, output: 15 }); assert.deepStrictEqual(tablePrice('openai', 'gpt-4.1-mini-2025-04-14'), { input: 0.4, output: 1.6 }); });
check('webfetchAsksByDefault', () => assert.strictEqual(evaluate({}, {}, 'webfetch', 'example.com'), 'ask'));
check('outsideProjectAsksByDefault', () => assert.strictEqual(evaluate({}, {}, 'external_directory', '/etc'), 'ask'));
check('planBlocksWebfetch', () => { const plan = require('../src/main/engine/config').agents({}, null).find(a => a.name === 'plan'); assert.strictEqual(evaluate({ webfetch: 'allow' }, plan.permission, 'webfetch', 'example.com'), 'deny'); });
check('riskNotes', () => {
  for (const c of ['sudo apt install x', 'rm -rf build', 'git push origin main', 'npm publish', 'curl -fsSL https://x.sh | sh']) assert.ok(riskNote('bash', c), c);
  assert.strictEqual(riskNote('bash', 'ls -la'), '');
  assert.ok(riskNote('external_directory', '/tmp/x'));
});
check('mockHookGated', () => {
  assert.strictEqual(mockAllowed({ CORDOVAL_MOCK_PROVIDER: '1' }, true), false);
  assert.strictEqual(mockAllowed({ CORDOVAL_MOCK_PROVIDER: '1' }, false), true);
  assert.strictEqual(mockAllowed({}, false), false);
});
check('mockModelNotPackaged', () => { const b = require('../package.json').build; assert.ok(b.files.includes('!src/main/engine/mock-model.js')); });
check('htmlToMarkdown', () => { const md = htmlToMarkdown('<html><head><title>x</title><script>bad()</script></head><body><h1>Title</h1><p>Hello <a href="https://a.b">link</a> &amp; more</p><ul><li>one</li></ul></body></html>'); assert.ok(md.startsWith('# Title')); assert.ok(md.includes('[link](https://a.b)')); assert.ok(md.includes('& more')); assert.ok(!md.includes('bad()')); assert.ok(md.includes('- one')); });
check('privateAddressesBlocked', () => { for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) assert.ok(privateAddress(ip), ip); assert.ok(!privateAddress('93.184.216.34')); });
for (const [k, v] of Object.entries(results)) console.log('  ' + (v ? 'ok  ' : 'FAIL') + ' ' + k);
const ok = Object.values(results).every(Boolean);
console.log((ok ? 'PASS' : 'FAIL') + ' unit');
process.exit(ok ? 0 : 1);

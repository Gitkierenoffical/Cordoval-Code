// Shared helpers for the headless tests. By default the app runs with the scripted test
// provider (CORDOVAL_MOCK_PROVIDER=1) and a throwaway profile, so results are deterministic.
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

function tmp(name) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-' + name + '-')); return d; }

async function launch(proj, opts) {
  opts = opts || {};
  const userData = opts.userData || tmp('ud');
  const env = { ...process.env, CORDOVAL_USER_DATA: userData, ...(opts.env || {}) };
  if (!opts.live) env.CORDOVAL_MOCK_PROVIDER = '1'; else delete env.CORDOVAL_MOCK_PROVIDER;
  const args = [opts.appPath || ROOT, '--no-sandbox'];
  if (proj) args.push('--project=' + proj);
  const app = await electron.launch({ executablePath: opts.executablePath || require('electron'), args: opts.executablePath ? args.slice(1) : args, env });
  const page = await app.firstWindow();
  page.on('pageerror', e => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900)).catch(() => {});
  await page.waitForFunction(() => window.Api && window.Api.engineUrl() && window.CordovalApp && window.CordovalApp.sessionId && window.CordovalApp.sessionId(), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(opts.settle || 1500);
  return { app, page, userData };
}

async function waitIdle(page, ms, autoApprove) {
  const t0 = Date.now();
  await page.waitForTimeout(1500);
  while (Date.now() - t0 < (ms || 60000)) {
    if (autoApprove !== false) { const b = await page.$('.permission-card button'); if (b) await b.click().catch(() => {}); }
    if (!(await page.isVisible('#btn-stop'))) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
async function send(page, text) { await page.fill('#composer-input', text); await page.press('#composer-input', 'Enter'); }
async function messages(page) { return page.evaluate(() => window.Api.getMessages(window.CordovalApp.sessionId())); }
function shot(page, name) { return page.screenshot({ path: path.join(SHOTS, name) }); }

// Prints one PASS/FAIL line per check and sets the exit code.
function report(name, checks, extra) {
  let ok = true;
  for (const [label, pass] of Object.entries(checks)) { if (!pass) ok = false; console.log('  ' + (pass ? 'ok  ' : 'FAIL') + ' ' + label); }
  if (extra) console.log('  info', JSON.stringify(extra).slice(0, 600));
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  process.exitCode = ok ? 0 : 1;
  return ok;
}

module.exports = { ROOT, SHOTS, tmp, launch, waitIdle, send, messages, shot, report };

'use strict';

const crypto = require('crypto');
const http = require('http');
const net = require('net');
const { shell } = require('electron');

const AUTH_ENDPOINT = 'https://openrouter.ai/auth';
const KEYS_ENDPOINT = 'https://openrouter.ai/api/v1/auth/keys';
const CALLBACK_PATH = '/callback';
const TIMEOUT_MS = 5 * 60 * 1000;

let inFlight = false;

function base64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function page(title, message) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><style>' +
    'body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:system-ui,sans-serif;background:#F4F2FB;color:#1B1830}' +
    'main{background:#FFFFFF;border:1px solid #E3DEF5;border-radius:12px;' +
    'padding:32px;max-width:420px;text-align:center}' +
    'h1{font-size:18px;margin:0 0 8px}' +
    'p{margin:0;font-size:14px;line-height:1.5;color:#4A4663}' +
    '.accent{color:#0A5CFF}' +
    '</style></head><body><main><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(message) + '</p></main></body></html>'
  );
}

function send(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

function requestCode({ port, callbackUrl, challenge }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const server = http.createServer((req, res) => {
      let parsed;
      try {
        parsed = new URL(req.url, callbackUrl);
      } catch (err) {
        send(res, 400, page('Sign-in failed', 'Malformed callback request.'));
        return;
      }
      if (parsed.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const error = parsed.searchParams.get('error');
      const description = parsed.searchParams.get('error_description');
      const code = parsed.searchParams.get('code');
      if (error || !code) {
        send(res, 200, page('Sign-in failed', description || error || 'No authorization code was returned.'));
        finish(new Error('OpenRouter sign-in failed: ' + (description || error || 'no code returned')));
        return;
      }
      send(res, 200, page('Signed in', 'Return to Cordoval Code. You can close this tab.'));
      finish(null, code);
    });

    function finish(err, value) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close(() => {});
      if (err) reject(err);
      else resolve(value);
    }

    server.once('error', err => finish(new Error('Local callback server failed: ' + err.message)));
    server.listen(port, '127.0.0.1', () => {
      const url =
        AUTH_ENDPOINT +
        '?callback_url=' + encodeURIComponent(callbackUrl) +
        '&code_challenge=' + encodeURIComponent(challenge) +
        '&code_challenge_method=S256';
      Promise.resolve(shell.openExternal(url)).catch(err => {
        finish(new Error('Could not open the browser: ' + (err && err.message ? err.message : 'unknown error')));
      });
    });

    timer = setTimeout(() => {
      finish(new Error('OpenRouter sign-in timed out.'));
    }, TIMEOUT_MS);
  });
}

async function exchangeCode(code, verifier) {
  let res;
  try {
    res = await fetch(KEYS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    });
  } catch (err) {
    throw new Error('Could not reach OpenRouter: ' + (err && err.message ? err.message : 'network error'));
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      if (typeof body === 'string') detail = body;
      else if (body && typeof body.error === 'string') detail = body.error;
      else if (body && body.error && typeof body.error.message === 'string') detail = body.error.message;
      else if (body && typeof body.message === 'string') detail = body.message;
    } catch (err) {
      // no parseable body
    }
    throw new Error('OpenRouter key exchange failed (' + res.status + ')' + (detail ? ': ' + String(detail).slice(0, 200) : '.'));
  }
  const data = await res.json().catch(() => null);
  const key = data && data.key;
  if (typeof key !== 'string' || !key) throw new Error('OpenRouter key exchange failed: no key returned.');
  return key;
}

async function openrouterSignIn(options) {
  const opts = options || {};
  if (inFlight) throw new Error('An OpenRouter sign-in is already in progress.');
  inFlight = true;
  try {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    const port = await freePort();
    const callbackUrl = 'http://127.0.0.1:' + port + CALLBACK_PATH;
    const code = await requestCode({ port, callbackUrl, challenge });
    const key = await exchangeCode(code, verifier);
    if (typeof opts.storeKey === 'function') opts.storeKey('openrouter', key);
    return { ok: true };
  } finally {
    inFlight = false;
  }
}

module.exports = { openrouterSignIn };

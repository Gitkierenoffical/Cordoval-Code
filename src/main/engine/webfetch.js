'use strict';
// Fetches a public web page as markdown, text or raw HTML, with size and time limits.
// Requests carry no keys or cookies, never go to this machine or a private network, and every
// new website (including a redirect to one) goes through the permission check.
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_CHARS = 100000;

function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function checkHost(url, opts) {
  if (opts && opts.allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$/i.test(host) || host.endsWith('.localhost')) throw new Error('Fetching from this computer is not allowed.');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some(a => privateAddress(a.address))) throw new Error('Fetching from a local or private network address is not allowed.');
}

function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
}
function htmlToMarkdown(html) {
  let s = String(html);
  s = s.replace(/<(script|style|noscript|svg|head|iframe|template)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => '\n\n' + '#'.repeat(Number(n)) + ' ' + t.trim() + '\n\n');
  s = s.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, t) => { const txt = t.replace(/<[^>]+>/g, '').trim(); return txt ? '[' + txt + '](' + href + ')' : ''; });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (m, t) => '\n\n```\n' + t.replace(/<[^>]+>/g, '') + '\n```\n\n');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|section|article|ul|ol|table|tr|blockquote|header|footer|nav|main)>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ask(host) resolves when the user (or a rule) allows that website.
async function fetchUrl(input, ask, opts) {
  opts = opts || {};
  let url;
  try { url = new URL(String(input.url || '')); } catch (e) { throw new Error('That is not a valid URL.'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https URLs can be fetched.');
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed.');
  const timeout = Math.min(Math.max(Number(input.timeout) || 30, 1), 120) * 1000;
  const format = ['markdown', 'text', 'html'].includes(input.format) ? input.format : 'markdown';
  const signal = AbortSignal.any ? AbortSignal.any([AbortSignal.timeout(timeout), ...(opts.signal ? [opts.signal] : [])]) : AbortSignal.timeout(timeout);
  const asked = new Set();
  let res;
  for (let hop = 0; hop < 6; hop++) {
    if (!asked.has(url.host)) { await ask(url.host, url.href); asked.add(url.host); }
    await checkHost(url, opts);
    res = await fetch(url, { redirect: 'manual', signal, headers: { 'user-agent': 'CordovalCode/0.9 (+web fetch tool)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }, credentials: 'omit' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      if (!/^https?:$/.test(url.protocol)) throw new Error('Redirected to an unsupported URL.');
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error('The site returned ' + res.status + ' ' + res.statusText + '.');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('The page is too large (' + len + ' bytes; limit ' + MAX_BYTES + ').');
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { try { reader.cancel(); } catch (e) {} throw new Error('The page is larger than ' + MAX_BYTES + ' bytes.'); }
    chunks.push(value);
  }
  const type = res.headers.get('content-type') || '';
  const raw = Buffer.concat(chunks).toString('utf8');
  let out = raw;
  if (/html/i.test(type) && format !== 'html') out = format === 'markdown' ? htmlToMarkdown(raw) : htmlToMarkdown(raw).replace(/[#*`]|\[([^\]]*)\]\([^)]*\)/g, '$1');
  if (out.length > MAX_CHARS) out = out.slice(0, MAX_CHARS) + '\n... (cut at ' + MAX_CHARS + ' characters)';
  return { url: url.href, contentType: type, bytes: size, text: out };
}

module.exports = { fetchUrl, htmlToMarkdown, privateAddress };

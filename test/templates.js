// Creates projects from templates through the UI and waits for the agent to finish.
// Usage: TEMPLATES=react-vite,electron,android-compose MODEL=opencode/mimo-v2.6-flash-free xvfb-run -a node test/templates.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const shots = path.join(__dirname, '..', 'screenshots');
const parent = process.env.PARENT || '/tmp/cc-templates';
fs.mkdirSync(parent, { recursive: true });
const ids = (process.env.TEMPLATES || 'react-vite').split(',');
const log = (...a) => console.log('[tpl]', ...a);
(async () => {
  for (const id of ids) {
    const name = id + '-' + Date.now().toString(36);
    const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox'] });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await page.waitForTimeout(6000);
    await page.click('#btn-welcome-template');
    await page.click(`.template-item[data-id="${id}"]`);
    await page.fill('#template-name', name);
    await page.evaluate((p) => { const i = document.getElementById('template-parent'); i.removeAttribute('readonly'); i.value = p; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }, parent);
    await page.click('#btn-template-create');
    const t0 = Date.now(); let done = false;
    await page.waitForTimeout(8000);
    while (Date.now() - t0 < (Number(process.env.TIMEOUT_MS) || 900000)) {
      const b = await page.$('.permission-card button'); if (b) await b.click().catch(() => {});
      if (!(await page.isVisible('#btn-stop'))) { done = true; break; }
      await page.waitForTimeout(5000);
    }
    const dir = path.join(parent, name);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const err = await page.$$eval('.message-error, .error', es => es.map(e => e.textContent).join(' | ')).catch(() => '');
    log(id, 'done=' + done, 'secs=' + Math.round((Date.now() - t0) / 1000), 'dir=' + dir, 'files=' + files.join(','), err ? 'errors=' + err.slice(0, 300) : '');
    await page.screenshot({ path: path.join(shots, `20-template-${id}.png`) });
    await app.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

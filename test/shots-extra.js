// Welcome screen + templates dialog screenshots. Set EXE to test a packaged build.
const { _electron: electron } = require('playwright-core');
const path = require('path');
(async () => {
  const exe = process.env.EXE;
  const app = await electron.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox'] });
  const page = await app.firstWindow();
  await page.waitForTimeout(7000);
  const pre = process.env.PREFIX || '';
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', pre + '00-welcome.png') });
  await page.click('#btn-welcome-template'); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', pre + '08-templates.png') });
  console.log('status', await page.textContent('#status-engine'));
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });

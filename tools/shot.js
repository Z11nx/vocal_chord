// needs playwright; serve the folder or use file://. usage: node tools/shot.js out.png [width height] [js-to-eval]
const { chromium } = require('playwright');
(async () => {
  const [out, w = 1440, h = 1100, js = ''] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/index.html');
  await p.waitForTimeout(600);
  if (js) { await p.evaluate(js); await p.waitForTimeout(900); }
  await p.screenshot({ path: out, fullPage: true });
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
  await b.close();
})();

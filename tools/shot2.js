// Screenshot while singing. usage: node tools/shot2.js out.png vowel [width height] [extra-js]
const { chromium } = require('playwright');
(async () => {
  const [out, vowel = 'a', w = 1440, h = 1100, extra = ''] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.click('#power');
  await p.waitForTimeout(500);
  await p.evaluate((v) => window.vocalChord.setVowel(v), vowel);
  if (extra) await p.evaluate(extra);
  await p.keyboard.down('h');
  await p.waitForTimeout(1600);
  await p.screenshot({ path: out });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close();
})();

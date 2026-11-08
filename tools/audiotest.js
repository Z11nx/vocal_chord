// Starts the app in headless Chromium, sings, and reports the engine meter.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/index.html');
  await p.click('#power');
  await p.waitForTimeout(800);
  const res = {};
  for (const v of ['i', 'a', 'u', 'hum']) {
    await p.evaluate((v) => { window.vocalChord.setVowel(v); }, v);
    await p.keyboard.down('a');
    await p.waitForTimeout(500);
    res[v] = await p.evaluate(() => ({ ready: window.vocalChord.audio.ready, state: window.vocalChord.audio.ctx.state, rms: +window.vocalChord.audio.meter.rms.toFixed(4), f: Math.round(window.vocalChord.audio.meter.freq) }));
    await p.keyboard.up('a');
    await p.waitForTimeout(250);
  }
  res.silentAfterRelease = await p.evaluate(() => +window.vocalChord.audio.meter.rms.toFixed(4));
  await p.click('#seqPlay');
  await p.waitForTimeout(1500);
  res.sequencer = await p.evaluate(() => +window.vocalChord.audio.meter.rms.toFixed(4));
  res.mode = await p.evaluate(() => window.vocalChord.audio.mode); console.log(JSON.stringify(res));
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
  await b.close();
})();

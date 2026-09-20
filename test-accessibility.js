import puppeteer from 'puppeteer';

const baseUrl = process.env.AJN_TEST_URL || 'http://localhost:3000';
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
const page = await browser.newPage();
try {
  await page.goto(baseUrl,{waitUntil:'networkidle2',timeout:30000});
  const result = await page.evaluate(() => {
    const interactive=[...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')];
    const unnamed=interactive.filter(el=>!(el.textContent||'').trim()&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!el.getAttribute('title'));
    const missingAlt=[...document.images].filter(img=>!img.hasAttribute('alt'));
    return {unnamed:unnamed.length,missingAlt:missingAlt.length};
  });
  console.log(`[a11y] unnamed interactive: ${result.unnamed}`);
  console.log(`[a11y] images without alt: ${result.missingAlt}`);
  if(result.unnamed||result.missingAlt) throw new Error('Accessibility structural smoke failed');
  console.log('Accessibility structural smoke: PASS');
} finally { await browser.close(); }

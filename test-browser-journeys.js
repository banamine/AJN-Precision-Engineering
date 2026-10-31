import puppeteer from 'puppeteer';

const baseUrl = process.env.AJN_TEST_URL || 'http://localhost:3000';
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
const routes=[['','home'],['#library','library'],['#tv-guide','guide'],['#search','search'],['#player','player']];
try {
  for(const [hash,name] of routes){
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(baseUrl+'/'+hash,{waitUntil:'networkidle2',timeout:30000});
    if(errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
    console.log(`[journey] ${name}: PASS`);
    await page.close();
  }
  console.log('Browser critical-route smoke: PASS');
} finally { await browser.close(); }

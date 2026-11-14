const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('https://achero-plant-3d.vercel.app');
  await page.waitForLoadState('networkidle');
  const elements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, select, input, [role="button"]')).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: (el.innerText || el.value || el.title || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
      className: el.className
    }));
  });
  console.log('Total interactive elements:', elements.length);
  for (const e of elements) {
    if (e.text) console.log(`[${e.tag}] "${e.text}" class: ${e.className}`);
  }
  await browser.close();
})();

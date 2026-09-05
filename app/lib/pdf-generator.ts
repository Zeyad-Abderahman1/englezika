import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

type AccessCodeRow = {
  id: string;
  suffix: string;
  fullCode: string;
  videoTitle?: string;
};

const ARABIC_FONT_PATH = path.join(process.cwd(), 'fonts', 'NotoSansArabic-Regular.ttf');

function loadFontBase64(): string {
  const fontBytes = fs.readFileSync(ARABIC_FONT_PATH);
  return fontBytes.toString('base64');
}

function buildHTML(codes: AccessCodeRow[], fontBase64: string): string {
  const cards = codes
    .map(
      (c) => `
      <div class="card">
        <div class="code" dir="ltr">${escapeHtml(c.fullCode)}</div>
        ${c.videoTitle ? `<div class="name" dir="rtl" lang="ar">${escapeHtml(c.videoTitle)}</div>` : ''}
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<style>
  @font-face {
    font-family: 'NotoSansArabic';
    src: url(data:font/truetype;base64,${fontBase64}) format('truetype');
    font-weight: 400 700;
    font-style: normal;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  @page {
    size: A4;
    margin: 20mm;
  }

  body {
    font-family: 'NotoSansArabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    direction: rtl;
    background: #fff;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    width: 100%;
  }

  .card {
    border: 1px solid #000;
    border-radius: 4px;
    padding: 14px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 72px;
    background: #fff;
    page-break-inside: avoid;
    overflow: hidden;
  }

  .code {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.2px;
    text-align: center;
    direction: ltr;
    unicode-bidi: isolate;
    white-space: nowrap;
    color: #000;
    line-height: 1.3;
  }

  .name {
    font-family: 'NotoSansArabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    direction: rtl;
    unicode-bidi: isolate;
    color: #000;
    margin-top: 6px;
    line-height: 1.4;
    word-break: break-word;
  }
</style>
</head>
<body>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  throw new Error(
    'Chrome/Chromium not found. Install Chrome or set CHROME_PATH env var. ' +
    'Production deployment requires Chrome/Chromium installed on the server.'
  );
}

/**
 * Generate a printable PDF of access codes using Puppeteer + HTML/CSS.
 * Arabic renders natively via the browser engine using the bundled local font.
 */
export async function generateAccessCodePDF(
  codes: AccessCodeRow[],
  _options?: { title?: string }
): Promise<Buffer> {
  const fontBase64 = loadFontBase64();
  const html = buildHTML(codes, fontBase64);
  const executablePath = findChrome();

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

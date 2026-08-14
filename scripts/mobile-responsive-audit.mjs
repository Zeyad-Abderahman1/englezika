import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.MOBILE_QA_BASE_URL || 'http://127.0.0.1:3000';
const outputDir = new URL('../docs/uiux/mobile/', import.meta.url);
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const teacherEmail = process.env.MOBILE_QA_TEACHER_EMAIL;
const teacherPassword = process.env.MOBILE_QA_TEACHER_PASSWORD;
const studentEmail = process.env.MOBILE_QA_STUDENT_EMAIL;
const studentPassword = process.env.MOBILE_QA_STUDENT_PASSWORD;
const courseId = process.env.MOBILE_QA_COURSE_ID;
const examId = process.env.MOBILE_QA_EXAM_ID;
const attemptId = process.env.MOBILE_QA_ATTEMPT_ID;

for (const [name, value] of Object.entries({ teacherEmail, teacherPassword, studentEmail, studentPassword, courseId, examId, attemptId })) {
  if (!value) throw new Error(`Missing ${name} mobile QA environment value`);
}

await mkdir(outputDir, { recursive: true });
const profileDir = await mkdtemp(join(tmpdir(), 'englizeka-mobile-qa-'));
const port = 9320 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function endpoint(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`Chrome endpoint failed: ${response.status}`);
  return response.json();
}

let version;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    version = await endpoint('/json/version');
    break;
  } catch {
    await delay(100);
  }
}
if (!version?.webSocketDebuggerUrl) throw new Error('Chrome DevTools endpoint did not start');

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.loadingFailed' && !message.params.canceled) failedRequests.push(message.params.errorText);
});

function send(method, params = {}, sessionId) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await Promise.all([
  send('Page.enable', {}, sessionId),
  send('Runtime.enable', {}, sessionId),
  send('Network.enable', {}, sessionId),
]);

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function navigate(path, setupExpression = '') {
  await send('Page.navigate', { url: `${base}${path}` }, sessionId);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate('document.readyState === "complete"')) break;
    await delay(50);
  }
  await delay(300);
  // Next's document load can finish before authenticated client fetches resolve.
  // Wait for route-level loading states so screenshots and measurements cover the
  // real dashboard/course/exam UI instead of a transient spinner. The secure
  // lesson video has its own independent loader, so it is intentionally excluded.
  if (!path.startsWith('/learn/')) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const routeIsSettled = await evaluate(`(() => {
        const spinner = [...document.querySelectorAll('.spin')].find((item) => {
          const rect = item.getBoundingClientRect();
          const style = getComputedStyle(item);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        return !spinner;
      })()`);
      if (routeIsSettled) break;
      await delay(50);
    }
  }
  if (setupExpression) {
    await evaluate(setupExpression);
    await delay(600);
  }
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
    positionX: 0,
    positionY: 0,
    screenOrientation: width > height
      ? { type: 'landscapePrimary', angle: 90 }
      : { type: 'portraitPrimary', angle: 0 },
  }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
}

const diagnosticsExpression = `(() => {
  const root = document.documentElement;
  const clientWidth = root.clientWidth;
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const hiddenDrawer = (el) => el.closest('.student-sidebar:not(.is-open), .admin-sidebar:not(.admin-sidebar--open), .nav-menu:not(.is-open)');
  const offenders = [...document.querySelectorAll('body *')].filter((el) => {
    if (!visible(el) || hiddenDrawer(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.right > clientWidth + 1 || rect.left < -1;
  }).slice(0, 20).map((el) => {
    const rect = el.getBoundingClientRect();
    return { tag: el.tagName, className: String(el.className).slice(0, 100), text: (el.textContent || '').trim().slice(0, 70), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
  });
  const smallTargets = [...document.querySelectorAll('button, [role="button"], a.btn, .icon-button, .menu-toggle, input, select, textarea')].filter((el) => {
    if (!visible(el) || hiddenDrawer(el)) return false;
    if (el.matches('input[type="radio"], input[type="checkbox"]') && el.closest('label')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width < 44 || rect.height < 44;
  }).slice(0, 30).map((el) => {
    const rect = el.getBoundingClientRect();
    return { tag: el.tagName, className: String(el.className).slice(0, 80), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60), width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  return {
    innerWidth,
    clientWidth,
    scrollWidth: root.scrollWidth,
    overflow: root.scrollWidth > clientWidth,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    direction: getComputedStyle(document.body).direction,
    theme: root.dataset.theme,
    offenders,
    smallTargets,
  };
})()`;

async function scrollTopToBottom() {
  await evaluate(`(async () => {
    const step = Math.max(240, innerHeight * .75);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    scrollTo(0, 0);
    return true;
  })()`);
}

async function screenshot(name) {
  const { contentSize } = await send('Page.getLayoutMetrics', {}, sessionId);
  const height = Math.min(Math.ceil(contentSize.height), 16000);
  const width = Math.ceil(contentSize.width);
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  }, sessionId);
  await writeFile(new URL(`${name}.png`, outputDir), Buffer.from(result.data, 'base64'));
}

async function ensureTheme(expected) {
  let theme = await evaluate('document.documentElement.dataset.theme');
  if (theme === expected) return theme;
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label')?.includes('الوضع'));
    if (button) button.click();
    return Boolean(button);
  })()`);
  await delay(180);
  theme = await evaluate('document.documentElement.dataset.theme');
  return theme;
}

const widths = [320, 360, 390, 430];
const results = [];
const surfaces = [
  { name: 'home', path: '/' },
  { name: 'courses', path: '/courses' },
  { name: 'course-details', path: `/course/${courseId}` },
  { name: 'login', path: '/login' },
  { name: 'registration', path: '/register' },
  { name: 'staff-login', path: '/staff/login' },
];

async function auditSurface(surface, width, height = 844, orientation = 'portrait') {
  await setViewport(width, height);
  await navigate(surface.path, surface.setup || '');
  await scrollTopToBottom();
  const metrics = await evaluate(diagnosticsExpression);
  const filename = `${surface.name}-${width}x${height}-${orientation}`;
  await screenshot(filename);
  results.push({ surface: surface.name, path: surface.path, width, height, orientation, url: await evaluate('location.href'), ...metrics });
}

try {
  for (const width of widths) {
    for (const surface of surfaces) {
      await auditSurface(surface, width);
      if (width === 320 && surface.name === 'home') {
        await evaluate(`(() => {
          const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'قبول جميع الكوكيز');
          button?.click();
          return Boolean(button);
        })()`);
        await delay(180);
      }
    }
  }

  await navigate('/login');
  const studentLogin = await evaluate(`fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ email: studentEmail, password: studentPassword })}) }).then(async (response) => ({ ok: response.ok, status: response.status, body: await response.text() }))`);
  if (!studentLogin.ok) throw new Error(`Student login failed: ${studentLogin.status} ${studentLogin.body}`);

  const studentSurfaces = [
    { name: 'student-dashboard', path: '/account' },
    { name: 'profile', path: '/account', setup: `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('بيانات الحساب')); b?.click(); return Boolean(b); })()` },
    { name: 'lesson', path: `/learn/${courseId}` },
    { name: 'exam', path: `/exam/${examId}` },
    { name: 'results', path: `/result/${attemptId}` },
  ];
  for (const surface of [
    { name: 'lesson-landscape', path: `/learn/${courseId}` },
    { name: 'exam-landscape', path: `/exam/${examId}` },
  ]) await auditSurface(surface, 844, 390, 'landscape');
  for (const width of widths) for (const surface of studentSurfaces) await auditSurface(surface, width);

  await navigate('/staff/login');
  const staffLogin = await evaluate(`fetch('/api/staff/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ email: teacherEmail, password: teacherPassword })}) }).then(async (response) => ({ ok: response.ok, status: response.status, body: await response.text() }))`);
  if (!staffLogin.ok) throw new Error(`Staff login failed: ${staffLogin.status} ${staffLogin.body}`);

  const adminSurfaces = [
    { name: 'admin-dashboard', path: '/admin', setup: `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='نظرة عامة'); b?.click(); return Boolean(b); })()` },
    { name: 'admin-courses', path: '/admin', setup: `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='الكورسات'); b?.click(); return Boolean(b); })()` },
    { name: 'admin-exams', path: '/admin', setup: `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='الامتحانات'); b?.click(); return Boolean(b); })()` },
    { name: 'admin-students', path: '/admin', setup: `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='الطلاب'); b?.click(); return Boolean(b); })()` },
  ];
  await auditSurface({ name: 'admin-students-landscape', path: '/admin', setup: adminSurfaces[3].setup }, 844, 390, 'landscape');
  for (const width of widths) for (const surface of adminSurfaces) await auditSurface(surface, width);

  const themeSurfaces = [...surfaces.slice(0, 3), ...studentSurfaces, ...adminSurfaces];
  await setViewport(390, 844);
  for (const surface of themeSurfaces) {
    await navigate(surface.path, surface.setup || '');
    const light = await ensureTheme('light');
    const lightMetrics = await evaluate(diagnosticsExpression);
    const dark = await ensureTheme('dark');
    const darkMetrics = await evaluate(diagnosticsExpression);
    results.push({ surface: surface.name, themeCheck: true, light, dark, lightOverflow: lightMetrics.overflow, darkOverflow: darkMetrics.overflow });
  }

  const regressionSurfaces = [
    { name: 'regression-home', path: '/' },
    { name: 'regression-courses', path: '/courses' },
    { name: 'regression-lesson', path: `/learn/${courseId}` },
    { name: 'regression-exam', path: `/exam/${examId}` },
    { name: 'regression-admin-students', path: '/admin', setup: adminSurfaces[3].setup },
  ];
  for (const [width, height] of [[768, 1024], [1024, 1366], [1366, 768], [1440, 900], [1920, 1080]]) {
    for (const surface of regressionSurfaces) await auditSurface(surface, width, height, 'regression');
  }

  await writeFile(new URL('mobile-audit-results.json', outputDir), JSON.stringify({ results, consoleErrors, failedRequests }, null, 2));
  const failures = results.filter((item) => item.overflow || item.clientWidth && item.clientWidth !== item.width || item.orientation !== 'regression' && item.smallTargets?.length);
  console.log(JSON.stringify({ total: results.length, failures, consoleErrors, failedRequests }, null, 2));
  if (failures.some((item) => item.overflow || item.clientWidth && item.clientWidth !== item.width)) process.exitCode = 1;
} finally {
  socket.close();
  chrome.kill();
  await delay(500);
  const resolvedTemp = profileDir.toLowerCase();
  const resolvedRoot = tmpdir().toLowerCase();
  if (resolvedTemp.startsWith(resolvedRoot) && resolvedTemp.includes('englizeka-mobile-qa-')) {
    try {
      await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(`Temporary Chrome profile cleanup deferred: ${error.message}`);
    }
  }
}

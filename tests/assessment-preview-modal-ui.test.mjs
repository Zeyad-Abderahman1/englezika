import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import test, { after, before, describe } from 'node:test';
import puppeteer from 'puppeteer-core';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer, { act } from 'react-test-renderer';
import { AssessmentPreviewModal } from '../app/components/admin/ai/AssessmentPreviewModal.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.HTMLElement = class HTMLElement {};
globalThis.document = {
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
};

const exactOptions = [
  'The letter was written by Ali.',
  'Ali wrote the letter.',
  'The letter writes Ali.',
  'Ali was written by the letter.',
];

const assessment = {
  previewId: 'preview_ui_regression',
  title: 'Passive Voice Assessment',
  examType: 'quiz',
  questionCount: 1,
  questions: [{
    id: 'q_1',
    prompt: 'Which sentence is in the passive voice?',
    options: exactOptions,
    correctIndex: 0,
    correctAnswer: exactOptions[0],
  }],
  coverage: {
    mode: 'range',
    courseTitle: 'English Grade 10',
    startLectureId: 'lec_3',
    endLectureId: 'lec_7',
    startLectureTitle: 'المحاضرة 3 - Past Simple',
    endLectureTitle: 'المحاضرة 7 - Passive Voice',
    sourceFileName: 'unit-one.pdf',
  },
};

const props = {
  assessment,
  isOpen: true,
  onClose() {},
  async onSaveToCourse() {},
};

function resolveChromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert.ok(executable, 'Chrome/Chromium is required; set PUPPETEER_EXECUTABLE_PATH when it is not installed in a standard location.');
  return executable;
}

describe('AssessmentPreviewModal UI regression', () => {
  test('renders all exact options in editable controls and all assessment metadata', () => {
    const html = renderToStaticMarkup(React.createElement(AssessmentPreviewModal, props));

    for (const option of exactOptions) {
      assert.match(html, new RegExp(`value="${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    }
    assert.match(html, /English Grade 10/);
    assert.match(html, /المحاضرة 3 - Past Simple/);
    assert.match(html, /المحاضرة 7 - Passive Voice/);
    assert.match(html, /unit-one\.pdf/);
    assert.match(html, /Quiz/);
    assert.match(html, /عدد الأسئلة:<\/span><span class="ai-meta-val">1/);
  });

  test('clearing an option disables confirmation and selecting a radio updates correctAnswer', async () => {
    let savedQuestions;
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(AssessmentPreviewModal, {
        ...props,
        async onSaveToCourse(questions) { savedQuestions = questions; },
      }), { createNodeMock: () => ({ focus() {} }) });
    });

    const root = renderer.root;
    const optionInputs = root.findAll((node) => node.type === 'input' && node.props.className === 'ai-option-input');
    const confirm = () => root.findAllByType('button').find((button) =>
      button.findAll((node) => node.type === 'span' && String(node.children.join('')).includes('تأكيد وإدراج')).length > 0
    );

    assert.deepEqual(optionInputs.map((input) => input.props.value), exactOptions);
    assert.equal(confirm().props.disabled, false);

    await act(async () => optionInputs[1].props.onChange({ target: { value: '' } }));
    assert.equal(confirm().props.disabled, true);

    await act(async () => optionInputs[1].props.onChange({ target: { value: exactOptions[1] } }));
    const radios = root.findAll((node) => node.type === 'input' && node.props.type === 'radio');
    await act(async () => radios[1].props.onChange());
    await act(async () => confirm().props.onClick());

    assert.equal(savedQuestions[0].correctIndex, 1);
    assert.equal(savedQuestions[0].correctAnswer, exactOptions[1]);
    await act(async () => renderer.unmount());
  });
});

describe('AssessmentPreviewModal browser layout', () => {
  let browser;
  before(async () => {
    browser = await puppeteer.launch({
      executablePath: resolveChromeExecutable(),
      headless: true,
    });
  });
  after(async () => browser?.close());

  for (const width of [1649, 767, 390]) {
    test(`keeps the radio compact and option text visible at ${width}px`, async (context) => {
      const page = await browser.newPage();
      await page.setViewport({ width, height: width === 390 ? 844 : 911 });
      const [globalCss, assistantCss] = await Promise.all([
        readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
        readFile(new URL('../app/components/admin/ai/ai-assistant.css', import.meta.url), 'utf8'),
      ]);
      const html = renderToStaticMarkup(React.createElement(AssessmentPreviewModal, props));
      await page.setContent(`<style>${globalCss}\n${assistantCss}</style><main class="admin-main">${html}</main>`);

      const measurements = await page.evaluate(() => {
        const row = document.querySelector('.ai-option-row');
        const radio = row.querySelector('input[type="radio"]');
        const input = row.querySelector('.ai-option-input');
        const style = getComputedStyle(input);
        const shellStyle = getComputedStyle(document.querySelector('.ai-modal-overlay'));
        const radioRect = radio.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        return {
          rowWidth: row.getBoundingClientRect().width,
          radioWidth: radioRect.width,
          radioTop: radioRect.top,
          inputWidth: inputRect.width,
          inputTop: inputRect.top,
          inputValue: input.value,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          overflow: style.overflow,
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontSize: style.fontSize,
          direction: style.direction,
          shellDirection: shellStyle.direction,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          padding: style.padding,
          position: style.position,
          zIndex: style.zIndex,
        };
      });

      assert.equal(measurements.inputValue, exactOptions[0]);
      assert.equal(measurements.shellDirection, 'rtl');
      assert.equal(measurements.direction, 'ltr');
      assert.ok(measurements.radioWidth <= 24, JSON.stringify(measurements));
      assert.ok(measurements.inputWidth >= Math.min(280, measurements.rowWidth * 0.55), JSON.stringify(measurements));
      assert.ok(Math.abs(measurements.radioTop - measurements.inputTop) <= 14, JSON.stringify(measurements));
      if (process.env.CAPTURE_ASSESSMENT_PREVIEW === '1' && (width === 1649 || width === 390)) {
        const evidenceDirectory = new URL('../docs/uiux/after/', import.meta.url);
        await mkdir(evidenceDirectory, { recursive: true });
        await page.screenshot({
          path: new URL(`assessment-preview-${width}px.png`, evidenceDirectory).pathname.slice(1),
          fullPage: true,
        });
      }
      context.diagnostic(`${width}px measurements: ${JSON.stringify(measurements)}`);
      await page.close();
    });
  }
});

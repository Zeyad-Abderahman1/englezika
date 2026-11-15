import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';

const ocr = await import('../app/lib/exam-ocr.ts');
const merge = await import('../app/lib/exam-ocr-merge.ts');
const insert = await import('../app/lib/exam-questions-insert.ts');

const noSleep = async () => {};

// ── A fake "exam" and a fake Gemini that reads the pages it is sent ───────────

function makeQuestion(n, overrides = {}) {
  return {
    temp_id: '',
    type: 'multiple_choice',
    prompt: `Question ${n} stem about topic ${n}`,
    options: [`alpha ${n}`, `beta ${n}`, `gamma ${n}`, `delta ${n}`],
    correct_answer: `alpha ${n}`,
    source_number: n,
    cut_off: 'none',
    explanation: '',
    points: 1,
    ...overrides,
  };
}

/** pages[i] = array of raw questions printed on page i. Images carry the page index in `data`. */
function buildExam(totalQuestions, perPage = 10) {
  const pages = [];
  for (let n = 1; n <= totalQuestions; n += perPage) {
    pages.push(Array.from({ length: Math.min(perPage, totalQuestions - n + 1) }, (_, i) => makeQuestion(n + i)));
  }
  return pages;
}

const pageImages = (count) => Array.from({ length: count }, (_, i) => ({ data: `P${i}`, mimeType: 'image/png' }));

function geminiResponse(payload, finishReason = 'STOP') {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 });
}

/**
 * Fake model. `behave(call)` may return a Response to override the default behaviour
 * (default = answer correctly with every question on the pages in the request).
 */
function makeFakeModel(pages, behave) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const parts = body.contents[0].parts;
    const pageIds = parts.filter((part) => part.inlineData).map((part) => Number(part.inlineData.data.slice(1)));
    const continuation = parts.map((part) => part.text || '').find((text) => text.includes('cut off after'));
    const call = { pageIds, continuation: Boolean(continuation), index: calls.length };
    calls.push(call);

    const override = behave?.(call, pages);
    if (override) return override;

    let questions = pageIds.flatMap((id) => pages[id]);
    if (continuation) {
      const already = Number(continuation.match(/cut off after (\d+) complete/)[1]);
      questions = questions.slice(already);
    }
    return geminiResponse({ questions });
  };
  return { fetchImpl, calls };
}

const runtime = (fetchImpl) => ({ fetchImpl, sleep: noSleep });
const numbers = (questions) => questions.map((question) => question.source_number);

describe('batch planning', () => {
  test('windows cover every page with the requested overlap, for any page count', () => {
    for (const pages of [1, 2, 3, 4, 5, 8, 17, 100, 333]) {
      const windows = merge.planBatches(pages);
      const covered = new Set();
      for (const window of windows) {
        assert.ok(window.end - window.start <= merge.OCR_BATCH_SIZE);
        for (let page = window.start; page < window.end; page++) covered.add(page);
      }
      assert.equal(covered.size, pages, `pages=${pages}`);
      for (let i = 1; i < windows.length; i++) {
        assert.ok(windows[i].start < windows[i - 1].end, 'consecutive windows overlap');
      }
    }
    assert.deepEqual(merge.planBatches(0), []);
  });
});

describe('extraction scales to any question count', () => {
  test('75 questions over several batches: none dropped, ordered, renumbered, no warnings', async () => {
    const pages = buildExam(75);
    assert.equal(pages.length, 8);
    const model = makeFakeModel(pages);
    const result = await ocr.extractExamFromPages(pageImages(pages.length), 'test-key', { runtime: runtime(model.fetchImpl) });

    assert.equal(result.ok, true);
    assert.equal(result.questions.length, 75);
    assert.deepEqual(numbers(result.questions), Array.from({ length: 75 }, (_, i) => i + 1));
    assert.deepEqual(
      result.questions.map((question) => question.sort_order),
      Array.from({ length: 75 }, (_, i) => i + 1)
    );
    assert.equal(result.warnings.length, 0);
    assert.ok(model.calls.length >= 4, 'several model calls, not one giant response');
    assert.ok(model.calls.every((call) => call.pageIds.length <= merge.OCR_BATCH_SIZE));
  });

  test('300 questions: no hidden cap anywhere in extraction or merge', async () => {
    const pages = buildExam(300);
    const model = makeFakeModel(pages);
    const result = await ocr.extractExamFromPages(pageImages(pages.length), 'test-key', { runtime: runtime(model.fetchImpl) });
    assert.equal(result.questions.length, 300);
    assert.deepEqual(numbers(result.questions), Array.from({ length: 300 }, (_, i) => i + 1));
  });

  test('a truncated answer is continued, never dropped', async () => {
    const pages = buildExam(30);
    const model = makeFakeModel(pages, (call) => {
      if (call.index !== 0) return null;
      // First call (pages 0-2): cut the JSON in the middle of question 19.
      const full = JSON.stringify({ questions: pages.flat() });
      return geminiResponse(full.slice(0, full.indexOf('Question 19') + 15), 'MAX_TOKENS');
    });
    const unit = await ocr.extractExamUnit(pageImages(3), 'test-key', runtime(model.fetchImpl));

    assert.equal(unit.recovered, true);
    assert.equal(unit.questions.length, 30);
    assert.deepEqual(numbers(unit.questions), Array.from({ length: 30 }, (_, i) => i + 1));
    assert.ok(model.calls.some((call) => call.continuation), 'a continuation request was made');
  });

  test('an unusable truncated answer on several pages falls back to page-by-page extraction', async () => {
    const pages = buildExam(30);
    const model = makeFakeModel(pages, (call) =>
      call.index === 0 && call.pageIds.length === 3 ? geminiResponse('{"questions": [ {"prompt": "cut', 'MAX_TOKENS') : null
    );
    const unit = await ocr.extractExamUnit(pageImages(3), 'test-key', runtime(model.fetchImpl));
    assert.equal(unit.recovered, true);
    assert.deepEqual(numbers(unit.questions), Array.from({ length: 30 }, (_, i) => i + 1));
    assert.ok(model.calls.filter((call) => call.pageIds.length === 1).length >= 3);
  });

  test('transient errors are retried with backoff; permanent failures are reported per batch', async () => {
    const pages = buildExam(60);
    let transientFailures = 0;
    const model = makeFakeModel(pages, (call) => {
      if (call.index < 2) {
        transientFailures += 1;
        return new Response('busy', { status: 503 });
      }
      // The window covering pages 4-5 is permanently broken.
      if (call.pageIds.includes(5) && call.pageIds.length === 1) return new Response('{}', { status: 400 });
      if (call.pageIds.includes(5)) return new Response('{}', { status: 400 });
      return null;
    });
    const result = await ocr.extractExamFromPages(pageImages(pages.length), 'test-key', {
      runtime: runtime(model.fetchImpl),
      concurrency: 1,
    });

    assert.equal(result.ok, false);
    assert.ok(result.failedBatches.length >= 1);
    assert.ok(result.failedBatches.every((batch) => batch.window.start <= 5 && batch.window.end > 5));
    assert.ok(result.questions.length > 0, 'successful batches are kept');
    assert.equal(transientFailures, 2, 'the first two 503 answers were retried until one succeeded');
  });

  test('duplicates created by the page overlap are removed', async () => {
    const pages = buildExam(40);
    const model = makeFakeModel(pages);
    const result = await ocr.extractExamFromPages(pageImages(4), 'test-key', {
      runtime: runtime(model.fetchImpl),
      batchSize: 2,
      overlap: 1,
    });
    assert.equal(result.questions.length, 40);
    assert.equal(new Set(result.questions.map((question) => question.prompt)).size, 40);
  });

  test('a question split across two pages is stitched into one', () => {
    const left = {
      window: { start: 0, end: 1 },
      questions: [
        makeQuestion(1),
        makeQuestion(2, { prompt: 'Choose the word that best completes the', options: [], correct_answer: '', cut_off: 'end' }),
      ].map((raw) => ocr.normalizeExtractedQuestions([raw])[0]),
    };
    const right = {
      window: { start: 1, end: 2 },
      questions: [
        makeQuestion(2, {
          prompt: 'sentence below',
          options: ['one', 'two', 'three'],
          correct_answer: 'two',
          cut_off: 'start',
        }),
        makeQuestion(3),
      ].map((raw) => ocr.normalizeExtractedQuestions([raw])[0]),
    };
    const merged = merge.mergeBatches([right, left]); // order of arrival must not matter

    assert.equal(merged.questions.length, 3);
    const stitched = merged.questions[1];
    assert.equal(stitched.prompt, 'Choose the word that best completes the sentence below');
    assert.deepEqual(stitched.options, ['one', 'two', 'three']);
    assert.equal(stitched.cut_off, 'none');
    assert.equal(stitched.needs_review, true);
    assert.deepEqual(numbers(merged.questions), [1, 2, 3]);
  });

  test('a numbering gap produces a clear warning with the suspected missing numbers', async () => {
    const pages = buildExam(60).map((page) => page.filter((question) => question.source_number !== 47));
    const model = makeFakeModel(pages);
    const result = await ocr.extractExamFromPages(pageImages(pages.length), 'test-key', { runtime: runtime(model.fetchImpl) });

    assert.equal(result.questions.length, 59);
    const warning = result.warnings.find((item) => item.code === 'MISSING_NUMBERS');
    assert.ok(warning, 'MISSING_NUMBERS warning present');
    assert.deepEqual(warning.numbers, [47]);
    assert.match(warning.message, /47/);
  });

  test('numbering that restarts per section is not reported as missing questions', () => {
    const section = (offset) => Array.from({ length: 10 }, (_, i) => makeQuestion(i + 1, { prompt: `Section ${offset} question ${i + 1}` }));
    const normalize = (list) => ocr.normalizeExtractedQuestions(list);
    const merged = merge.mergeBatches([
      { window: { start: 0, end: 1 }, questions: normalize(section('A')) },
      { window: { start: 1, end: 2 }, questions: normalize(section('B')) },
    ]);
    assert.equal(merged.questions.length, 20);
    assert.equal(merged.warnings.filter((item) => item.code === 'MISSING_NUMBERS').length, 0);
  });

  test('pages that yield nothing are flagged', async () => {
    const pages = buildExam(60);
    pages[3] = [];
    pages[4] = [];
    pages[5] = [];
    const model = makeFakeModel(pages);
    const result = await ocr.extractExamFromPages(pageImages(pages.length), 'test-key', {
      runtime: runtime(model.fetchImpl),
      batchSize: 1,
      overlap: 0,
    });
    assert.ok(result.warnings.some((item) => item.code === 'EMPTY_PAGES'));
  });

  test('salvaging truncated JSON keeps every complete object, even with braces inside strings', () => {
    const text = '```json\n{"questions":[{"prompt":"a {tricky} } one","options":["x","y"]},{"prompt":"second"},{"prompt":"cut o';
    const salvaged = ocr.salvageQuestionObjects(text);
    assert.equal(salvaged.length, 2);
    assert.equal(salvaged[0].prompt, 'a {tricky} } one');
  });
});

describe('saving large exams', () => {
  test('question inserts are chunked multi-row statements with no cap', () => {
    const statements = [];
    const db = {
      prepare(sql) {
        return {
          bind(...values) {
            const statement = { sql, values };
            statements.push(statement);
            return statement;
          },
        };
      },
    };
    const questions = Array.from({ length: 250 }, (_, i) => ({
      type: 'multiple_choice',
      prompt: `Q${i + 1}`,
      correctAnswer: 'a',
      rubric: '',
      explanation: '',
      points: 1,
      options: ['a', 'b', 'c', 'd'],
      sortOrder: i + 1,
    }));
    insert.buildQuestionInsertStatements(db, 'exam-1', questions);

    assert.equal(statements.length, Math.ceil(250 / insert.QUESTION_INSERT_CHUNK));
    const totalRows = statements.reduce((sum, statement) => sum + statement.values.length / 10, 0);
    assert.equal(totalRows, 250);
    assert.ok(statements.every((statement) => statement.values.length <= 10 * insert.QUESTION_INSERT_CHUNK));
    assert.equal(statements[0].values[2], 1, 'sort order of the first row');
  });

  test('no route or component still truncates questions or images to a fixed number', () => {
    const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
    const createRoute = read('../app/api/admin/exams/route.ts');
    const patchRoute = read('../app/api/admin/exams/[id]/route.ts');
    const modal = read('../app/components/admin/AIExamOcrModal.tsx');
    const ocrRoute = read('../app/api/admin/exams/ocr/route.ts');

    assert.equal(/\.slice\(0,\s*\d+\)/.test(createRoute), false, 'create route has no .slice(0, N)');
    assert.equal(/body\.questions[\s\S]{0,80}\.slice\(0,\s*\d+\)/.test(patchRoute), false, 'patch route has no question cap');
    assert.equal(/setImages\([^)]*slice\(0,\s*\d+\)/.test(modal), false, 'modal has no page cap');
    assert.equal(/questions\.slice\(0,\s*30\)/.test(modal), false);
    assert.ok(!/MAX_QUESTIONS|QUESTION_LIMIT/.test(ocrRoute));
  });
});

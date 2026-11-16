import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe, afterEach } from 'node:test';

process.env.AI_ASSISTANT_ENABLED = 'true';
process.env.AI_CONFIRMATION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.GEMINI_API_KEY = 'test-key-not-real';

const normalize = await import('../app/lib/ai/agent/normalize.ts');
const { runAgentTurn, detectIntent } = await import('../app/lib/ai/agent/agent.ts');
const { MemorySessionStore } = await import('../app/lib/ai/agent/session.ts');
const { parseAgentEvent } = await import('../app/lib/ai/agent/ui-types.ts');
const staging = await import('../app/lib/ai/agent/image-staging.ts');
const store = await import('../app/lib/ai/agent/exam-extraction-store.ts');
const merge = await import('../app/lib/exam-ocr-merge.ts');
const { executeTool, ToolExecutionError } = await import('../app/lib/ai/tool-executor.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const teacher = { email: 'teacher@englizeka.com', role: 'teacher', permissions: [] };
const assistantNoExams = { email: 'a@x.com', role: 'assistant', permissions: ['manage_courses'] };

const uploadId = (n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111.png`;
const pageIds = (count) => Array.from({ length: count }, (_, i) => uploadId(i + 1));

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

// ── Agent with fake dependencies ──────────────────────────────────────────────

function makeSummary(questionCount, extra = {}) {
  const questions = Array.from({ length: questionCount }, (_, i) =>
    makeQuestion(i + 1, { sort_order: i + 1, ...(extra.questionOverrides?.(i + 1) ?? {}) })
  );
  return {
    questions,
    warnings: extra.warnings ?? [],
    failedWindows: extra.failedWindows ?? [],
    pendingWindows: [],
    invalidCount: extra.invalidCount ?? 0,
    duplicatesRemoved: extra.duplicatesRemoved ?? 0,
  };
}

function makeAgent({ summary, executedByToken = {} } = {}) {
  const calls = { confirmations: [], superseded: [], created: [] };
  let counter = 0;
  const state = { summary: summary ?? makeSummary(45) };
  const deps = {
    store: new MemorySessionStore(),
    provider: null,
    readTools: {
      listGrades: async () => ['أولى ثانوي'],
      listCourses: async () => [{ id: 'c1', title: 'English Master', grade: 'أولى ثانوي', price: 100, status: 'published' }],
      listLectureTitles: async () => [],
      stats: async () => ({ total: 1 }),
    },
    createConfirmation: async ({ actionType, payload, preview }) => {
      counter += 1;
      calls.confirmations.push({ actionType, payload, preview });
      return { token: `tok${counter}.sig` };
    },
    supersedeConfirmation: async (token) => {
      calls.superseded.push(token);
    },
    loadConfirmation: async (token) => executedByToken[token] ?? null,
    stagedImageExists: async (id) => id.endsWith('.png'),
    examExtraction: {
      create: async (_conversationId, pages) => {
        calls.created.push(pages);
        return { id: 'extraction-1', windowCount: merge.planBatches(pages.length).length };
      },
      summary: async () => ({
        summary: state.summary,
        pageCount: calls.created.at(-1)?.length ?? 0,
        windowCount: merge.planBatches(calls.created.at(-1)?.length ?? 0).length,
      }),
    },
    persist: { ensureConversation: async () => {}, saveMessage: async () => {} },
  };
  let conversationId;
  const say = async (message, event) => {
    const result = await runAgentTurn({ actor: teacher, message, event, conversationId }, deps);
    conversationId = result.conversationId;
    return result;
  };
  return { deps, calls, state, say };
}

const block = (result, kind) => result.ui.find((item) => item.kind === kind);
const chipValues = (result, slot) =>
  result.ui.find((item) => item.kind === 'chips' && item.slot === slot)?.options.map((option) => option.value);

describe('events and intent for exam photos', () => {
  test('pages events are strictly validated and de-duplicated, with no count cap', () => {
    assert.equal(parseAgentEvent({ type: 'pages', uploadIds: [] }), null);
    assert.equal(parseAgentEvent({ type: 'pages', uploadIds: ['../x.png'] }), null);
    assert.equal(parseAgentEvent({ type: 'pages', uploadIds: 'nope' }), null);
    const many = pageIds(150);
    assert.equal(parseAgentEvent({ type: 'pages', uploadIds: many }).uploadIds.length, 150);
    assert.equal(parseAgentEvent({ type: 'pages', uploadIds: [uploadId(1), uploadId(1)] }).uploadIds.length, 1);
    assert.deepEqual(parseAgentEvent({ type: 'extraction_done', extractionId: 'abc' }), { type: 'extraction_done', extractionId: 'abc' });
    assert.equal(parseAgentEvent({ type: 'start_flow', flow: 'create_exam_from_images' }).flow, 'create_exam_from_images');
  });

  test('Arabic requests are recognised', () => {
    for (const message of ['اعمل امتحان من الصور دي', 'عايز اختبار من صور', 'صور الامتحان دي اعملها امتحان']) {
      assert.equal(detectIntent(message), 'create_exam_from_images', message);
    }
    assert.equal(detectIntent('عايز أضيف كورس جديد'), 'create_course');
  });

  test('duration and passing percentage are understood', () => {
    assert.equal(normalize.parseDurationMinutes('45 دقيقة'), 45);
    assert.equal(normalize.parseDurationMinutes('ساعة'), 60);
    assert.equal(normalize.parseDurationMinutes('ساعتين'), 120);
    assert.equal(normalize.parseDurationMinutes('ساعة ونص'), 90);
    assert.equal(normalize.parseDurationMinutes('٩٠ دقيقة'), 90);
    assert.equal(normalize.parsePassingScore('نجاح 60'), 60);
    assert.equal(normalize.parsePassingScore('٧٥%'), 75);
    assert.equal(normalize.parsePassingScore('مفيش'), null);
  });
});

describe('exam from photos flow (agent)', () => {
  test('the request without photos asks for them; the composer then sends many pages at once', async () => {
    const { say } = makeAgent();
    let result = await say('اعمل امتحان من الصور دي');
    assert.ok(block(result, 'pages_request'), 'asks for exam-paper photos');
    assert.equal(block(result, 'upload'), undefined, 'not the single thumbnail upload');

    result = await say('', { type: 'pages', uploadIds: pageIds(7) });
    assert.match(result.reply, /7 صفحة/);
    assert.match(result.reply, /عنوان الامتحان/);
  });

  test('details in the same message are not asked again; defaults come from the OCR form', async () => {
    const { say, calls } = makeAgent();
    let result = await say('اعمل امتحان من الصور دي بعنوان امتحان الوحدة الأولى مدته 45 دقيقة نجاح 60', {
      type: 'pages',
      uploadIds: pageIds(3),
    });
    // title + duration + passing came from the message, so the next question is about publishing
    assert.deepEqual(chipValues(result, 'publish_course'), ['yes', 'no']);
    result = await say('', { type: 'choice', slot: 'publish_course', value: 'no' });
    const extract = block(result, 'extract');
    assert.ok(extract, 'extraction starts');
    assert.equal(extract.pageCount, 3);
    assert.deepEqual(calls.created[0], pageIds(3));
    assert.equal(calls.confirmations.length, 0, 'nothing is proposed before the extraction finishes');
  });

  test('defaults: 30 minutes, 70%, review allowed unless the teacher changes them', async () => {
    const { say, calls } = makeAgent();
    await say('', { type: 'pages', uploadIds: pageIds(2) });
    await say('امتحان بدون عنوان خاص');
    await say('', { type: 'choice', slot: 'settings', value: 'ok' });
    await say('', { type: 'choice', slot: 'publish_course', value: 'no' });
    await say('', { type: 'extraction_done', extractionId: 'extraction-1' });
    const payload = calls.confirmations.at(-1).payload;
    assert.equal(payload.durationMinutes, 30);
    assert.equal(payload.passingScore, 70);
    assert.equal(payload.showReview, true);
  });

  test('extraction block lists every window for ANY number of pages (no cap)', async () => {
    const { say } = makeAgent();
    await say('', { type: 'pages', uploadIds: pageIds(120), });
    await say('امتحان طويل جدًا');
    await say('', { type: 'choice', slot: 'settings', value: 'ok' });
    const result = await say('', { type: 'choice', slot: 'publish_course', value: 'no' });
    const extract = block(result, 'extract');
    assert.equal(extract.pageCount, 120);
    assert.equal(extract.windowIndices.length, merge.planBatches(120).length);
  });

  async function reachExtraction(agent, { publish = 'no' } = {}) {
    await agent.say('اعمل امتحان من الصور دي', { type: 'pages', uploadIds: pageIds(8) });
    await agent.say('امتحان شامل');
    await agent.say('', { type: 'choice', slot: 'settings', value: 'ok' });
    let result = await agent.say('', { type: 'choice', slot: 'publish_course', value: publish });
    if (publish === 'yes') {
      result = await agent.say('150 جنيه');
      result = await agent.say('', { type: 'choice', slot: 'description', value: '__skip' });
      result = await agent.say('', { type: 'skip' });
    }
    return result;
  }

  test('40+ questions: result card, then a confirmation that references the extraction by id only', async () => {
    const agent = makeAgent({ summary: makeSummary(45, { warnings: [{ code: 'MISSING_NUMBERS', message: 'أرقام مفقودة محتملة 12' }], duplicatesRemoved: 4 }) });
    const started = await reachExtraction(agent);
    assert.ok(block(started, 'extract'));

    const done = await agent.say('', { type: 'extraction_done', extractionId: 'extraction-1' });
    const card = block(done, 'extraction_result');
    assert.equal(card.questionCount, 45);
    assert.equal(card.duplicatesRemoved, 4);
    assert.deepEqual(card.warnings, ['أرقام مفقودة محتملة 12']);
    assert.equal(card.preview.length, 3);
    assert.equal(card.reviewHref, '/admin/exams?extraction=extraction-1');
    assert.ok(block(done, 'confirm'), 'confirmation card follows the result');

    assert.equal(agent.calls.confirmations.length, 1);
    const pending = agent.calls.confirmations[0];
    assert.equal(pending.actionType, 'create_exam_from_extraction');
    assert.equal(pending.payload.extractionId, 'extraction-1');
    assert.equal('questions' in pending.payload, false, 'questions are never pasted into the pending action');
    assert.equal(pending.payload.title, 'امتحان شامل');
    const rows = block(done, 'confirm').rows;
    assert.equal(rows.find((row) => row.label === 'عدد الأسئلة').value, '45');
    assert.match(rows.find((row) => row.label === 'النوع').value, /عام/);
  });

  test('questions without a correct answer are excluded only after being shown on the card', async () => {
    const agent = makeAgent({ summary: makeSummary(42, { invalidCount: 3 }) });
    await reachExtraction(agent);
    const done = await agent.say('', { type: 'extraction_done', extractionId: 'extraction-1' });
    const rows = block(done, 'confirm').rows;
    assert.equal(rows.find((row) => row.label === 'عدد الأسئلة').value, '39');
    assert.equal(rows.find((row) => row.label.startsWith('أسئلة مستبعدة')).value, '3');
    assert.equal(agent.calls.confirmations[0].payload.skipInvalid, true);
  });

  test('failed pages: retry ONLY those windows, or continue with what was extracted', async () => {
    const agent = makeAgent({
      summary: makeSummary(30, { failedWindows: [{ index: 1, window: { start: 2, end: 5 }, error: 'x', retryable: true }] }),
    });
    await reachExtraction(agent);
    let result = await agent.say('', { type: 'extraction_done', extractionId: 'extraction-1' });
    assert.deepEqual(chipValues(result, 'extract_failed'), ['retry', 'partial']);
    assert.match(result.reply, /3–5/);
    assert.equal(agent.calls.confirmations.length, 0, 'no confirmation while pages are unresolved');

    result = await agent.say('', { type: 'choice', slot: 'extract_failed', value: 'retry' });
    assert.deepEqual(block(result, 'extract').windowIndices, [1], 'only the failed window is retried');

    agent.state.summary = makeSummary(30, { failedWindows: [{ index: 1, window: { start: 2, end: 5 }, error: 'x', retryable: true }] });
    await agent.say('', { type: 'extraction_done', extractionId: 'extraction-1' });
    result = await agent.say('', { type: 'choice', slot: 'extract_failed', value: 'partial' });
    assert.ok(block(result, 'confirm'));
    assert.equal(agent.calls.confirmations.at(-1).payload.allowPartial, true);
  });

  test('publishing as a course is a SEPARATE confirmation with its own summary', async () => {
    const agent = makeAgent({
      executedByToken: {
        'tok1.sig': {
          state: 'succeeded',
          actionType: 'create_exam_from_extraction',
          result: { ok: true, toolName: 'create_exam_from_extraction', result: { exam: { ok: true, id: 'exam-77' }, questionCount: 45, skipped: 0 } },
        },
        'tok2.sig': {
          state: 'succeeded',
          actionType: 'publish_exam_as_course',
          result: { ok: true, toolName: 'publish_exam_as_course', result: { examId: 'exam-77', listing: { publicSlug: 'امتحان-شامل-ab12c', isPublic: true } } },
        },
      },
    });
    await reachExtraction(agent, { publish: 'yes' });
    await agent.say('', { type: 'extraction_done', extractionId: 'extraction-1' });
    assert.equal(agent.calls.confirmations[0].actionType, 'create_exam_from_extraction');
    assert.equal(agent.calls.confirmations.length, 1, 'publishing is not proposed together with the creation');

    const created = await agent.say('', { type: 'executed', token: 'tok1.sig' });
    assert.ok(block(created, 'success'), 'draft created');
    assert.equal(agent.calls.confirmations.length, 2);
    const publish = agent.calls.confirmations[1];
    assert.equal(publish.actionType, 'publish_exam_as_course');
    assert.deepEqual(publish.payload, { examId: 'exam-77', listingPrice: 150, isPublic: true, showLeaderboard: true });
    const rows = block(created, 'confirm').rows;
    assert.equal(rows.find((row) => row.label === 'الفئة').value, 'كل الصفوف');
    assert.equal(rows.find((row) => row.label === 'السعر').value, '150 جنيه');
    assert.ok(rows.some((row) => row.label === 'الصورة المصغرة'));
    assert.ok(rows.some((row) => row.label === 'لوحة أفضل 10 طلاب'));

    const finished = await agent.say('', { type: 'executed', token: 'tok2.sig' });
    assert.equal(block(finished, 'success').link.href, '/exams/' + encodeURIComponent('امتحان-شامل-ab12c'));
  });

  test('toggling the public page or leaderboard rebuilds the publish confirmation and supersedes the old one', async () => {
    const agent = makeAgent({
      executedByToken: {
        'tok1.sig': {
          state: 'succeeded',
          actionType: 'create_exam_from_extraction',
          result: { ok: true, toolName: 'create_exam_from_extraction', result: { exam: { ok: true, id: 'exam-9' }, questionCount: 45, skipped: 0 } },
        },
      },
    });
    await reachExtraction(agent, { publish: 'yes' });
    await agent.say('', { type: 'extraction_done', extractionId: 'extraction-1' });
    await agent.say('', { type: 'executed', token: 'tok1.sig' });
    await agent.say('', { type: 'choice', slot: '__edit', value: 'toggle_leaderboard' });
    assert.equal(agent.calls.superseded.at(-1), 'tok2.sig');
    assert.equal(agent.calls.confirmations.at(-1).payload.showLeaderboard, false);
    assert.equal(agent.calls.confirmations.filter((c) => c.actionType === 'create_exam_from_extraction').length, 1, 'the exam is never created twice');
  });

  test('without publishing the flow ends after the draft is created', async () => {
    const agent = makeAgent({
      executedByToken: {
        'tok1.sig': {
          state: 'succeeded',
          actionType: 'create_exam_from_extraction',
          result: { ok: true, toolName: 'create_exam_from_extraction', result: { exam: { ok: true, id: 'exam-5' }, questionCount: 45, skipped: 0 } },
        },
      },
    });
    await reachExtraction(agent);
    await agent.say('', { type: 'extraction_done', extractionId: 'extraction-1' });
    const result = await agent.say('', { type: 'executed', token: 'tok1.sig' });
    assert.ok(block(result, 'success'));
    assert.equal(agent.calls.confirmations.length, 1);
    assert.equal(block(result, 'confirm'), undefined);
  });

  test('thumbnail question accepts ONE image; exam pages replace any unfinished flow', async () => {
    const { say, calls } = makeAgent();
    await say('عايز أضيف كورس جديد');
    await say('English');
    await say('', { type: 'choice', slot: 'grade', value: 'أولى ثانوي' });
    let result = await say('٥٠٠');
    assert.ok(block(result, 'upload'), 'thumbnail question');
    result = await say('', { type: 'attachment', uploadId: uploadId(1) });
    assert.ok(block(result, 'confirm'), 'a single image is the thumbnail');

    // Many pages arriving while another flow is open start the exam flow instead.
    result = await say('', { type: 'pages', uploadIds: pageIds(4) });
    assert.match(result.reply, /4 صفحة/);
    assert.equal(calls.superseded.length >= 1, true, 'the unfinished course confirmation is invalidated');
  });

  test('a missing staged page is refused with a friendly message', async () => {
    const { say } = makeAgent();
    const result = await say('', { type: 'pages', uploadIds: ['00000009-1111-4111-8111-111111111111.webp'] });
    assert.match(result.reply, /ارفعها تاني/);
  });

  test('the agent has no write path of its own', () => {
    const source = read('../app/lib/ai/agent/agent.ts');
    assert.equal(source.includes('executeTool'), false);
    assert.equal(source.includes('assessmentService'), false);
    assert.equal(source.includes('examListingService'), false);
  });
});

// ── Executor-level behaviour with a mocked OCR model and fake database ─────────

function makeWorld() {
  const world = { extractions: new Map(), windows: new Map(), sql: [], examInserts: [], questionRows: 0, files: new Map() };
  const run = (sql, values) => ({
    async first() {
      world.sql.push(sql);
      if (sql.includes('FROM ai_exam_extractions WHERE id = ?')) {
        const row = world.extractions.get(values[0]);
        return row && row.email === values[1] ? { id: row.id, conversationId: row.conversationId, pagesJson: row.pages, expiresAt: row.expiresAt } : null;
      }
      if (sql.includes('information_schema.columns')) return { 1: 1 };
      return null;
    },
    async all() {
      world.sql.push(sql);
      if (sql.includes('FROM ai_exam_extraction_windows')) {
        const rows = [...world.windows.entries()]
          .filter(([key]) => key.startsWith(values[0] + ':'))
          .map(([, row]) => ({ index: row.index, questionsJson: row.questions, error: row.error, retryable: row.retryable }));
        return { results: rows, success: true, meta: { changes: rows.length } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    },
    async run() {
      world.sql.push(sql);
      if (sql.includes('INSERT INTO ai_exam_extractions')) {
        world.extractions.set(values[0], { id: values[0], conversationId: values[1], email: values[2], pages: values[3], expiresAt: values[5] });
      } else if (sql.includes('INSERT INTO ai_exam_extraction_windows')) {
        world.windows.set(values[0] + ':' + values[1], { index: values[1], questions: values[2], error: values[3], retryable: values[4] });
      } else if (sql.includes('INSERT INTO exams')) {
        world.examInserts.push(values);
      } else if (sql.includes('INSERT INTO questions')) {
        world.questionRows += values.length / 10;
      }
      return { results: [], success: true, meta: { changes: 1 } };
    },
  });
  world.db = {
    async batch(statements) {
      for (const statement of statements) await statement.run();
    },
    prepare(sql) {
      return { bind: (...values) => ({ values, ...run(sql, values) }), ...run(sql, []) };
    },
  };
  world.storage = {
    async put(key, bytes) {
      world.files.set(key, bytes);
    },
    async get(key) {
      const body = world.files.get(key);
      return body ? { body, size: body.byteLength } : null;
    },
    async delete(key) {
      world.files.delete(key);
    },
  };
  return world;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Mocked model: answers with the questions printed on the pages it was sent (page index is in the image data). */
function mockModel(pagesQuestions, behave) {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const parts = body.contents[0].parts;
    const pageIndexes = parts
      .filter((part) => part.inlineData)
      .map((part) => Number(Buffer.from(part.inlineData.data, 'base64').toString().slice(1)));
    calls.push(pageIndexes);
    const override = behave?.(pageIndexes, calls.length);
    if (override) return override;
    const questions = pageIndexes.flatMap((index) => pagesQuestions[index]);
    return new Response(
      JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ questions }) }] } }] }),
      { status: 200 }
    );
  };
  return calls;
}

function seedExtraction(world, email, pageCount) {
  const ids = pageIds(pageCount);
  const id = 'ext-1';
  world.extractions.set(id, {
    id,
    conversationId: 'conv-1',
    email: email.toLowerCase(),
    pages: JSON.stringify(ids),
    expiresAt: Date.now() + 60_000,
  });
  ids.forEach((pageId, index) => {
    world.files.set(staging.stagedImageKey(email, pageId), new TextEncoder().encode('P' + index));
  });
  return { id, ids };
}

const pagesWithQuestions = (pageCount, perPage) =>
  Array.from({ length: pageCount }, (_, p) => Array.from({ length: perPage }, (_, i) => makeQuestion(p * perPage + i + 1)));

const extractWindow = (world, extractionId, windowIndex, actor = teacher) =>
  executeTool({
    toolName: 'extract_exam_from_images',
    args: { extractionId, windowIndex },
    actor,
    context: { db: world.db, storage: world.storage },
  });

describe('extract_exam_from_images tool (mocked model)', () => {
  test('40+ questions across several windows are extracted, merged in order and summarized', async () => {
    const world = makeWorld();
    const { id } = seedExtraction(world, teacher.email, 8);
    const model = mockModel(pagesWithQuestions(8, 6));

    const windowCount = merge.planBatches(8).length;
    for (let index = 0; index < windowCount; index++) {
      const outcome = await extractWindow(world, id, index);
      assert.equal(outcome.result.status, 'done');
    }
    assert.ok(model.every((pages) => pages.length <= merge.OCR_BATCH_SIZE), 'small batches only');

    const record = await store.getExtraction(world.db, id, teacher.email);
    const summary = store.summarizeExtraction(record, await store.loadWindows(world.db, id));
    assert.equal(summary.questions.length, 48);
    assert.deepEqual(summary.questions.map((q) => q.source_number), Array.from({ length: 48 }, (_, i) => i + 1));
    assert.equal(summary.failedWindows.length, 0);
    assert.ok(summary.duplicatesRemoved > 0, 'overlap duplicates were removed and reported');
    assert.equal(summary.warnings.length, 0);
  });

  test('a failed window is stored, reported, and retried alone without redoing the others', async () => {
    const world = makeWorld();
    const { id } = seedExtraction(world, teacher.email, 8);
    let failWindowPages = true;
    const model = mockModel(pagesWithQuestions(8, 6), (pages) =>
      failWindowPages && pages.includes(4) && pages.includes(5) ? new Response('boom', { status: 400 }) : null
    );

    const windowCount = merge.planBatches(8).length;
    for (let index = 0; index < windowCount; index++) await extractWindow(world, id, index);

    const record = await store.getExtraction(world.db, id, teacher.email);
    let summary = store.summarizeExtraction(record, await store.loadWindows(world.db, id));
    assert.equal(summary.failedWindows.length >= 1, true);
    const failedIndex = summary.failedWindows[0].index;

    const callsBefore = model.length;
    failWindowPages = false;
    const retried = await extractWindow(world, id, failedIndex);
    assert.equal(retried.result.status, 'done');
    assert.equal(model.length > callsBefore, true);

    const cached = await extractWindow(world, id, 0);
    assert.equal(cached.result.cached, true, 'a finished window is not extracted again');

    summary = store.summarizeExtraction(record, await store.loadWindows(world.db, id));
    assert.equal(summary.failedWindows.length, 0);
    assert.equal(summary.questions.length, 48);
  });

  test('another user can never read or extract someone else\'s extraction', async () => {
    const world = makeWorld();
    const { id } = seedExtraction(world, 'victim@x.com', 3);
    mockModel(pagesWithQuestions(3, 5));
    await assert.rejects(
      extractWindow(world, id, 0, { email: 'other@x.com', role: 'teacher', permissions: [] }),
      (error) => error instanceof ToolExecutionError && error.status === 404
    );
    assert.equal(await store.getExtraction(world.db, id, 'other@x.com'), null);
  });

  test('permission: manage_exams is required for every new tool', async () => {
    const world = makeWorld();
    const { id } = seedExtraction(world, assistantNoExams.email, 2);
    for (const call of [
      { toolName: 'extract_exam_from_images', args: { extractionId: id, windowIndex: 0 } },
      { toolName: 'create_exam_from_extraction', args: { extractionId: id, title: 'Exam title' } },
      { toolName: 'publish_exam_as_course', args: { examId: 'e1' } },
    ]) {
      await assert.rejects(
        executeTool({ ...call, actor: assistantNoExams, context: { db: world.db, storage: world.storage, confirmationSatisfied: true } }),
        (error) => error instanceof ToolExecutionError && error.code === 'FORBIDDEN',
        call.toolName
      );
    }
  });

  test('schema validation rejects unknown or mistyped arguments', async () => {
    const world = makeWorld();
    for (const args of [
      { extractionId: 'x', windowIndex: 'zero' },
      { extractionId: 'x', windowIndex: 0, hacker: true },
      { windowIndex: 0 },
    ]) {
      await assert.rejects(
        executeTool({ toolName: 'extract_exam_from_images', args, actor: teacher, context: { db: world.db } }),
        (error) => error instanceof ToolExecutionError && error.code === 'INVALID_ARGS'
      );
    }
  });
});

describe('create_exam_from_extraction tool: confirm-before-write', () => {
  async function extractAll(world, id, pageCount, perPage) {
    mockModel(pagesWithQuestions(pageCount, perPage));
    for (let index = 0; index < merge.planBatches(pageCount).length; index++) await extractWindow(world, id, index);
  }

  test('never writes without confirmation', async () => {
    const world = makeWorld();
    const { id } = seedExtraction(world, teacher.email, 8);
    await extractAll(world, id, 8, 6);
    await assert.rejects(
      executeTool({ toolName: 'create_exam_from_extraction', args: { extractionId: id, title: 'امتحان شامل' }, actor: teacher, context: { db: world.db } }),
      (error) => error instanceof ToolExecutionError && error.code === 'CONFIRMATION_REQUIRED'
    );
    assert.equal(world.examInserts.length, 0);
    assert.equal(world.questionRows, 0);

    await assert.rejects(
      executeTool({ toolName: 'publish_exam_as_course', args: { examId: 'e1' }, actor: teacher, context: { db: world.db } }),
      (error) => error instanceof ToolExecutionError && error.code === 'CONFIRMATION_REQUIRED'
    );
  });

  test('after confirmation it creates ONE draft general exam with all questions, no cap', async () => {
    const world = makeWorld();
    const { id } = seedExtraction(world, teacher.email, 40);
    await extractAll(world, id, 40, 5); // 200 questions

    const outcome = await executeTool({
      toolName: 'create_exam_from_extraction',
      args: { extractionId: id, title: 'امتحان شامل', durationMinutes: 45, passingScore: 60, showReview: false },
      actor: teacher,
      context: { db: world.db, storage: world.storage, confirmationSatisfied: true },
    });
    assert.equal(outcome.result.questionCount, 200);
    assert.equal(world.questionRows, 200, 'every question is inserted (no 100 cap)');
    assert.equal(world.examInserts.length, 1);
    const values = world.examInserts[0];
    assert.equal(values[1], null, 'general exam: not tied to a class');
    assert.equal(values[8], 'draft');
    assert.equal(values[5], 45);
    assert.equal(values[6], 60);
    assert.equal(values.at(-1), false, 'review answers switched off as requested');
  });

  test('unresolved pages and questions without answers are refused unless explicitly allowed', async () => {
    const world = makeWorld();
    const { id } = seedExtraction(world, teacher.email, 4);
    const pages = pagesWithQuestions(4, 5);
    pages[0][0] = { ...pages[0][0], correct_answer: '' }; // no usable answer
    mockModel(pages);
    await extractWindow(world, id, 0); // window 1 never runs

    const call = (extra) =>
      executeTool({
        toolName: 'create_exam_from_extraction',
        args: { extractionId: id, title: 'امتحان شامل', ...extra },
        actor: teacher,
        context: { db: world.db, storage: world.storage, confirmationSatisfied: true },
      });

    await assert.rejects(call({}), /لم يتم استخراجها/);
    await assert.rejects(call({ allowPartial: true }), /بلا إجابة صحيحة/);
    const outcome = await call({ allowPartial: true, skipInvalid: true });
    assert.equal(outcome.result.skipped, 1);
  });
});

describe('exam page staging', () => {
  function jpegLike(bytes) {
    const data = new Uint8Array(bytes);
    data.set([0xff, 0xd8, 0xff, 0xe0], 0);
    return data.buffer;
  }

  test('pages use the OCR limits (10MB, JPG/PNG/WebP) while thumbnails keep their 5MB / size rules', () => {
    assert.doesNotThrow(() => staging.validateExamPageImage(jpegLike(8 * 1024 * 1024), 'image/jpeg'));
    assert.throws(() => staging.validateExamPageImage(new ArrayBuffer(11 * 1024 * 1024), 'image/jpeg'), /10 ميجابايت/);
    assert.throws(() => staging.validateExamPageImage(new TextEncoder().encode('not an image').buffer, 'image/png'), /غير مدعوم/);
    assert.throws(() => staging.validateThumbnailImage(jpegLike(8 * 1024 * 1024), 'image/jpeg'), /5 ميجابايت/);
  });

  test('many pages can be staged one by one and stay inside the owner namespace', async () => {
    const world = makeWorld();
    const ids = [];
    for (let i = 0; i < 60; i++) {
      const { uploadId: staged } = await staging.stageImage(teacher.email, jpegLike(2000), 'image/jpeg', world.storage, 'exam_page');
      ids.push(staged);
    }
    assert.equal(new Set(ids).size, 60);
    assert.equal(world.files.size, 60);
    assert.notEqual(staging.stagedImageKey('a@x.com', ids[0]), staging.stagedImageKey('b@x.com', ids[0]));
  });

  test('the upload route and composer implement the exam-page behaviour', () => {
    const route = read('../app/api/admin/ai/upload-image/route.ts');
    assert.match(route, /purpose=exam_page|'exam_page'/);
    assert.match(route, /manage_exams/);
    const workspace = read('../app/components/admin/ai/AIAssistantWorkspace.tsx');
    assert.match(workspace, /multiple/);
    assert.match(workspace, /type: 'pages'/);
    assert.match(workspace, /إنشاء امتحان من صور/);
    assert.match(workspace, /اختار صورة واحدة فقط/);
    assert.match(workspace, /movePage/);
    assert.match(workspace, /removePage/);
    const extractRoute = read('../app/api/admin/ai/exam-extract/route.ts');
    assert.match(extractRoute, /maxDuration/);
    assert.match(extractRoute, /extract_exam_from_images/);
  });
});

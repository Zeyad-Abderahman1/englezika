import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import PDFDocument from 'pdfkit';

import { PrivateStorage } from '../app/lib/private-storage.ts';

class AiRouteDatabase {
  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind() {
        return {
          async first() {
            if (normalized.includes('FROM staff_sessions s JOIN staff_users')) {
              return {
                expiresAt: Date.now() + 60_000,
                email: 'teacher@englizeka.com',
                name: 'Teacher',
                role: 'teacher',
                permissions: '[]',
              };
            }
            return null;
          },
          async run() {
            return { results: [], success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

function createTextPdf() {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.text(
      'English grammar lesson about active and passive voice, sentence structure, verbs, subjects, and objects. '.repeat(20)
    );
    doc.end();
  });
}

let storageDirectory;
let previousEnvironment;

beforeEach(async () => {
  storageDirectory = await mkdtemp(path.join(tmpdir(), 'englizeka-ai-pdf-'));
  previousEnvironment = {
    AI_ASSISTANT_ENABLED: process.env.AI_ASSISTANT_ENABLED,
    AI_CONFIRMATION_SECRET: process.env.AI_CONFIRMATION_SECRET,
    AI_PROVIDER: process.env.AI_PROVIDER,
    PRIVATE_STORAGE_DIR: process.env.PRIVATE_STORAGE_DIR,
  };
  process.env.AI_ASSISTANT_ENABLED = 'true';
  process.env.AI_CONFIRMATION_SECRET = '0123456789abcdef0123456789abcdef';
  process.env.AI_PROVIDER = 'mock';
  process.env.PRIVATE_STORAGE_DIR = storageDirectory;
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new AiRouteDatabase(),
    STORAGE: new PrivateStorage(),
  };
});

afterEach(async () => {
  delete globalThis.__ENGLIZEKA_ENV__;
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(storageDirectory, { recursive: true, force: true });
});

test('uploaded opaque PDF identifier resolves the same private object during generation', async () => {
  const { POST: uploadPdf } = await import('../app/api/admin/ai/upload/route.ts');
  const { POST: generateAssessment } = await import('../app/api/admin/ai/generate-assessment/route.ts');
  const pdf = await createTextPdf();
  const form = new FormData();
  form.append('file', new File([pdf], 'unit-one.pdf', { type: 'application/pdf' }));

  const uploadResponse = await uploadPdf(new Request('https://englezika.com/api/admin/ai/upload', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      cookie: 'englizeka_staff=valid-staff-token-12345678',
      'content-length': String(pdf.byteLength + 500),
    },
    body: form,
  }));
  assert.equal(uploadResponse.status, 200);
  const uploadBody = await uploadResponse.json();
  assert.match(uploadBody.tempFileId, /^[0-9a-f-]{36}$/i);

  // The upload endpoint launches lazy cleanup after writing. Give that task a
  // deterministic opportunity to inspect the newly written private object.
  await new Promise((resolve) => setTimeout(resolve, 100));

  const generationResponse = await generateAssessment(new Request(
    'https://englezika.com/api/admin/ai/generate-assessment',
    {
      method: 'POST',
      headers: {
        origin: 'https://englezika.com',
        cookie: 'englizeka_staff=valid-staff-token-12345678',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tempFileId: uploadBody.tempFileId,
        title: 'Unit One Quiz',
        examType: 'quiz',
        questionCount: 3,
      }),
    }
  ));

  assert.notEqual(generationResponse.status, 404);
  assert.equal(generationResponse.status, 200);
  const generationBody = await generationResponse.json();
  assert.equal(generationBody.success, true);
  assert.equal(generationBody.assessment.questions.length, 3);
});

test('AI PDF upload rejects files larger than 10 MB', async () => {
  const { POST: uploadPdf } = await import('../app/api/admin/ai/upload/route.ts');
  const oversizedPdf = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20);
  oversizedPdf.write('%PDF-', 0, 'ascii');
  const form = new FormData();
  form.append('file', new File([oversizedPdf], 'oversized.pdf', { type: 'application/pdf' }));

  const response = await uploadPdf(new Request('https://englezika.com/api/admin/ai/upload', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      cookie: 'englizeka_staff=valid-staff-token-12345678',
      'content-length': String(oversizedPdf.byteLength + 500),
    },
    body: form,
  }));

  assert.equal(response.status, 413);
});

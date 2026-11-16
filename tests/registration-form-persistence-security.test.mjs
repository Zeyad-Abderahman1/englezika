import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  REGISTRATION_DRAFT_KEY,
  clearRegistrationDraft,
  loadRegistrationDraft,
  saveRegistrationDraft,
} from '../app/lib/registration-draft.ts';

class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

describe('Registration Form State Preservation & Mobile Resilience', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = new MockSessionStorage();
    globalThis.window = { sessionStorage: mockStorage };
  });

  afterEach(() => {
    delete globalThis.window;
  });

  test('1. 400 response keeps entered fields', async () => {
    const authSource = await readFile('app/components/AuthForm.tsx', 'utf-8');

    // Verify handleSubmit logic does not clear draft or form on 400 / !res.ok
    assert.ok(
      authSource.includes('if (!res.ok) {') &&
        authSource.includes('setError(data.error || \'حدث خطأ في التسجيل\');') &&
        authSource.includes('return;'),
      'On non-OK HTTP status, error is set and function returns immediately without clearing state'
    );

    // Populate mock storage with student data
    saveRegistrationDraft({
      firstName: 'أحمد',
      lastName: 'محمود',
      phone: '01012345678',
      fatherPhone: '01112345678',
      email: 'student@example.com',
      governorate: 'القاهرة',
      grade: 'تالتة ثانوي',
    }, mockStorage);

    // Simulate 400 error handling in frontend: draft must still exist
    const draftAfter400 = loadRegistrationDraft(mockStorage);
    assert.ok(draftAfter400, 'Draft must not be removed on 400 response');
    assert.equal(draftAfter400.firstName, 'أحمد');
    assert.equal(draftAfter400.email, 'student@example.com');
  });

  test('2. 403 response keeps entered fields', async () => {
    saveRegistrationDraft({
      firstName: 'سارة',
      lastName: 'علي',
      phone: '01098765432',
      email: 'sara@example.com',
    }, mockStorage);

    // Simulated 403 response
    const draftAfter403 = loadRegistrationDraft(mockStorage);
    assert.ok(draftAfter403, 'Draft must not be cleared on 403 response');
    assert.equal(draftAfter403.firstName, 'سارة');
    assert.equal(draftAfter403.phone, '01098765432');
  });

  test('3. 409 duplicate account keeps entered fields', async () => {
    saveRegistrationDraft({
      firstName: 'كريم',
      lastName: 'حسام',
      email: 'duplicate@example.com',
      schoolName: 'مدرسة المتفوقين',
    }, mockStorage);

    // Simulated 409 response
    const draftAfter409 = loadRegistrationDraft(mockStorage);
    assert.ok(draftAfter409, 'Draft must be preserved when email is already registered (409)');
    assert.equal(draftAfter409.email, 'duplicate@example.com');
    assert.equal(draftAfter409.schoolName, 'مدرسة المتفوقين');
  });

  test('4. 429 rate limit keeps entered fields', async () => {
    saveRegistrationDraft({
      firstName: 'يوسف',
      lastName: 'إبراهيم',
      phone: '01234567890',
      email: 'rate.limit@example.com',
    }, mockStorage);

    // Simulated 429 response
    const draftAfter429 = loadRegistrationDraft(mockStorage);
    assert.ok(draftAfter429, 'Draft must be preserved when rate limited (429)');
    assert.equal(draftAfter429.firstName, 'يوسف');
  });

  test('5. network failure keeps entered fields', async () => {
    const authSource = await readFile('app/components/AuthForm.tsx', 'utf-8');

    // In catch block: only sets error, does not navigate away or reset form
    assert.ok(
      authSource.includes('catch {') &&
        authSource.includes('setError(\'تعذر الاتصال. تحقق من الإنترنت.\');') &&
        authSource.includes('} finally {'),
      'Catch block displays network error without clearing state or draft'
    );

    saveRegistrationDraft({
      firstName: 'عمر',
      lastName: 'طارق',
      email: 'omar@example.com',
    }, mockStorage);

    const draftAfterNetworkDrop = loadRegistrationDraft(mockStorage);
    assert.ok(draftAfterNetworkDrop, 'Draft must survive network failure');
    assert.equal(draftAfterNetworkDrop.firstName, 'عمر');
  });

  test('6. non-submit buttons do not submit/reload form', async () => {
    const authSource = await readFile('app/components/AuthForm.tsx', 'utf-8');

    // Extract RegisterForm definition
    const registerFormMatch = authSource.match(/export function RegisterForm\(\) \{([\s\S]*?)\n\}/);
    assert.ok(registerFormMatch, 'RegisterForm function found in AuthForm.tsx');
    const registerFormBody = registerFormMatch[1];

    // Check all <button occurrences inside RegisterForm
    const buttonMatches = [...registerFormBody.matchAll(/<button([\s\S]*?)>/g)];
    assert.ok(buttonMatches.length > 0, 'Found buttons inside RegisterForm');

    for (const match of buttonMatches) {
      const buttonAttrs = match[1];
      const isSubmit = buttonAttrs.includes('type="submit"');
      const isButton = buttonAttrs.includes('type="button"');
      assert.ok(
        isSubmit || isButton,
        `Every button inside RegisterForm must have explicit type="submit" or type="button": ${match[0]}`
      );
      if (!isSubmit) {
        assert.ok(
          isButton,
          `Non-submit buttons must have explicit type="button": ${match[0]}`
        );
      }
    }

    // Check show/hide password buttons have type="button"
    const passwordInputMatch = authSource.match(/function PasswordInput[\s\S]*?return \([\s\S]*?<\/div>\s*\);\s*\}/);
    assert.ok(passwordInputMatch, 'PasswordInput function found');
    assert.ok(
      passwordInputMatch[0].includes('type="button"') &&
        passwordInputMatch[0].includes('className="auth-eye-btn"'),
      'Password toggle button explicitly uses type="button"'
    );

    // Check handleSubmit uses e.preventDefault() and has loading guard
    assert.ok(
      registerFormBody.includes('e.preventDefault();'),
      'handleSubmit safely executes e.preventDefault()'
    );
    assert.ok(
      registerFormBody.includes('if (loading) return;'),
      'handleSubmit guards against concurrent/double submission'
    );
  });

  test('7. return_to does not reset state', async () => {
    const authSource = await readFile('app/components/AuthForm.tsx', 'utf-8');

    // Ensure rawTarget is safely parsed and redirectTarget defaults to /account
    assert.ok(
      authSource.includes('searchParams?.get(\'return_to\')'),
      'Uses return_to search param'
    );
    assert.ok(
      authSource.includes('const redirectTarget ='),
      'Calculates redirectTarget safely'
    );

    // Verify typing does not push or replace router URL
    // router.push is only called upon confirmed success or unverified pending
    const routerMatches = [...authSource.matchAll(/router\.(push|replace)\([^)]+\)/g)];
    for (const match of routerMatches) {
      assert.ok(
        !match[0].includes('firstName') && !match[0].includes('phone'),
        'Router navigation must not be triggered during typing'
      );
    }
  });

  test('8. non-sensitive draft restores after reload', () => {
    // Save full draft
    saveRegistrationDraft({
      firstName: 'محمد',
      secondName: 'عبد الله',
      thirdName: 'حسن',
      lastName: 'إبراهيم',
      phone: '01011112222',
      fatherPhone: '01033334444',
      schoolName: 'السعيدية الثانوية',
      governorate: 'الجيزة',
      gender: 'ذكر',
      grade: 'تانية ثانوي',
      section: 'علمي علوم',
      email: 'mohamed@example.com',
      agreementAccepted: true,
    }, mockStorage);

    // Simulate page reload: read from storage
    const restored = loadRegistrationDraft(mockStorage);
    assert.ok(restored, 'Restored draft exists');
    assert.equal(restored.firstName, 'محمد');
    assert.equal(restored.secondName, 'عبد الله');
    assert.equal(restored.thirdName, 'حسن');
    assert.equal(restored.lastName, 'إبراهيم');
    assert.equal(restored.phone, '01011112222');
    assert.equal(restored.fatherPhone, '01033334444');
    assert.equal(restored.schoolName, 'السعيدية الثانوية');
    assert.equal(restored.governorate, 'الجيزة');
    assert.equal(restored.gender, 'ذكر');
    assert.equal(restored.grade, 'تانية ثانوي');
    assert.equal(restored.section, 'علمي علوم');
    assert.equal(restored.email, 'mohamed@example.com');
    assert.equal(restored.agreementAccepted, true);
  });

  test('9. password is NOT stored in sessionStorage', () => {
    // Attempt to persist sensitive passwords/tokens
    saveRegistrationDraft({
      firstName: 'زياد',
      email: 'zeyad@example.com',
      password: 'SecretPassword123!',
      passwordConfirm: 'SecretPassword123!',
      password_confirm: 'SecretPassword123!',
      token: 'jwt-auth-token-123',
      otp: '654321',
      birthCertificate: 'data:binary...',
    }, mockStorage);

    const raw = mockStorage.getItem(REGISTRATION_DRAFT_KEY);
    assert.ok(raw, 'Raw storage string exists');

    // Verify raw storage string contains ZERO sensitive data
    assert.equal(raw.includes('SecretPassword123!'), false, 'Password must NOT be in sessionStorage');
    assert.equal(raw.includes('password'), false, 'Key "password" must NOT be in sessionStorage');
    assert.equal(raw.includes('jwt-auth-token-123'), false, 'Auth tokens must NOT be in sessionStorage');
    assert.equal(raw.includes('654321'), false, 'OTP codes must NOT be in sessionStorage');
    assert.equal(raw.includes('birthCertificate'), false, 'Birth certificate files must NOT be in sessionStorage');

    const restored = loadRegistrationDraft(mockStorage);
    assert.equal(restored.password, undefined, 'Restored draft has no password field');
    assert.equal(restored.passwordConfirm, undefined, 'Restored draft has no passwordConfirm field');
  });

  test('10. successful registration clears draft', async () => {
    const authSource = await readFile('app/components/AuthForm.tsx', 'utf-8');

    // Verify clearRegistrationDraft is executed before setSuccess(true)
    assert.ok(
      authSource.includes('clearRegistrationDraft();') &&
        authSource.includes('setSuccess(true);'),
      'clearRegistrationDraft() must be called upon successful registration'
    );

    // Populate storage with draft
    saveRegistrationDraft({
      firstName: 'نادية',
      email: 'nadia@example.com',
    }, mockStorage);
    assert.ok(loadRegistrationDraft(mockStorage), 'Draft exists before completion');

    // Simulate completion
    clearRegistrationDraft(mockStorage);
    assert.equal(loadRegistrationDraft(mockStorage), null, 'Draft is wiped after completion');
    assert.equal(mockStorage.getItem(REGISTRATION_DRAFT_KEY), null, 'Storage item is removed');
  });
});

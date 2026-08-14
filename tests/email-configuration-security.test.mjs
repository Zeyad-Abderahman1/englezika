import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { emailTestModeEnabled, validateEmailConfiguration } from '../app/lib/email-config.ts';

test('email test mode requires an explicit flag and is forbidden in production', () => {
  assert.equal(emailTestModeEnabled({}), false);
  assert.equal(emailTestModeEnabled({ EMAIL_TEST_MODE: 'false' }), false);
  assert.equal(emailTestModeEnabled({ EMAIL_TEST_MODE: 'true' }, 'development'), true);
  assert.equal(emailTestModeEnabled({ EMAIL_TEST_MODE: 'true' }, 'production'), false);
  assert.deepEqual(validateEmailConfiguration({ EMAIL_TEST_MODE: 'true' }, 'development'), []);
  assert.match(
    validateEmailConfiguration({ EMAIL_TEST_MODE: 'true' }, 'production').join(' '),
    /cannot be enabled/
  );
});

test('production requires one complete transactional email provider', () => {
  assert.match(validateEmailConfiguration({}, 'production').join(' '), /requires a complete/);
  assert.match(
    validateEmailConfiguration({ GMAIL_USER: 'mailer@example.test' }, 'production').join(' '),
    /must be configured together/
  );
  assert.deepEqual(
    validateEmailConfiguration(
      {
        GMAIL_USER: 'mailer@example.test',
        GMAIL_APP_PASSWORD: 'configured-outside-source-control',
      },
      'production'
    ),
    []
  );
});

test('local server configuration contains no email or verification credential fallbacks', async () => {
  const platform = await readFile(new URL('../app/lib/platform.ts', import.meta.url), 'utf8');
  const transactionalEmail = await readFile(
    new URL('../app/lib/email.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(platform, /englizeka-local-development-secret/);
  assert.doesNotMatch(platform, /VERIFICATION_SECRET:\s*['"][^'"]+['"]/);
  assert.doesNotMatch(transactionalEmail, /unconfigured fallback/);
  assert.doesNotMatch(
    transactionalEmail,
    /!apiKey && \(!consumerKey \|\| !consumerSecret\)\)\) \{/
  );
});

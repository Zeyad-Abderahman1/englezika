import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SITE_CONFIG } from '../app/lib/site-config.ts';

test('1. Teacher phone number and URI are exact and valid', () => {
  assert.equal(SITE_CONFIG.teacher.name, 'Mr Ahmed Hassan');
  assert.equal(SITE_CONFIG.teacher.phoneDisplay, '+20 12 29997047');
  assert.equal(SITE_CONFIG.teacher.phoneHref, 'tel:+201229997047');
});

test('2. WhatsApp link points to official teacher number', () => {
  assert.equal(SITE_CONFIG.teacher.whatsapp, 'https://wa.me/201229997047');
});

test('3. YouTube link matches exact official channel URI', () => {
  assert.equal(
    SITE_CONFIG.teacher.youtube,
    'https://www.youtube.com/@%D8%A7%D8%AD%D9%85%D8%AF%D8%AD%D8%B3%D9%86-%D9%8A5%D8%BA9%D9%86'
  );
});

test('4. TikTok link points to official @mr.ahmedhassanenglezy account', () => {
  assert.equal(
    SITE_CONFIG.teacher.tiktok,
    'https://www.tiktok.com/@mr.ahmedhassanenglezy'
  );
});

test('5. Social links list includes all official channels with safe configuration', () => {
  const ids = SITE_CONFIG.socialLinks.map((s) => s.id);
  assert.ok(ids.includes('whatsapp'));
  assert.ok(ids.includes('phone'));
  assert.ok(ids.includes('youtube'));
  assert.ok(ids.includes('tiktok'));

  for (const link of SITE_CONFIG.socialLinks) {
    assert.ok(link.href.startsWith('https://') || link.href.startsWith('tel:'));
    assert.ok(link.ariaLabel.length > 0);
  }
});

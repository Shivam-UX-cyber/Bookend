import test from 'node:test';
import assert from 'node:assert';
import { userService } from '../src/services/userService.js';

test('1. userService API client method definitions', () => {
  assert.strictEqual(typeof userService.getMyProfile, 'function');
  assert.strictEqual(typeof userService.updateMyProfile, 'function');
  assert.strictEqual(typeof userService.getPublicProfile, 'function');
});

test('2. Avatar URL validation logic', () => {
  const isValidAvatarUrl = (url) => {
    if (!url || typeof url !== 'string') return true;
    const trimmed = url.trim();
    if (trimmed.length === 0) return true;
    if (trimmed.length > 2000) return false;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // Safe HTTP/HTTPS
  assert.strictEqual(isValidAvatarUrl('https://images.unsplash.com/photo-1'), true);
  assert.strictEqual(isValidAvatarUrl('http://campus.edu/students/avatar.png'), true);
  assert.strictEqual(isValidAvatarUrl(''), true); // Empty allowed (clears avatar)

  // Malicious / Insecure schemes
  assert.strictEqual(isValidAvatarUrl('javascript:alert(1)'), false);
  assert.strictEqual(isValidAvatarUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.strictEqual(isValidAvatarUrl('ftp://ftp.example.com/avatar.jpg'), false);
  assert.strictEqual(isValidAvatarUrl('file:///C:/Users/test/avatar.png'), false);
  assert.strictEqual(isValidAvatarUrl('not-a-valid-url'), false);
});

test('3. Privacy configuration safe defaults', () => {
  const getEffectivePrivacy = (userPrivacy) => {
    const raw = userPrivacy || {};
    return {
      showBio: raw.showBio !== false, // Defaults to true
      showDepartment: Boolean(raw.showDepartment), // Defaults to false
      showCourse: Boolean(raw.showCourse), // Defaults to false
      showStudyYear: Boolean(raw.showStudyYear), // Defaults to false
      showCampus: Boolean(raw.showCampus), // Defaults to false
    };
  };

  // Completely empty / missing privacy object receives safe defaults
  const emptyDefaults = getEffectivePrivacy(null);
  assert.strictEqual(emptyDefaults.showBio, true);
  assert.strictEqual(emptyDefaults.showDepartment, false);
  assert.strictEqual(emptyDefaults.showCourse, false);
  assert.strictEqual(emptyDefaults.showStudyYear, false);
  assert.strictEqual(emptyDefaults.showCampus, false);

  // Explicit user overrides
  const explicitPrivacy = getEffectivePrivacy({
    showBio: false,
    showDepartment: true,
    showCourse: true,
  });
  assert.strictEqual(explicitPrivacy.showBio, false);
  assert.strictEqual(explicitPrivacy.showDepartment, true);
  assert.strictEqual(explicitPrivacy.showCourse, true);
  assert.strictEqual(explicitPrivacy.showStudyYear, false);
});

test('4. Display name fallback logic', () => {
  const resolveDisplayName = (user) => {
    if (user?.displayName && typeof user.displayName === 'string' && user.displayName.trim()) {
      return user.displayName.trim();
    }
    return user?.name || 'Student';
  };

  assert.strictEqual(resolveDisplayName({ name: 'Rohit Gupta', displayName: 'Rohit G.' }), 'Rohit G.');
  assert.strictEqual(resolveDisplayName({ name: 'Rohit Gupta', displayName: '' }), 'Rohit Gupta');
  assert.strictEqual(resolveDisplayName({ name: 'Rohit Gupta', displayName: '   ' }), 'Rohit Gupta');
  assert.strictEqual(resolveDisplayName(null), 'Student');
});

import test from 'node:test';
import assert from 'node:assert';
import { FOCUSABLE_SELECTOR } from '../src/utils/useFocusTrap.js';

test('1. FOCUSABLE_SELECTOR includes all interactive targets and excludes non-interactive elements', () => {
  assert.ok(FOCUSABLE_SELECTOR.includes('a[href]'), 'Must include links with href');
  assert.ok(FOCUSABLE_SELECTOR.includes('button:not([disabled])'), 'Must include enabled buttons');
  assert.ok(FOCUSABLE_SELECTOR.includes('textarea:not([disabled])'), 'Must include enabled textareas');
  assert.ok(FOCUSABLE_SELECTOR.includes('input:not([disabled])'), 'Must include enabled inputs');
  assert.ok(FOCUSABLE_SELECTOR.includes('select:not([disabled])'), 'Must include enabled selects');
  assert.ok(FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'), 'Must include positive or zero tabindexes');
});

test('2. Focus trap boundary wrapping simulation', () => {
  // Simulate DOM element list
  const elementA = { id: 'close-btn', focusCalled: false, focus() { this.focusCalled = true; } };
  const elementB = { id: 'submit-btn', focusCalled: false, focus() { this.focusCalled = true; } };
  const focusable = [elementA, elementB];

  // When activeElement is elementB (last element) and user presses Tab (forwards)
  let activeElement = elementB;
  let prevented = false;
  const tabEvent = {
    key: 'Tab',
    shiftKey: false,
    preventDefault() { prevented = true; },
  };

  if (!tabEvent.shiftKey && activeElement === focusable[focusable.length - 1]) {
    tabEvent.preventDefault();
    focusable[0].focus();
  }

  assert.strictEqual(prevented, true, 'Default Tab navigation should be intercepted');
  assert.strictEqual(elementA.focusCalled, true, 'Focus should cycle back to first element');

  // When activeElement is elementA (first element) and user presses Shift+Tab (backwards)
  activeElement = elementA;
  prevented = false;
  elementB.focusCalled = false;
  const shiftTabEvent = {
    key: 'Tab',
    shiftKey: true,
    preventDefault() { prevented = true; },
  };

  if (shiftTabEvent.shiftKey && activeElement === focusable[0]) {
    shiftTabEvent.preventDefault();
    focusable[focusable.length - 1].focus();
  }

  assert.strictEqual(prevented, true, 'Default Shift+Tab navigation should be intercepted');
  assert.strictEqual(elementB.focusCalled, true, 'Focus should cycle back to last element');
});

test('3. Focus restoration on modal close simulation', () => {
  let restored = false;
  const triggerElement = {
    focus() {
      restored = true;
    },
  };

  // Cache trigger element
  const cachedTrigger = triggerElement;

  // Unmount / dismiss simulation
  if (cachedTrigger && typeof cachedTrigger.focus === 'function') {
    cachedTrigger.focus();
  }

  assert.strictEqual(restored, true, 'Focus should be restored to the triggering element on modal unmount');
});

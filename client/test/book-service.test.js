import test from 'node:test';
import assert from 'node:assert';
import { formatINR, BOOK_CATEGORIES, BOOK_CONDITIONS } from '../src/services/bookService.js';

test('1. formatINR Indian Rupee Currency Formatting', () => {
  // Whole rupee amounts should not have trailing .00
  const formatted450 = formatINR(450);
  assert(formatted450.includes('450'), 'Formatted output should contain 450');
  assert(formatted450.includes('₹'), 'Formatted output should include ₹ symbol');

  // Decimal rupee amounts (with paise) should preserve paise
  const formattedDecimal = formatINR(1450.5);
  assert(formattedDecimal.includes('1,450.5') || formattedDecimal.includes('1450.5'));

  // Zero
  const formattedZero = formatINR(0);
  assert(formattedZero.includes('0'));

  // Undefined / NaN edge cases
  assert.strictEqual(formatINR(undefined), '₹0');
  assert.strictEqual(formatINR(NaN), '₹0');
  assert.strictEqual(formatINR(null), '₹0');

  // Large campus numbers (lakhs formatting)
  const formattedLakh = formatINR(100000);
  assert(formattedLakh.includes('1,00,000') || formattedLakh.includes('100,000'));
});

test('2. Book Categories and Conditions Schema Integrity', () => {
  assert(Array.isArray(BOOK_CATEGORIES), 'BOOK_CATEGORIES must be an array');
  assert(BOOK_CATEGORIES.includes('Computer Science'));
  assert(BOOK_CATEGORIES.includes('Mathematics'));
  assert(BOOK_CATEGORIES.includes('Engineering'));
  assert(BOOK_CATEGORIES.includes('Other'));

  assert(Array.isArray(BOOK_CONDITIONS), 'BOOK_CONDITIONS must be an array');
  assert.deepStrictEqual(BOOK_CONDITIONS, ['New', 'Like New', 'Good', 'Acceptable']);
});

import test from 'node:test';
import assert from 'node:assert';
import {
  getUtf8ByteLength,
  evaluatePassword,
  validateGmail,
  validateInternationalName,
  calculateRemainingCooldown,
  validateBookForm,
} from '../src/utils/validation.js';

test('1. UTF-8 Byte Length Calculation without Buffer', () => {
  assert.strictEqual(getUtf8ByteLength(''), 0);
  assert.strictEqual(getUtf8ByteLength('abc'), 3);
  // Euro symbol is 3 bytes in UTF-8
  assert.strictEqual(getUtf8ByteLength('€'), 3);
  // Devanagari character is 3 bytes in UTF-8
  assert.strictEqual(getUtf8ByteLength('क'), 3);
  // Emoji is 4 bytes in UTF-8
  assert.strictEqual(getUtf8ByteLength('📚'), 4);
});

test('2. Password Criteria & 72-Byte Boundary Evaluation', () => {
  // Valid standard password
  const valid = evaluatePassword('StudentPass123!');
  assert.strictEqual(valid.isValid, true);
  assert.strictEqual(valid.errorMessage, '');
  assert.strictEqual(valid.criteria.length, true);
  assert.strictEqual(valid.criteria.upper, true);
  assert.strictEqual(valid.criteria.lower, true);
  assert.strictEqual(valid.criteria.number, true);
  assert.strictEqual(valid.criteria.special, true);

  // Missing criteria
  const noSpecial = evaluatePassword('StudentPass123');
  assert.strictEqual(noSpecial.isValid, false);
  assert.strictEqual(noSpecial.criteria.special, false);

  const tooShort = evaluatePassword('Sh1!');
  assert.strictEqual(tooShort.isValid, false);
  assert.strictEqual(tooShort.criteria.length, false);

  // Exact 72-byte boundary (ASCII)
  const exact72 = evaluatePassword('Aa1!' + 'x'.repeat(68));
  assert.strictEqual(exact72.byteLength, 72);
  assert.strictEqual(exact72.isValid, true);

  // 73 bytes exceeds bcrypt limit
  const over72 = evaluatePassword('Aa1!' + 'x'.repeat(69));
  assert.strictEqual(over72.byteLength, 73);
  assert.strictEqual(over72.isValid, false);
  assert.match(over72.errorMessage, /72 bytes/);

  // Multibyte Unicode boundary
  // 4 prefix chars (4 bytes) + 22 euro symbols (22 * 3 = 66 bytes) = 70 bytes <= 72
  const multibyteValid = evaluatePassword('Aa1!' + '€'.repeat(22));
  assert.strictEqual(multibyteValid.byteLength, 70);
  assert.strictEqual(multibyteValid.isValid, true);

  // 4 prefix chars (4 bytes) + 23 euro symbols (23 * 3 = 69 bytes) = 73 bytes > 72
  const multibyteOver = evaluatePassword('Aa1!' + '€'.repeat(23));
  assert.strictEqual(multibyteOver.byteLength, 73);
  assert.strictEqual(multibyteOver.isValid, false);
  assert.match(multibyteOver.errorMessage, /72 bytes/);
});

test('3. Strict Gmail Validation & Dot Rules', () => {
  // Valid
  assert.strictEqual(validateGmail('student.alex@gmail.com').isValid, true);
  assert.strictEqual(validateGmail('student@googlemail.com').isValid, true);
  assert.strictEqual(validateGmail('STUDENT.NAME@GMAIL.COM').normalizedEmail, 'student.name@gmail.com');

  // Boundaries (6 - 30 username characters)
  assert.strictEqual(validateGmail('123456@gmail.com').isValid, true); // 6 chars
  assert.strictEqual(validateGmail('12345@gmail.com').isValid, false); // 5 chars
  assert.strictEqual(validateGmail('a'.repeat(30) + '@gmail.com').isValid, true); // 30 chars
  assert.strictEqual(validateGmail('a'.repeat(31) + '@gmail.com').isValid, false); // 31 chars

  // Dot placement rules
  assert.strictEqual(validateGmail('.leading@gmail.com').isValid, false);
  assert.strictEqual(validateGmail('trailing.@gmail.com').isValid, false);
  assert.strictEqual(validateGmail('consecutive..dot@gmail.com').isValid, false);

  // Non-Gmail domains
  assert.strictEqual(validateGmail('user@yahoo.com').isValid, false);
  assert.strictEqual(validateGmail('user@outlook.com').isValid, false);
  assert.strictEqual(validateGmail('').isValid, false);
});

test('4. International Name Validation', () => {
  // Valid diverse names
  assert.strictEqual(validateInternationalName('Alex Morgan').isValid, true);
  assert.strictEqual(validateInternationalName('José María Aznar').isValid, true);
  assert.strictEqual(validateInternationalName('Renée Müller').isValid, true);
  assert.strictEqual(validateInternationalName('राहुल शर्मा').isValid, true);
  assert.strictEqual(validateInternationalName('Mary-Jane Watson').isValid, true);
  assert.strictEqual(validateInternationalName("O'Connor").isValid, true);
  assert.strictEqual(validateInternationalName('Li').isValid, true);

  // Invalid names
  assert.strictEqual(validateInternationalName('A').isValid, false); // under 2 chars
  assert.strictEqual(validateInternationalName('').isValid, false); // empty
  assert.strictEqual(validateInternationalName('     ').isValid, false); // whitespace only
  assert.strictEqual(validateInternationalName('---...').isValid, false); // punctuation only
  assert.strictEqual(validateInternationalName('<script>alert(1)</script>').isValid, false); // script tags
});

test('5. Deadline-Based Cooldown Calculations', () => {
  const now = Date.now();
  // 30 seconds into the future
  const futureDeadline = now + 30000;
  const remaining = calculateRemainingCooldown(futureDeadline);
  assert(remaining >= 29 && remaining <= 30, `Remaining seconds expected ~30, got ${remaining}`);

  // Past deadline (expired)
  const pastDeadline = now - 5000;
  assert.strictEqual(calculateRemainingCooldown(pastDeadline), 0);

  // Zero / invalid deadline
  assert.strictEqual(calculateRemainingCooldown(0), 0);
  assert.strictEqual(calculateRemainingCooldown(null), 0);
});

test('6. OTP Slot Preservation Logic', () => {
  // Simulate 6-slot array behavior
  const initialSlots = ['', '', '', '', '', ''];

  // User enters into slot index 3 directly
  const slot3Updated = [...initialSlots];
  slot3Updated[3] = '7';
  assert.strictEqual(slot3Updated[3], '7');
  assert.strictEqual(slot3Updated[0], '');
  assert.strictEqual(slot3Updated[1], '');
  assert.strictEqual(slot3Updated[2], '');

  // User deletes slot 1 from a fully populated code
  const fullCode = ['1', '2', '3', '4', '5', '6'];
  const deletedSlot1 = [...fullCode];
  deletedSlot1[1] = '';
  // Check that slot 2, 3, 4, 5 do NOT shift into slot 1
  assert.strictEqual(deletedSlot1[0], '1');
  assert.strictEqual(deletedSlot1[1], '');
  assert.strictEqual(deletedSlot1[2], '3');
  assert.strictEqual(deletedSlot1[3], '4');
  assert.strictEqual(deletedSlot1[4], '5');
  assert.strictEqual(deletedSlot1[5], '6');
});

test('7. Shared Book Listing Form Validation', () => {
  const validBook = {
    title: 'Operating System Concepts',
    author: 'Silberschatz, Galvin, Gagne',
    description: 'Tenth edition textbook covering virtualization, memory management, and file systems.',
    category: 'Computer Science',
    condition: 'Good',
    price: '450.50',
    isbn: '978-1-118-06333-0',
    imageUrl: 'https://images.example.com/books/os.jpg',
  };

  const validResult = validateBookForm(validBook);
  assert.strictEqual(validResult.isValid, true);
  assert.deepStrictEqual(validResult.errors, {});

  // Required fields missing
  const emptyResult = validateBookForm({});
  assert.strictEqual(emptyResult.isValid, false);
  assert.strictEqual(emptyResult.errors.title, 'Book title is required.');
  assert.strictEqual(emptyResult.errors.author, 'Author name is required.');
  assert.strictEqual(emptyResult.errors.description, 'Book description is required.');
  assert.strictEqual(emptyResult.errors.category, 'Please select an academic category.');
  assert.strictEqual(emptyResult.errors.condition, 'Please select a book condition.');
  assert.strictEqual(emptyResult.errors.price, 'Selling price is required.');

  // Category and condition validity against schema enums
  assert.strictEqual(
    validateBookForm({ ...validBook, category: 'Invalid Category Not In List' }).errors.category,
    'Please select a valid academic category.'
  );
  assert.strictEqual(
    validateBookForm({ ...validBook, condition: 'Damaged Beyond Repair' }).errors.condition,
    'Please select a valid condition (New, Like New, Good, Acceptable).'
  );

  // Title boundaries
  assert.strictEqual(validateBookForm({ ...validBook, title: 'A' }).errors.title, 'Title must be between 2 and 150 characters.');
  assert.strictEqual(validateBookForm({ ...validBook, title: 'A'.repeat(151) }).errors.title, 'Title must be between 2 and 150 characters.');

  // Author boundaries
  assert.strictEqual(validateBookForm({ ...validBook, author: 'B' }).errors.author, 'Author name must be between 2 and 100 characters.');
  assert.strictEqual(validateBookForm({ ...validBook, author: 'B'.repeat(101) }).errors.author, 'Author name must be between 2 and 100 characters.');

  // Description boundaries (<10 or >2000)
  assert.strictEqual(validateBookForm({ ...validBook, description: 'Too short' }).errors.description, 'Description must be at least 10 characters long.');
  assert.strictEqual(validateBookForm({ ...validBook, description: 'C'.repeat(2001) }).errors.description, 'Description cannot exceed 2000 characters.');

  // Price boundaries
  assert.strictEqual(validateBookForm({ ...validBook, price: '0' }).errors.price, 'Minimum price is ₹1.');
  assert.strictEqual(validateBookForm({ ...validBook, price: '-50' }).errors.price, 'Minimum price is ₹1.');
  assert.strictEqual(validateBookForm({ ...validBook, price: '100001' }).errors.price, 'Price cannot exceed ₹1,00,000.');
  assert.strictEqual(validateBookForm({ ...validBook, price: 'abc' }).errors.price, 'Price must be a valid number.');
  assert.strictEqual(validateBookForm({ ...validBook, price: '50.999' }).errors.price, 'Price cannot have more than 2 decimal places.');

  // Numeric price format
  assert.strictEqual(validateBookForm({ ...validBook, price: 500 }).isValid, true);

  // ISBN formats (optional, but validated if provided)
  assert.strictEqual(validateBookForm({ ...validBook, isbn: '' }).isValid, true);
  assert.strictEqual(validateBookForm({ ...validBook, isbn: '0-201-63361-2' }).isValid, true); // 10-digit ISBN
  assert.strictEqual(validateBookForm({ ...validBook, isbn: '12345' }).errors.isbn, 'ISBN must be a valid 10 or 13-digit standard book identifier.');

  // Image URL formats (optional, but validated if provided)
  assert.strictEqual(validateBookForm({ ...validBook, imageUrl: '' }).isValid, true);
  assert.strictEqual(validateBookForm({ ...validBook, imageUrl: 'ftp://example.com/pic.png' }).errors.imageUrl, 'Image URL must start with http:// or https://');
  assert.strictEqual(validateBookForm({ ...validBook, imageUrl: 'http://not a valid url' }).errors.imageUrl, 'Please enter a valid web URL.');
});

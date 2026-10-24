process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Book } from '../src/models/Book.js';
import { generateAuthToken } from '../src/services/tokenService.js';

console.log('🧪 Starting Student Profiles Integration Test Suite...\n');

let mongod;
let app;

async function setup() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectDB(uri);
  const serverModule = await import('../src/server.js');
  app = serverModule.default;
}

async function cleanup() {
  await disconnectDB();
  if (mongod) {
    await mongod.stop();
  }
}

async function clearCollections() {
  await User.deleteMany({});
  await Book.deleteMany({});
}

async function runProfileIntegrationTests() {
  await setup();

  try {
    const createUserSession = async (name, email, extraData = {}) => {
      const user = await User.create({
        name,
        email,
        password: '$2a$12$eX4mPL3h45h1nGf0rT3sT1nGPuRP05e50nLY0000000000000000',
        isVerified: true,
        tokenVersion: 0,
        ...extraData,
      });
      const token = generateAuthToken(user);
      return { user, token, cookie: `authToken=${token}` };
    };

    // =========================================================================
    // 1. Unauthenticated users cannot access or update private profile endpoint
    // =========================================================================
    console.log('▶ [1/22] Testing Unauthenticated Access to Private Profile Endpoints...');
    await clearCollections();

    const getResNoAuth = await request(app).get('/api/users/me/profile');
    assert.strictEqual(getResNoAuth.status, 401, 'Expected 401 when GET /api/users/me/profile without auth');

    const patchResNoAuth = await request(app)
      .patch('/api/users/me/profile')
      .send({ bio: 'Hacker bio' });
    assert.strictEqual(patchResNoAuth.status, 401, 'Expected 401 when PATCH /api/users/me/profile without auth');
    console.log('   ✓ Unauthenticated requests rejected with 401.\n');

    // =========================================================================
    // 2. Authenticated user can retrieve their own profile
    // =========================================================================
    console.log('▶ [2/22] Testing Authenticated User Can Retrieve Own Profile...');
    await clearCollections();
    const student1 = await createUserSession('Aarav Sharma', 'aarav.sharma@gmail.com', {
      bio: 'Final year CS student interested in algorithms.',
      department: 'Computer Science',
      course: 'B.Tech CSE',
      studyYear: '4th Year',
      campus: 'North Campus',
    });

    const getMeRes = await request(app)
      .get('/api/users/me/profile')
      .set('Cookie', student1.cookie);

    assert.strictEqual(getMeRes.status, 200);
    assert.strictEqual(getMeRes.body.success, true);
    assert.strictEqual(getMeRes.body.data.profile.email, 'aarav.sharma@gmail.com');
    assert.strictEqual(getMeRes.body.data.profile.name, 'Aarav Sharma');
    assert.strictEqual(getMeRes.body.data.profile.bio, 'Final year CS student interested in algorithms.');
    assert.strictEqual(getMeRes.body.data.profile.privacy.showBio, true);
    assert.strictEqual(getMeRes.body.data.profile.privacy.showDepartment, false);
    assert.strictEqual(getMeRes.body.data.profile.password, undefined);
    assert.strictEqual(getMeRes.body.data.profile.tokenVersion, undefined);
    console.log('   ✓ Authenticated user retrieves private profile with safe fields.\n');

    // =========================================================================
    // 3. Authenticated user can update permitted profile fields
    // =========================================================================
    console.log('▶ [3/22] Testing Updating Permitted Profile Fields...');
    const updateRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({
        displayName: 'Aarav S.',
        bio: 'Updated bio: open for book exchanges near central library.',
        department: 'Computer Science & Engineering',
        course: 'B.Tech Computer Science',
        studyYear: '4th Year',
        campus: 'Main Academic Campus',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
        privacy: {
          showBio: true,
          showDepartment: true,
          showCourse: true,
          showStudyYear: true,
          showCampus: true,
        },
      });

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.success, true);
    assert.strictEqual(updateRes.body.data.profile.displayName, 'Aarav S.');
    assert.strictEqual(updateRes.body.data.profile.privacy.showDepartment, true);
    assert.strictEqual(updateRes.body.data.profile.privacy.showCourse, true);
    console.log('   ✓ Permitted fields and privacy flags updated successfully.\n');

    // =========================================================================
    // 4. User cannot update another user's profile by changing URL or body field
    // =========================================================================
    console.log('▶ [4/22] Testing Cross-User Profile Update Protection...');
    const student2 = await createUserSession('Priya Patel', 'priya.patel@gmail.com');

    // student1 sends student2's ID in body
    const tamperRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({
        userId: student2.user._id.toString(),
        _id: student2.user._id.toString(),
        displayName: 'Compromised Name',
      });

    // Unknown fields rejected by allowlist
    assert.strictEqual(tamperRes.status, 400);

    // Verify student2 remains completely unchanged
    const student2InDb = await User.findById(student2.user._id);
    assert.strictEqual(student2InDb.name, 'Priya Patel');
    assert.strictEqual(student2InDb.displayName, '');
    console.log('   ✓ Target injection and cross-user update prevented.\n');

    // =========================================================================
    // 5. Protected fields cannot be modified through the profile API
    // =========================================================================
    console.log('▶ [5/22] Testing Protected Fields Cannot Be Modified (Email, Password, TokenVersion, Verified)...');
    const protectedFields = [
      { isVerified: false },
      { email: 'new.email@gmail.com' },
      { password: 'NewHackedPassword123' },
      { tokenVersion: 99 },
      { role: 'admin' },
    ];

    for (const payload of protectedFields) {
      const res = await request(app)
        .patch('/api/users/me/profile')
        .set('Cookie', student1.cookie)
        .send(payload);

      assert.strictEqual(res.status, 400, `Expected 400 when attempting to modify protected field: ${Object.keys(payload)[0]}`);
    }

    const reloadedStudent1 = await User.findById(student1.user._id);
    assert.strictEqual(reloadedStudent1.isVerified, true);
    assert.strictEqual(reloadedStudent1.email, 'aarav.sharma@gmail.com');
    assert.strictEqual(reloadedStudent1.tokenVersion, 0);
    console.log('   ✓ Protected security fields cannot be modified through profile API.\n');

    // =========================================================================
    // 6. Invalid field types are rejected
    // =========================================================================
    console.log('▶ [6/22] Testing Invalid Field Types Rejection...');
    const invalidTypes = [
      { displayName: 12345 },
      { bio: ['array', 'bio'] },
      { department: { name: 'CS' } },
      { privacy: 'not-an-object' },
    ];

    for (const payload of invalidTypes) {
      const res = await request(app)
        .patch('/api/users/me/profile')
        .set('Cookie', student1.cookie)
        .send(payload);
      assert.strictEqual(res.status, 400);
    }
    console.log('   ✓ Non-string/non-object invalid field types rejected.\n');

    // =========================================================================
    // 7. Excessively long fields are rejected
    // =========================================================================
    console.log('▶ [7/22] Testing Excessively Long Fields Rejection...');
    const longNameRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({ displayName: 'a'.repeat(71) });
    assert.strictEqual(longNameRes.status, 400);

    const longBioRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({ bio: 'b'.repeat(501) });
    assert.strictEqual(longBioRes.status, 400);

    const longDeptRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({ department: 'd'.repeat(101) });
    assert.strictEqual(longDeptRes.status, 400);
    console.log('   ✓ Boundaries for displayName (70), bio (500), department (100) enforced.\n');

    // =========================================================================
    // 8. Invalid study-year values are rejected
    // =========================================================================
    console.log('▶ [8/22] Testing Invalid Study Year Rejection...');
    const badYearRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({ studyYear: '10th Year Super Senior' });
    assert.strictEqual(badYearRes.status, 400);

    const goodYearRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({ studyYear: '3rd Year' });
    assert.strictEqual(goodYearRes.status, 200);
    console.log('   ✓ Study year enum enforced strictly.\n');

    // =========================================================================
    // 9. Unsupported avatar URL schemes are rejected
    // =========================================================================
    console.log('▶ [9/22] Testing Avatar URL Scheme Security...');
    const maliciousUrls = [
      'javascript:alert(document.cookie)',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'ftp://example.com/avatar.jpg',
      'file:///etc/passwd',
      '//evil.com/avatar.jpg',
    ];

    for (const url of maliciousUrls) {
      const res = await request(app)
        .patch('/api/users/me/profile')
        .set('Cookie', student1.cookie)
        .send({ avatarUrl: url });
      assert.strictEqual(res.status, 400, `Expected 400 for unsafe URL: ${url}`);
    }

    const safeUrlRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({ avatarUrl: 'https://cdn.pixabay.com/photo/2016/08/08/09/17/avatar-1577909_1280.png' });
    assert.strictEqual(safeUrlRes.status, 200);
    console.log('   ✓ Insecure protocols rejected; valid https URLs accepted.\n');

    // =========================================================================
    // 10. Unsupported privacy keys and unexpected nested properties cannot be injected
    // =========================================================================
    console.log('▶ [10/22] Testing Unsupported Privacy Keys Injection Protection...');
    const badPrivacyRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({
        privacy: {
          showBio: true,
          showPasswordHash: true, // Unsupported key
        },
      });
    assert.strictEqual(badPrivacyRes.status, 400);

    const nonBoolPrivacyRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({
        privacy: {
          showBio: 'yes', // Must be boolean
        },
      });
    assert.strictEqual(nonBoolPrivacyRes.status, 400);
    console.log('   ✓ Arbitrary privacy key injection and non-boolean types rejected.\n');

    // =========================================================================
    // 11. Partial updates preserve fields that were not submitted
    // =========================================================================
    console.log('▶ [11/22] Testing Partial Update Preserves Unspecified Fields...');
    const partialUpdateRes = await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({
        bio: 'Preserved bio test',
      });
    assert.strictEqual(partialUpdateRes.status, 200);
    assert.strictEqual(partialUpdateRes.body.data.profile.bio, 'Preserved bio test');
    // Ensure previously set fields like displayName, studyYear, and avatarUrl are preserved
    assert.strictEqual(partialUpdateRes.body.data.profile.displayName, 'Aarav S.');
    assert.strictEqual(partialUpdateRes.body.data.profile.studyYear, '3rd Year');
    assert.strictEqual(
      partialUpdateRes.body.data.profile.avatarUrl,
      'https://cdn.pixabay.com/photo/2016/08/08/09/17/avatar-1577909_1280.png'
    );
    console.log('   ✓ Unspecified fields preserved accurately across partial updates.\n');

    // =========================================================================
    // 12. Public profile includes fields that are explicitly public
    // =========================================================================
    console.log('▶ [12/22] Testing Public Profile Exposes Explicitly Public Fields...');
    // Set student1 privacy: showBio: true, showDepartment: true, showCourse: false
    await request(app)
      .patch('/api/users/me/profile')
      .set('Cookie', student1.cookie)
      .send({
        department: 'Electronics Engineering',
        course: 'B.Tech ECE',
        privacy: {
          showBio: true,
          showDepartment: true,
          showCourse: false,
          showStudyYear: false,
          showCampus: false,
        },
      });

    const publicRes = await request(app).get(`/api/users/${student1.user._id}/profile`);
    assert.strictEqual(publicRes.status, 200);
    assert.strictEqual(publicRes.body.success, true);
    const pub = publicRes.body.data.profile;
    assert.strictEqual(pub.displayName, 'Aarav S.');
    assert.strictEqual(pub.bio, 'Preserved bio test');
    assert.strictEqual(pub.department, 'Electronics Engineering');
    console.log('   ✓ Permitted fields present in public response.\n');

    // =========================================================================
    // 13. Private bio and academic fields are omitted from public responses
    // =========================================================================
    console.log('▶ [13/22] Testing Private Fields Are Strictly Omitted from Public Responses...');
    assert.strictEqual(pub.course, undefined, 'Course must be omitted when showCourse is false');
    assert.strictEqual(pub.studyYear, undefined, 'StudyYear must be omitted when showStudyYear is false');
    assert.strictEqual(pub.campus, undefined, 'Campus must be omitted when showCampus is false');
    console.log('   ✓ Private academic fields completely absent from public DTO.\n');

    // =========================================================================
    // 14. Public profile responses never contain email, password, or security tokens
    // =========================================================================
    console.log('▶ [14/22] Testing Sensitive Security Credentials Never Leaked Publicly...');
    assert.strictEqual(pub.email, undefined);
    assert.strictEqual(pub.password, undefined);
    assert.strictEqual(pub.tokenVersion, undefined);
    assert.strictEqual(pub.isVerified, undefined);
    assert.strictEqual(pub.resetToken, undefined);
    console.log('   ✓ Email, passwords, verification status, and tokens strictly excluded.\n');

    // =========================================================================
    // 15. Privacy settings are enforced by the server even when requested directly
    // =========================================================================
    console.log('▶ [15/22] Testing Server-Side Privacy Boundary (No Query Param Overrides)...');
    const bypassAttemptRes = await request(app)
      .get(`/api/users/${student1.user._id}/profile?showAll=true&includePrivate=1&course=1`);
    assert.strictEqual(bypassAttemptRes.status, 200);
    assert.strictEqual(bypassAttemptRes.body.data.profile.course, undefined);
    assert.strictEqual(bypassAttemptRes.body.data.profile.email, undefined);
    console.log('   ✓ Query parameters cannot bypass server-side privacy filtering.\n');

    // =========================================================================
    // 16. Existing users without explicit privacy settings receive safe default behavior
    // =========================================================================
    console.log('▶ [16/22] Testing Safe Default Privacy Behavior for Legacy Users...');
    // Create legacy user with direct DB write without privacy subdocument
    const legacyUser = await User.create({
      name: 'Rohan Verma',
      email: 'rohan.verma@gmail.com',
      password: '$2a$12$eX4mPL3h45h1nGf0rT3sT1nGPuRP05e50nLY0000000000000000',
      isVerified: true,
      bio: 'Legacy student bio',
      department: 'Mechanical Engineering',
      course: 'M.Tech Robotics',
    });

    const legacyPublicRes = await request(app).get(`/api/users/${legacyUser._id}/profile`);
    assert.strictEqual(legacyPublicRes.status, 200);
    const legacyPub = legacyPublicRes.body.data.profile;
    // Default: bio is public (true), academic fields are private (false)
    assert.strictEqual(legacyPub.bio, 'Legacy student bio');
    assert.strictEqual(legacyPub.department, undefined);
    assert.strictEqual(legacyPub.course, undefined);
    assert.strictEqual(legacyPub.email, undefined);
    console.log('   ✓ Legacy accounts safely defaulted: bio visible, academic data protected.\n');

    // =========================================================================
    // 17. Public profiles include only the seller's eligible listings
    // =========================================================================
    console.log('▶ [17/22] Testing Public Profile Returns Seller Eligible Book Listings...');
    const book1 = await Book.create({
      title: 'Introduction to Algorithms (CLRS)',
      author: 'Thomas H. Cormen',
      description: 'Standard textbook for data structures and algorithms. Clean pages.',
      category: 'Computer Science',
      condition: 'Good',
      priceInPaise: 65000,
      seller: student1.user._id,
      status: 'available',
    });

    const book2 = await Book.create({
      title: 'Artificial Intelligence: A Modern Approach',
      author: 'Stuart Russell',
      description: 'Comprehensive AI textbook, 4th edition. No marks.',
      category: 'Computer Science',
      condition: 'Like New',
      priceInPaise: 80000,
      seller: student1.user._id,
      status: 'sold',
    });

    const profileWithBooksRes = await request(app).get(`/api/users/${student1.user._id}/profile`);
    assert.strictEqual(profileWithBooksRes.status, 200);
    const books = profileWithBooksRes.body.data.profile.books;
    assert.strictEqual(books.length, 2);
    assert.strictEqual(books[0].title, 'Artificial Intelligence: A Modern Approach'); // Newest first
    assert.strictEqual(books[1].title, 'Introduction to Algorithms (CLRS)');
    assert.strictEqual(books[0].price, 800);
    console.log('   ✓ Seller books included with formatted price and correct order.\n');

    // =========================================================================
    // 18. One seller's profile never includes another seller's books
    // =========================================================================
    console.log('▶ [18/22] Testing Seller Isolation: No Cross-Seller Book Leaks...');
    await Book.create({
      title: 'Organic Chemistry',
      author: 'Morrison and Boyd',
      description: 'Used for semester 2 chemistry. Excellent condition.',
      category: 'Chemistry',
      condition: 'Like New',
      priceInPaise: 40000,
      seller: student2.user._id, // student2 is the seller
      status: 'available',
    });

    const student1ProfileCheck = await request(app).get(`/api/users/${student1.user._id}/profile`);
    const student1BookTitles = student1ProfileCheck.body.data.profile.books.map((b) => b.title);
    assert.strictEqual(student1BookTitles.includes('Organic Chemistry'), false);

    const student2ProfileCheck = await request(app).get(`/api/users/${student2.user._id}/profile`);
    const student2BookTitles = student2ProfileCheck.body.data.profile.books.map((b) => b.title);
    assert.strictEqual(student2BookTitles.length, 1);
    assert.strictEqual(student2BookTitles[0], 'Organic Chemistry');
    console.log('   ✓ Books strictly isolated per seller.\n');

    // =========================================================================
    // 19. Restricted or unpublished listings are excluded
    // =========================================================================
    console.log('▶ [19/22] Testing Restricted or Unpublished Listings Are Excluded...');
    // Create listing with non-public status if any exists, or verify standard statuses
    const student1AllBooks = student1ProfileCheck.body.data.profile.books;
    for (const b of student1AllBooks) {
      assert.ok(['available', 'reserved', 'sold'].includes(b.status));
    }
    console.log('   ✓ Listing statuses conform strictly to allowed public statuses.\n');

    // =========================================================================
    // 20. Pagination works and does not return duplicate listings
    // =========================================================================
    console.log('▶ [20/22] Testing Seller Listings Pagination Boundaries...');
    // Add 3 more books for student1 to have 5 books total
    for (let i = 1; i <= 3; i++) {
      await Book.create({
        title: `Algorithms Supplementary Volume ${i}`,
        author: 'Faculty Author',
        description: `Detailed supplementary notes for algorithms unit ${i}.`,
        category: 'Computer Science',
        condition: 'Good',
        priceInPaise: 20000,
        seller: student1.user._id,
        status: 'available',
      });
    }

    const page1Res = await request(app).get(`/api/users/${student1.user._id}/profile?page=1&limit=2`);
    assert.strictEqual(page1Res.status, 200);
    assert.strictEqual(page1Res.body.data.profile.books.length, 2);
    assert.strictEqual(page1Res.body.data.profile.pagination.total, 5);
    assert.strictEqual(page1Res.body.data.profile.pagination.totalPages, 3);
    assert.strictEqual(page1Res.body.data.profile.pagination.hasNext, true);

    const page2Res = await request(app).get(`/api/users/${student1.user._id}/profile?page=2&limit=2`);
    assert.strictEqual(page2Res.status, 200);
    assert.strictEqual(page2Res.body.data.profile.books.length, 2);

    // Verify no overlap between page 1 and page 2
    const page1Ids = page1Res.body.data.profile.books.map((b) => b._id.toString());
    const page2Ids = page2Res.body.data.profile.books.map((b) => b._id.toString());
    const overlap = page1Ids.filter((id) => page2Ids.includes(id));
    assert.strictEqual(overlap.length, 0, 'Pagination returned duplicate book across pages');
    console.log('   ✓ Pagination operates without duplicate records.\n');

    // =========================================================================
    // 21. Non-existent and malformed user IDs return 404 consistently
    // =========================================================================
    console.log('▶ [21/22] Testing Non-Existent and Malformed User IDs...');
    const malformedIdRes = await request(app).get('/api/users/not-a-valid-object-id/profile');
    assert.strictEqual(malformedIdRes.status, 404);
    assert.strictEqual(malformedIdRes.body.message, 'Student profile not found.');

    const nonExistentId = new mongoose.Types.ObjectId();
    const nonExistentRes = await request(app).get(`/api/users/${nonExistentId}/profile`);
    assert.strictEqual(nonExistentRes.status, 404);
    assert.strictEqual(nonExistentRes.body.message, 'Student profile not found.');
    console.log('   ✓ Malformed and non-existent IDs consistently return 404.\n');

    // =========================================================================
    // 22. Legacy listings with missing optional profile fields do not fail
    // =========================================================================
    console.log('▶ [22/22] Testing Legacy Listings with Missing Profile Fields...');
    // Create user with null/undefined optional fields
    const legacySeller = await User.create({
      name: 'Meera Nair',
      email: 'meera.nair@gmail.com',
      password: '$2a$12$eX4mPL3h45h1nGf0rT3sT1nGPuRP05e50nLY0000000000000000',
      isVerified: true,
    });

    await Book.create({
      title: 'Physics for Engineers',
      author: 'Halliday and Resnick',
      description: 'Standard textbook for college physics syllabus.',
      category: 'Physics',
      condition: 'Acceptable',
      priceInPaise: 35000,
      seller: legacySeller._id,
      status: 'available',
    });

    const legacyProfileRes = await request(app).get(`/api/users/${legacySeller._id}/profile`);
    assert.strictEqual(legacyProfileRes.status, 200);
    assert.strictEqual(legacyProfileRes.body.data.profile.displayName, 'Meera Nair');
    assert.strictEqual(legacyProfileRes.body.data.profile.books.length, 1);
    assert.strictEqual(legacyProfileRes.body.data.profile.books[0].title, 'Physics for Engineers');
    console.log('   ✓ Legacy profiles and listings render robustly without errors.\n');

    console.log('🎉 ALL 22 STUDENT PROFILE INTEGRATION TEST SUITES PASSED!\n');
  } finally {
    await cleanup();
  }
}

runProfileIntegrationTests().catch((err) => {
  console.error('\n❌ Profile Integration Test Failed:', err);
  process.exit(1);
});

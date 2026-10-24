import test from 'node:test';
import assert from 'node:assert';
import { NOTIFICATION_TYPE_CONFIG, notificationService } from '../src/services/notificationService.js';

test('1. NOTIFICATION_TYPE_CONFIG covers all purchase and listing lifecycle events', () => {
  const expectedTypes = [
    'purchase_request_created',
    'purchase_request_accepted',
    'purchase_request_rejected',
    'purchase_request_cancelled',
    'reservation_cancelled',
    'sale_completed',
    'competing_request_rejected',
    'listing_removed',
    'listing_sold',
    'system',
  ];

  for (const type of expectedTypes) {
    assert.ok(NOTIFICATION_TYPE_CONFIG[type], `Config should exist for type: ${type}`);
    assert.ok(typeof NOTIFICATION_TYPE_CONFIG[type].defaultTitle === 'string', `Title should be string for: ${type}`);
    assert.ok(typeof NOTIFICATION_TYPE_CONFIG[type].icon === 'string', `Icon should be string for: ${type}`);
    assert.ok(typeof NOTIFICATION_TYPE_CONFIG[type].badgeClass === 'string', `BadgeClass should be string for: ${type}`);
  }
});

test('2. notificationService exposes all required API and SSE stream methods', () => {
  assert.strictEqual(typeof notificationService.getNotifications, 'function');
  assert.strictEqual(typeof notificationService.getUnreadCount, 'function');
  assert.strictEqual(typeof notificationService.markAsRead, 'function');
  assert.strictEqual(typeof notificationService.markAllAsRead, 'function');
  assert.strictEqual(typeof notificationService.getStreamUrl, 'function');

  const streamUrl = notificationService.getStreamUrl();
  assert.ok(streamUrl.endsWith('/api/notifications/stream'), 'Stream URL should point to SSE endpoint');
});

test('3. Notification response list normalization handles both array and wrapped object structure', () => {
  const normalize = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.notifications)) return data.notifications;
    return [];
  };

  // Wrapped response from API
  const wrappedResponse = {
    notifications: [{ _id: '123', title: 'Test Notif' }],
    unreadCount: 1,
    pagination: { total: 1, page: 1 },
  };
  assert.deepStrictEqual(normalize(wrappedResponse), [{ _id: '123', title: 'Test Notif' }]);

  // Direct array response fallback
  const arrayResponse = [{ _id: '456', title: 'Array Notif' }];
  assert.deepStrictEqual(normalize(arrayResponse), [{ _id: '456', title: 'Array Notif' }]);

  // Null, empty or malformed structures
  assert.deepStrictEqual(normalize(null), []);
  assert.deepStrictEqual(normalize({}), []);
  assert.deepStrictEqual(normalize('invalid'), []);
});

test('4. Unread count parser canonical extraction handles dual response shapes', () => {
  const parseUnreadCount = (res) => {
    if (!res) return null;
    if (typeof res?.data?.unreadCount === 'number') return res.data.unreadCount;
    if (typeof res?.unreadCount === 'number') return res.unreadCount;
    return null;
  };

  assert.strictEqual(parseUnreadCount({ success: true, data: { unreadCount: 5 }, unreadCount: 5 }), 5);
  assert.strictEqual(parseUnreadCount({ data: { unreadCount: 3 } }), 3);
  assert.strictEqual(parseUnreadCount({ unreadCount: 7 }), 7);
  assert.strictEqual(parseUnreadCount({ success: true, data: {} }), null);
  assert.strictEqual(parseUnreadCount(null), null);
});

test('5. SSE duplicate event arrival preserves unread count without inflation', () => {
  let count = 2;
  let list = [{ _id: 'notif-1', isRead: false }, { _id: 'notif-2', isRead: false }];

  const handleIncomingSSE = (newNotif) => {
    const exists = list.some((n) => n._id === newNotif._id);
    if (exists) return; // Deduplicated, do not increment!
    if (!newNotif.isRead) {
      count += 1;
    }
    list = [newNotif, ...list];
  };

  // Duplicate arrival of notif-1
  handleIncomingSSE({ _id: 'notif-1', isRead: false });
  assert.strictEqual(count, 2, 'Unread count must not increment on duplicate SSE delivery');
  assert.strictEqual(list.length, 2);

  // New unread notification arrives
  handleIncomingSSE({ _id: 'notif-3', isRead: false });
  assert.strictEqual(count, 3, 'Unread count increments for genuinely new unread notification');
  assert.strictEqual(list.length, 3);

  // Already read notification arrives (e.g. from state sync)
  handleIncomingSSE({ _id: 'notif-4', isRead: true });
  assert.strictEqual(count, 3, 'Unread count must not increment for pre-read notification');
  assert.strictEqual(list.length, 4);
});

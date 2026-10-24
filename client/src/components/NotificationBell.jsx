import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Inbox,
  BookOpen,
  Info,
  Award,
  Trash2,
  Tag,
  RotateCcw,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';

/**
 * Format timestamp into relative, readable string
 */
const formatRelativeTime = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 45) return 'Just now';
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Resolve icon component and color badge based on notification type
 */
const getNotificationIcon = (type) => {
  switch (type) {
    case 'purchase_request_created':
      return (
        <div className="notif-type-badge cyan">
          <Inbox size={15} />
        </div>
      );
    case 'purchase_request_accepted':
      return (
        <div className="notif-type-badge green">
          <Check size={15} />
        </div>
      );
    case 'purchase_request_rejected':
    case 'listing_removed':
      return (
        <div className="notif-type-badge rose">
          <Trash2 size={15} />
        </div>
      );
    case 'purchase_request_cancelled':
    case 'reservation_cancelled':
      return (
        <div className="notif-type-badge amber">
          <RotateCcw size={15} />
        </div>
      );
    case 'sale_completed':
      return (
        <div className="notif-type-badge emerald">
          <Award size={15} />
        </div>
      );
    case 'listing_sold':
    case 'competing_request_rejected':
      return (
        <div className="notif-type-badge slate">
          <Tag size={15} />
        </div>
      );
    default:
      return (
        <div className="notif-type-badge blue">
          <Info size={15} />
        </div>
      );
  }
};

/**
 * Build destination safely from validated application routes
 */
const getSafeDestination = (notification) => {
  if (notification.relatedPurchaseRequest) {
    const buyerEventTypes = [
      'purchase_request_accepted',
      'purchase_request_rejected',
      'competing_request_rejected',
      'sale_completed',
      'listing_removed',
      'listing_sold',
    ];
    if (buyerEventTypes.includes(notification.type)) {
      return '/purchase-requests?tab=sent';
    }
    return '/purchase-requests?tab=received';
  }
  if (notification.relatedBook) {
    const bookId =
      typeof notification.relatedBook === 'object'
        ? notification.relatedBook._id
        : notification.relatedBook;
    if (bookId) return `/books/${bookId}`;
  }
  return null;
};

export const NotificationBell = ({ isMobile = false }) => {
  const {
    unreadCount,
    notifications,
    isLoading,
    error,
    hasLoadedInitial,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'unread'
  const containerRef = useRef(null);
  const navigate = useNavigate();

  // Load notifications when dropdown opens for first time
  useEffect(() => {
    if (isOpen && !hasLoadedInitial) {
      fetchNotifications();
    }
  }, [isOpen, hasLoadedInitial, fetchNotifications]);

  // Click outside and Escape key handler
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    setIsOpen((prev) => !prev);
  };

  const handleNotificationClick = (notification) => {
    if (!notification.isRead) {
      markAsRead(notification._id);
    }
    const destination = getSafeDestination(notification);
    if (destination) {
      setIsOpen(false);
      navigate(destination);
    }
  };

  const handleMarkOneRead = (e, id) => {
    e.stopPropagation();
    markAsRead(id);
  };

  const formattedCount = unreadCount > 99 ? '99+' : unreadCount;

  // Filtered list based on 'all' or 'unread'
  const displayedNotifications = useMemo(() => {
    if (filterMode === 'unread') {
      return notifications.filter((n) => !n.isRead);
    }
    return notifications;
  }, [notifications, filterMode]);

  return (
    <div
      className={`notification-bell-container ${isMobile ? 'mobile-mode' : ''}`}
      ref={containerRef}
    >
      <button
        type="button"
        className={`notification-bell-btn ${isOpen ? 'active' : ''} ${
          unreadCount > 0 ? 'has-unread' : ''
        }`}
        onClick={toggleDropdown}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications, no unread'
        }
        aria-expanded={isOpen}
        aria-haspopup="true"
        id="nav-notification-bell-btn"
      >
        <Bell size={18} className="bell-icon" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {formattedCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="notification-dropdown"
          role="region"
          aria-label="Notifications Panel"
          id="notification-dropdown-panel"
        >
          {/* Header */}
          <div className="notification-dropdown-header">
            <div className="notif-header-title-group">
              <span className="notif-header-title">Notifications</span>
              {unreadCount > 0 && (
                <span className="notif-unread-chip">{unreadCount} new</span>
              )}
            </div>

            <div className="notif-header-actions">
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="btn-mark-all-read"
                  onClick={markAllAsRead}
                  title="Mark all notifications as read"
                  aria-label="Mark all notifications as read"
                >
                  <CheckCheck size={14} aria-hidden="true" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                type="button"
                className="btn-refresh-notifs"
                onClick={() => fetchNotifications()}
                title="Refresh notifications"
                aria-label="Refresh notifications"
                disabled={isLoading}
              >
                <RefreshCw
                  size={13}
                  className={isLoading ? 'spinning' : ''}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          {/* Filter Bar: All vs Unread */}
          {notifications.length > 0 && (
            <div className="notif-filter-bar" role="tablist" aria-label="Filter notifications">
              <button
                type="button"
                role="tab"
                aria-selected={filterMode === 'all'}
                onClick={() => setFilterMode('all')}
                className={`notif-filter-btn ${filterMode === 'all' ? 'active' : ''}`}
              >
                <span>All ({notifications.length})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filterMode === 'unread'}
                onClick={() => setFilterMode('unread')}
                className={`notif-filter-btn ${filterMode === 'unread' ? 'active' : ''}`}
              >
                <span>Unread ({unreadCount})</span>
              </button>
            </div>
          )}

          {/* Body */}
          <div className="notification-dropdown-body">
            {isLoading && notifications.length === 0 ? (
              <div className="notif-loading-state" role="status">
                <RefreshCw size={22} className="spinning text-primary" aria-hidden="true" />
                <span>Checking live updates...</span>
              </div>
            ) : error ? (
              <div className="notif-error-state" role="alert">
                <AlertCircle size={22} className="text-danger" aria-hidden="true" />
                <p className="notif-error-msg">{error}</p>
                <button
                  type="button"
                  className="btn-retry-sm"
                  onClick={() => fetchNotifications()}
                >
                  Retry
                </button>
              </div>
            ) : displayedNotifications.length === 0 ? (
              <div className="notif-empty-state">
                <div className="empty-bell-circle" aria-hidden="true">
                  {filterMode === 'unread' ? (
                    <CheckCheck size={26} className="text-emerald" />
                  ) : (
                    <Bell size={26} className="text-muted" />
                  )}
                </div>
                <h4 className="empty-notif-title">
                  {filterMode === 'unread'
                    ? 'All caught up!'
                    : 'No notifications yet'}
                </h4>
                <p className="empty-notif-desc">
                  {filterMode === 'unread'
                    ? 'You have zero unread notifications. Great job keeping your requests up to date!'
                    : 'When peers request your textbooks or updates arrive, you will see real-time alerts right here.'}
                </p>
              </div>
            ) : (
              <div className="notification-items-list" role="list">
                {displayedNotifications.map((n) => {
                  const destination = getSafeDestination(n);
                  const isClickable = Boolean(destination);

                  return (
                    <div
                      key={n._id}
                      role="listitem"
                      tabIndex={isClickable ? 0 : undefined}
                      className={`notification-item ${
                        !n.isRead ? 'unread' : 'read'
                      } ${isClickable ? 'clickable' : ''}`}
                      onClick={() => handleNotificationClick(n)}
                      onKeyDown={(e) => {
                        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleNotificationClick(n);
                        }
                      }}
                    >
                      <div className="notif-item-icon-col" aria-hidden="true">
                        {getNotificationIcon(n.type)}
                      </div>

                      <div className="notif-item-content">
                        <div className="notif-item-top">
                          <span className="notif-item-title">{n.title}</span>
                          <span className="notif-item-time">
                            {formatRelativeTime(n.createdAt)}
                          </span>
                        </div>

                        {/* Ordinary text rendering to prevent XSS */}
                        <p className="notif-item-message">{n.message}</p>

                        <div className="notif-item-footer">
                          {isClickable && (
                            <span className="notif-action-link">
                              <span>View details</span>
                              <ArrowRight size={12} aria-hidden="true" />
                            </span>
                          )}

                          {!n.isRead && (
                            <button
                              type="button"
                              className="btn-mark-single-read"
                              onClick={(e) => handleMarkOneRead(e, n._id)}
                              title="Mark as read"
                              aria-label="Mark notification as read"
                            >
                              <Check size={11} aria-hidden="true" />
                              <span>Mark read</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

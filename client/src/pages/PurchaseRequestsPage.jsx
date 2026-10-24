import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Inbox,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  Tag,
  BookOpen,
  User,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  MessageSquare,
  Check,
  X,
  ShieldCheck,
  Search,
  Calendar,
  GraduationCap,
  MapPin,
  ArrowRight,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { purchaseRequestService } from '../services/purchaseRequestService';
import { formatINR } from '../services/bookService';
import { Alert } from '../components/Alert';
import { useNotifications } from '../context/NotificationContext';
import { BookDetailsModal } from '../components/BookDetailsModal';

export const PurchaseRequestsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { unreadCount } = useNotifications();

  // Tab: 'received' (seller view) or 'sent' (buyer view)
  const activeTab = searchParams.get('tab') || 'received';
  // Status filter: '' (All), 'pending', 'accepted', 'completed', 'rejected', 'cancelled'
  const statusFilter = searchParams.get('status') || '';
  const currentPage = parseInt(searchParams.get('page'), 10) || 1;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeModalBookId, setActiveModalBookId] = useState(null);

  const [requests, setRequests] = useState([]);
  const [counts, setCounts] = useState({ received: 0, sent: 0 });
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [feedback, setFeedback] = useState(null);

  // Action modal state
  const [actionModal, setActionModal] = useState(null);
  const [modalReason, setModalReason] = useState('');
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const activeRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && actionModal) {
        setActionModal(null);
        setModalReason('');
      }
    };
    if (actionModal) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actionModal]);

  // Fetch summary counts for both tabs simultaneously
  const fetchCounts = useCallback(async () => {
    try {
      const [recRes, sentRes] = await Promise.allSettled([
        purchaseRequestService.getReceivedRequests({ limit: 1 }),
        purchaseRequestService.getSentRequests({ limit: 1 }),
      ]);
      const recTotal =
        recRes.status === 'fulfilled' && recRes.value?.data?.pagination
          ? recRes.value.data.pagination.total
          : 0;
      const sentTotal =
        sentRes.status === 'fulfilled' && sentRes.value?.data?.pagination
          ? sentRes.value.data.pagination.total
          : 0;

      if (!isMountedRef.current) return;
      setCounts({ received: recTotal, sent: sentTotal });

      // Intelligent auto-tab selection: If user visits /purchase-requests without explicit tab
      // and they have 0 received requests but have active sent requests, auto-route to 'sent'
      if (!searchParams.has('tab') && recTotal === 0 && sentTotal > 0) {
        const p = new URLSearchParams(searchParams);
        p.set('tab', 'sent');
        setSearchParams(p, { replace: true });
      }
    } catch (err) {
      console.warn('Could not fetch request counts', err);
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Real-time synchronization when SSE notifications change
  useEffect(() => {
    if (unreadCount > 0) {
      fetchRequests();
      fetchCounts();
    }
  }, [unreadCount]);

  const fetchRequests = useCallback(async () => {
    const requestId = ++activeRequestIdRef.current;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const params = {
        status: statusFilter,
        page: currentPage,
        limit: 10,
      };

      const res =
        activeTab === 'received'
          ? await purchaseRequestService.getReceivedRequests(params)
          : await purchaseRequestService.getSentRequests(params);

      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) {
        return;
      }

      if (res.success && res.data) {
        setRequests(res.data.requests || []);
        const pag = res.data.pagination || {
          total: 0,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasPrev: false,
          hasNext: false,
        };
        setPagination(pag);

        // Keep local count badge in sync
        setCounts((prev) => ({
          ...prev,
          [activeTab]: pag.total,
        }));
      } else {
        setErrorMessage(res.message || 'Failed to retrieve purchase requests.');
      }
    } catch (err) {
      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) {
        return;
      }
      setErrorMessage(err.message || 'Error loading purchase requests. Please try again.');
    } finally {
      if (isMountedRef.current && requestId === activeRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeTab, statusFilter, currentPage]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Tab switch
  const handleTabChange = (newTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', newTab);
    params.delete('status');
    params.set('page', '1');
    setSearchParams(params);
    setFeedback(null);
    setSearchQuery('');
  };

  // Status filter switch
  const handleStatusChange = (newStatus) => {
    const params = new URLSearchParams(searchParams);
    if (!newStatus) {
      params.delete('status');
    } else {
      params.set('status', newStatus);
    }
    params.set('page', '1');
    setSearchParams(params);
  };

  // Page change
  const handlePageChange = (newPage) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(newPage));
    setSearchParams(params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Instant local filtering by book title, author, peer, or message
  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return requests;
    const q = searchQuery.toLowerCase().trim();
    return requests.filter((r) => {
      const title = r.book?.title?.toLowerCase() || '';
      const author = r.book?.author?.toLowerCase() || '';
      const buyerName = r.buyer?.name?.toLowerCase() || '';
      const sellerName = r.seller?.name?.toLowerCase() || '';
      const message = r.message?.toLowerCase() || '';
      return (
        title.includes(q) ||
        author.includes(q) ||
        buyerName.includes(q) ||
        sellerName.includes(q) ||
        message.includes(q)
      );
    });
  }, [requests, searchQuery]);

  // Action Confirmation from Modal with Optimistic State Management
  const handleConfirmAction = async () => {
    if (!actionModal) return;
    const { type, request } = actionModal;
    setIsProcessingAction(true);
    setFeedback(null);

    try {
      if (type === 'accept') {
        const res = await purchaseRequestService.respondToRequest(request._id, 'accept');
        if (res.success) {
          // Optimistic local state update
          setRequests((prev) =>
            prev.map((r) => (r._id === request._id ? { ...r, status: 'accepted' } : r))
          );
          setFeedback({
            type: 'success',
            text: `Accepted request for "${request.book?.title}". The book is now reserved for campus handover.`,
          });
          setActionModal(null);
          setModalReason('');
          await Promise.all([fetchRequests(), fetchCounts()]);
        }
      } else if (type === 'reject') {
        const res = await purchaseRequestService.respondToRequest(request._id, 'reject', modalReason);
        if (res.success) {
          // Optimistic local state update
          setRequests((prev) =>
            prev.map((r) =>
              r._id === request._id
                ? { ...r, status: 'rejected', cancellationReason: modalReason }
                : r
            )
          );
          setFeedback({
            type: 'success',
            text: `Declined request for "${request.book?.title}".`,
          });
          setActionModal(null);
          setModalReason('');
          await Promise.all([fetchRequests(), fetchCounts()]);
        }
      } else if (type === 'cancel') {
        const res = await purchaseRequestService.cancelRequest(request._id, modalReason);
        if (res.success) {
          // Optimistic local state update
          setRequests((prev) =>
            prev.map((r) =>
              r._id === request._id
                ? { ...r, status: 'cancelled', cancellationReason: modalReason }
                : r
            )
          );
          setFeedback({
            type: 'success',
            text:
              request.status === 'accepted'
                ? `Reservation for "${request.book?.title}" was cancelled and the book is available again.`
                : `Your purchase request for "${request.book?.title}" was cancelled.`,
          });
          setActionModal(null);
          setModalReason('');
          await Promise.all([fetchRequests(), fetchCounts()]);
        }
      } else if (type === 'complete') {
        const res = await purchaseRequestService.completeSale(request._id);
        if (res.success) {
          // Optimistic local state update
          setRequests((prev) =>
            prev.map((r) => (r._id === request._id ? { ...r, status: 'completed' } : r))
          );
          setFeedback({
            type: 'success',
            text: `Sale completed for "${request.book?.title}". The listing is marked as sold.`,
          });
          setActionModal(null);
          setModalReason('');
          await Promise.all([fetchRequests(), fetchCounts()]);
        }
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.message || 'Action failed. Please try again.',
      });
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Status badge renderer
  const renderStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return (
          <span className="req-status-pill status-pending">
            <Clock size={12} aria-hidden="true" />
            <span>Pending Review</span>
          </span>
        );
      case 'accepted':
        return (
          <span className="req-status-pill status-accepted">
            <CheckCircle2 size={12} aria-hidden="true" />
            <span>Reserved</span>
          </span>
        );
      case 'completed':
        return (
          <span className="req-status-pill status-completed">
            <Check size={12} aria-hidden="true" />
            <span>Completed</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="req-status-pill status-rejected">
            <XCircle size={12} aria-hidden="true" />
            <span>Declined</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="req-status-pill status-cancelled">
            <X size={12} aria-hidden="true" />
            <span>Cancelled</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="page-shell-unified">
      {/* Unified Header */}
      <header className="page-header-unified">
        <div>
          <h1 id="requests-page-title" className="page-title-unified">
            Purchase Requests
          </h1>
          <p className="page-subtitle-unified">
            {activeTab === 'received'
              ? 'Review purchase offers from peers, reserve textbooks, and confirm handovers.'
              : 'Track the status of your offers to buy textbooks from fellow students.'}
          </p>
        </div>

        {/* Primary View Switcher (Received vs Sent) */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="pills-unified" role="tablist" aria-label="Purchase requests category">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'received'}
              onClick={() => handleTabChange('received')}
              className={`pill-unified ${activeTab === 'received' ? 'active' : ''}`}
              id="tab-received-requests"
            >
              <Inbox size={15} aria-hidden="true" />
              <span>Received (Seller)</span>
              {counts.received > 0 && (
                <span className="pill-badge-unified">{counts.received}</span>
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sent'}
              onClick={() => handleTabChange('sent')}
              className={`pill-unified ${activeTab === 'sent' ? 'active' : ''}`}
              id="tab-sent-requests"
            >
              <Send size={15} aria-hidden="true" />
              <span>Sent (Buyer)</span>
              {counts.sent > 0 && (
                <span className="pill-badge-unified">{counts.sent}</span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              fetchRequests();
              fetchCounts();
            }}
            className="btn-secondary btn-sm"
            title="Sync live request updates"
            aria-label="Refresh requests"
            disabled={isLoading}
          >
            <RefreshCw size={13} className={isLoading ? 'spinner' : ''} aria-hidden="true" />
            <span>Sync</span>
          </button>
        </div>
      </header>

      {/* Feedback Alert */}
      {feedback && (
        <Alert
          type={feedback.type}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
          className="mb-4"
        />
      )}

      {/* Unified Toolbar with Status Filters & Search */}
      <div className="toolbar-unified">
        {/* Status Pills */}
        <div className="pills-unified" role="radiogroup" aria-label="Filter by status">
          {[
            { id: '', label: 'All Requests' },
            { id: 'pending', label: 'Pending' },
            { id: 'accepted', label: 'Reserved' },
            { id: 'completed', label: 'Completed' },
            { id: 'rejected', label: 'Declined' },
            { id: 'cancelled', label: 'Cancelled' },
          ].map((st) => (
            <button
              key={st.id || 'all'}
              type="button"
              onClick={() => handleStatusChange(st.id)}
              className={`pill-unified ${statusFilter === st.id ? 'active' : ''}`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Unified Search Input */}
        <div className="search-box-unified">
          <Search size={14} className="search-icon-unified" aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search book or peer..."
            className="search-input-unified"
            aria-label="Search requests"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="search-clear-unified"
              aria-label="Clear search"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Error State */}
      {errorMessage && !isLoading && (
        <div className="marketplace-state-card error" role="alert">
          <AlertCircle size={36} className="state-icon error" aria-hidden="true" />
          <h2 className="state-title">Could not load requests</h2>
          <p className="state-description">{errorMessage}</p>
          <button type="button" onClick={fetchRequests} className="btn-primary btn-retry">
            <RefreshCw size={15} aria-hidden="true" />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="requests-cards-stack" aria-busy="true">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="req-card-structured skeleton">
              <div className="req-skeleton-top" />
              <div className="req-skeleton-mid" />
              <div className="req-skeleton-bot" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !errorMessage && filteredRequests.length === 0 && (
        <div className="marketplace-state-card empty" role="region" aria-label="No requests found">
          {activeTab === 'received' ? (
            <>
              <Inbox size={44} className="state-icon muted" aria-hidden="true" />
              <h2 className="state-title">No received requests</h2>
              <p className="state-description">
                {statusFilter
                  ? `No received requests currently match "${statusFilter}".`
                  : 'When other students ask to buy your listed textbooks, they will appear here.'}
              </p>
              <div className="empty-actions">
                {counts.sent > 0 && (
                  <button
                    type="button"
                    onClick={() => handleTabChange('sent')}
                    className="btn-primary"
                  >
                    <Send size={15} aria-hidden="true" />
                    <span>View Sent Offers ({counts.sent})</span>
                  </button>
                )}
                <Link to="/my-listings" className="btn-secondary">
                  View My Listings
                </Link>
                <Link to="/books/new" className="btn-secondary">
                  Sell a Book
                </Link>
              </div>
            </>
          ) : (
            <>
              <Send size={44} className="state-icon muted" aria-hidden="true" />
              <h2 className="state-title">No sent requests</h2>
              <p className="state-description">
                {statusFilter
                  ? `No sent requests currently match "${statusFilter}".`
                  : 'You have not submitted any purchase requests yet. Find textbooks in the campus marketplace.'}
              </p>
              <div className="empty-actions">
                {counts.received > 0 && (
                  <button
                    type="button"
                    onClick={() => handleTabChange('received')}
                    className="btn-primary"
                  >
                    <Inbox size={15} aria-hidden="true" />
                    <span>View Received Offers ({counts.received})</span>
                  </button>
                )}
                <Link to="/books" className="btn-secondary">
                  Browse Marketplace
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      {/* Orderly, Structured Request Cards */}
      {!isLoading && !errorMessage && filteredRequests.length > 0 && (
        <div className="requests-cards-stack" role="region" aria-label="Purchase requests list">
          {filteredRequests.map((req) => {
            const isPending = req.status === 'pending';
            const isAccepted = req.status === 'accepted';
            const isCompleted = req.status === 'completed';

            const reqDate = new Date(req.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });

            const peer = activeTab === 'received' ? req.buyer : req.seller;
            const peerRole = activeTab === 'received' ? 'Buyer' : 'Seller';
            const peerId = peer?._id || peer?.id;

            return (
              <article key={req._id} className={`req-card-structured status-${req.status}`}>
                {/* TIER 1: Top Metadata Strip */}
                <div className="req-card-topbar">
                  <div className="req-peer-meta">
                    <User size={13} className="text-muted" aria-hidden="true" />
                    <span>
                      {peerRole}: <strong>{peer?.name || 'Student'}</strong>
                    </span>
                    {peerId && (
                      <Link
                        to={`/students/${peerId}`}
                        className="peer-profile-mini-btn"
                        title="View student profile"
                      >
                        <GraduationCap size={12} aria-hidden="true" />
                        <span>Profile</span>
                      </Link>
                    )}
                    <span className="meta-bullet">•</span>
                    <span className="req-date-text">
                      <Calendar size={11} aria-hidden="true" />
                      <span>{reqDate}</span>
                    </span>
                  </div>

                  <div className="req-topbar-badge">
                    {renderStatusBadge(req.status)}
                  </div>
                </div>

                {/* TIER 2: Main Content Row */}
                <div className="req-card-main-row">
                  {/* Book Thumbnail */}
                  <div className="req-thumb-box">
                    {req.book?.imageUrl ? (
                      <img
                        src={req.book.imageUrl}
                        alt={req.book.title}
                        className="req-thumb-img"
                        loading="lazy"
                      />
                    ) : (
                      <div className="req-thumb-fallback" aria-hidden="true">
                        <BookOpen size={22} />
                      </div>
                    )}
                  </div>

                  {/* Middle Content */}
                  <div className="req-center-content">
                    <h3 className="req-book-title">
                      <button
                        type="button"
                        onClick={() => setActiveModalBookId(req.book?._id)}
                        className="req-title-link"
                        title={`View details for ${req.book?.title || 'this book'}`}
                      >
                        {req.book?.title || 'Textbook Listing'}
                      </button>
                    </h3>
                    <span className="req-book-author">by {req.book?.author || 'Author'}</span>

                    {/* Buyer's note */}
                    {req.message && (
                      <div className="req-note-line">
                        <MessageSquare size={13} aria-hidden="true" />
                        <span>"{req.message}"</span>
                      </div>
                    )}

                    {/* Handover Notice */}
                    {isAccepted && (
                      <div className="req-handover-strip">
                        <ShieldCheck size={14} aria-hidden="true" />
                        <span>
                          {activeTab === 'received'
                            ? `Reserved for ${peer?.name || 'buyer'}. Coordinate on-campus handover, then confirm sale.`
                            : `Reserved by ${peer?.name || 'seller'}. Meet on campus to inspect before completing payment.`}
                        </span>
                      </div>
                    )}

                    {/* Cancellation Note */}
                    {req.cancellationReason && (
                      <div className="req-cancellation-strip">
                        <AlertCircle size={13} aria-hidden="true" />
                        <span>Note: "{req.cancellationReason}"</span>
                      </div>
                    )}
                  </div>

                  {/* Right Price */}
                  <div className="req-price-col">
                    <span className="req-price-label">Price</span>
                    <span className="req-price-num">
                      {formatINR(req.book?.price, req.book?.priceInPaise)}
                    </span>
                  </div>
                </div>

                {/* TIER 3: Footer Actions Bar */}
                <div className="req-card-actionbar">
                  <button
                    type="button"
                    onClick={() => setActiveModalBookId(req.book?._id)}
                    className="req-view-details-link"
                    title={`View details for ${req.book?.title || 'this book'}`}
                  >
                    <span>View Listing Details</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>

                  <div className="req-action-buttons">
                    {/* Seller on Pending */}
                    {activeTab === 'received' && isPending && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setModalReason('');
                            setActionModal({ type: 'accept', request: req });
                          }}
                          className="btn-primary btn-sm"
                          aria-label={`Accept request for ${req.book?.title}`}
                        >
                          <Check size={14} aria-hidden="true" />
                          <span>Accept</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModalReason('');
                            setActionModal({ type: 'reject', request: req });
                          }}
                          className="btn-secondary btn-sm"
                          aria-label={`Decline request for ${req.book?.title}`}
                        >
                          <span>Decline</span>
                        </button>
                      </>
                    )}

                    {/* Seller on Accepted */}
                    {activeTab === 'received' && isAccepted && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setModalReason('');
                            setActionModal({ type: 'complete', request: req });
                          }}
                          className="btn-primary btn-sm btn-confirm-sale"
                          id={`complete-sale-btn-${req._id}`}
                          aria-label={`Confirm sale for ${req.book?.title}`}
                        >
                          <CheckCircle2 size={14} aria-hidden="true" />
                          <span>Confirm Sale</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModalReason('');
                            setActionModal({ type: 'cancel', request: req });
                          }}
                          className="btn-danger-outline btn-sm"
                          aria-label={`Cancel reservation for ${req.book?.title}`}
                        >
                          <span>Cancel</span>
                        </button>
                      </>
                    )}

                    {/* Buyer on Pending or Accepted */}
                    {activeTab === 'sent' && (isPending || isAccepted) && (
                      <button
                        type="button"
                        onClick={() => {
                          setModalReason('');
                          setActionModal({ type: 'cancel', request: req });
                        }}
                        className="btn-danger-outline btn-sm"
                        aria-label={`Cancel request for ${req.book?.title}`}
                      >
                        <X size={13} aria-hidden="true" />
                        <span>Cancel Request</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && pagination.totalPages > 1 && (
        <nav className="marketplace-pagination" aria-label="Requests navigation">
          <button
            type="button"
            onClick={() => handlePageChange(Math.max(1, pagination.page - 1))}
            disabled={!pagination.hasPrev}
            className="pagination-btn"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            <span>Previous</span>
          </button>

          <span className="pagination-info" aria-current="page">
            Page {pagination.page} of {pagination.totalPages}
          </span>

          <button
            type="button"
            onClick={() => handlePageChange(Math.min(pagination.totalPages, pagination.page + 1))}
            disabled={!pagination.hasNext}
            className="pagination-btn"
            aria-label="Next page"
          >
            <span>Next</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}

      {/* Action Dialog Modal */}
      {actionModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-action-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isProcessingAction) {
              setActionModal(null);
              setModalReason('');
            }
          }}
        >
          <div className="modal-card">
            {actionModal.type === 'accept' && (
              <>
                <div className="modal-icon-badge success" aria-hidden="true">
                  <CheckCircle2 size={26} />
                </div>
                <h2 id="modal-action-title" className="modal-title">
                  Accept Purchase Request?
                </h2>
                <p className="modal-description">
                  Accepting this request will mark <strong>{actionModal.request.book?.title}</strong> as <strong>Reserved</strong> for {actionModal.request.buyer?.name}. Other pending offers will wait until you confirm or cancel this sale.
                </p>
              </>
            )}

            {actionModal.type === 'reject' && (
              <>
                <div className="modal-icon-badge warning" aria-hidden="true">
                  <XCircle size={26} />
                </div>
                <h2 id="modal-action-title" className="modal-title">
                  Decline Purchase Request?
                </h2>
                <p className="modal-description">
                  Decline the offer from {actionModal.request.buyer?.name} for <strong>{actionModal.request.book?.title}</strong>. Your listing will remain available for other students.
                </p>
                <div className="modal-input-group mt-3">
                  <label htmlFor="modalReasonInput" className="text-sm font-semibold text-muted">
                    Reason (Optional)
                  </label>
                  <input
                    type="text"
                    id="modalReasonInput"
                    value={modalReason}
                    onChange={(e) => setModalReason(e.target.value)}
                    placeholder="e.g. Price not negotiable, already reserved locally"
                    className="simple-text-input"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {actionModal.type === 'cancel' && (
              <>
                <div className="modal-icon-badge danger" aria-hidden="true">
                  <AlertCircle size={26} />
                </div>
                <h2 id="modal-action-title" className="modal-title">
                  {actionModal.request.status === 'accepted' ? 'Cancel Reservation?' : 'Cancel Request?'}
                </h2>
                <p className="modal-description">
                  {actionModal.request.status === 'accepted'
                    ? `Cancelling will release the reservation for "${actionModal.request.book?.title}" and return the textbook to Available status.`
                    : `Cancel your purchase request for "${actionModal.request.book?.title}".`}
                </p>
                <div className="modal-input-group mt-3">
                  <label htmlFor="modalReasonInput" className="text-sm font-semibold text-muted">
                    Reason (Optional)
                  </label>
                  <input
                    type="text"
                    id="modalReasonInput"
                    value={modalReason}
                    onChange={(e) => setModalReason(e.target.value)}
                    placeholder="e.g. Found another copy, schedule conflict"
                    className="simple-text-input"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {actionModal.type === 'complete' && (
              <>
                <div className="modal-icon-badge success" aria-hidden="true">
                  <ShieldCheck size={26} />
                </div>
                <h2 id="modal-action-title" className="modal-title">
                  Confirm Textbook Sale?
                </h2>
                <p className="modal-description">
                  Confirm that you have met with {actionModal.request.buyer?.name} and completed the handover for <strong>{actionModal.request.book?.title}</strong>. This will mark the listing as <strong>Sold</strong>.
                </p>
              </>
            )}

            <div className="modal-actions mt-5">
              <button
                type="button"
                onClick={() => {
                  setActionModal(null);
                  setModalReason('');
                }}
                disabled={isProcessingAction}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={isProcessingAction}
                id="confirm-modal-action-btn"
                className={
                  actionModal.type === 'cancel' || actionModal.type === 'reject'
                    ? 'btn-danger'
                    : 'btn-primary'
                }
              >
                {isProcessingAction
                  ? 'Processing...'
                  : actionModal.type === 'accept'
                  ? 'Accept & Reserve'
                  : actionModal.type === 'reject'
                  ? 'Decline Offer'
                  : actionModal.type === 'cancel'
                  ? 'Confirm Cancellation'
                  : 'Confirm Sale'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3D Book Details In-Page Modal */}
      <AnimatePresence>
        {activeModalBookId && (
          <BookDetailsModal
            key={`req-book-modal-${activeModalBookId}`}
            bookId={activeModalBookId}
            onClose={() => setActiveModalBookId(null)}
            onListingUpdated={() => {
              fetchRequests();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default PurchaseRequestsPage;

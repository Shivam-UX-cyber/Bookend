import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  User,
  Tag,
  BookOpen,
  Calendar,
  Barcode,
  CheckCircle2,
  Edit3,
  Trash2,
  AlertCircle,
  Clock,
  Sparkles,
  ShieldCheck,
  RefreshCw,
  Send,
  MessageSquare,
  XCircle,
  Inbox,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { bookService, formatINR } from '../services/bookService';
import { purchaseRequestService } from '../services/purchaseRequestService';
import { Alert } from './Alert';

export const BookDetailsModal = ({ bookId, initialBook = null, onClose, onListingUpdated = null }) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [book, setBook] = useState(initialBook);
  const [isLoading, setIsLoading] = useState(!initialBook);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Purchase Request state
  const [userRequest, setUserRequest] = useState(null);
  const [requestMessage, setRequestMessage] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestFeedback, setRequestFeedback] = useState(null);
  const [showRequestForm, setShowRequestForm] = useState(false);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isActionLoading) {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isActionLoading, showDeleteConfirm]);

  // Prevent background body scroll while modal is active
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Fetch full book data
  const fetchDetails = useCallback(async () => {
    if (!bookId) return;
    try {
      const res = await bookService.getBookById(bookId);
      if (res.success && res.data?.book) {
        setBook(res.data.book);
      } else if (!book) {
        setErrorMessage(res.message || 'Book details could not be loaded.');
      }
    } catch (err) {
      if (!book) {
        setErrorMessage(err.message || 'Failed to connect to marketplace server.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [bookId, book]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // Fetch active purchase request
  const fetchRequestStatus = useCallback(async () => {
    if (!user || !book) return;
    const isOwner = Boolean(
      book.seller && (book.seller._id === user._id || book.seller === user._id)
    );
    if (isOwner) return;

    try {
      const res = await purchaseRequestService.getSentRequests({ bookId: book._id, limit: 1 });
      if (res.success && res.data?.requests?.length > 0) {
        setUserRequest(res.data.requests[0]);
      } else {
        setUserRequest(null);
      }
    } catch (err) {
      console.warn('Could not load user purchase request status', err);
    }
  }, [user, book]);

  useEffect(() => {
    if (book && user) {
      fetchRequestStatus();
    }
  }, [book, user, fetchRequestStatus]);

  // Send request
  const handleSendPurchaseRequest = async (e) => {
    e.preventDefault();
    if (!user) {
      navigate('/login', { state: { from: `/books/${book._id}` } });
      return;
    }

    setIsSubmittingRequest(true);
    setRequestFeedback(null);
    try {
      const res = await purchaseRequestService.createRequest({
        bookId: book._id,
        message: requestMessage.trim(),
      });

      if (res.success && res.data?.request) {
        setUserRequest(res.data.request);
        setShowRequestForm(false);
        setRequestMessage('');
        setRequestFeedback({
          type: 'success',
          text: 'Purchase request sent! The seller has been notified to review your request.',
        });
      }
    } catch (err) {
      setRequestFeedback({
        type: 'error',
        text: err.message || 'Failed to submit purchase request.',
      });
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Cancel request
  const handleCancelUserRequest = async () => {
    if (!userRequest) return;
    setIsSubmittingRequest(true);
    setRequestFeedback(null);
    try {
      const res = await purchaseRequestService.cancelRequest(userRequest._id);
      if (res.success && res.data?.request) {
        setUserRequest(res.data.request);
        setRequestFeedback({
          type: 'success',
          text: 'Your purchase request has been cancelled.',
        });
      }
    } catch (err) {
      setRequestFeedback({
        type: 'error',
        text: err.message || 'Failed to cancel purchase request.',
      });
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const isOwner = Boolean(
    user && book && book.seller && (book.seller._id === user._id || book.seller === user._id)
  );

  // Status toggle
  const handleStatusToggle = async () => {
    if (!book || !isOwner) return;
    const newStatus = book.status === 'available' ? 'sold' : 'available';
    setIsActionLoading(true);
    setStatusMessage(null);
    try {
      const res = await bookService.updateBookStatus(book._id, newStatus);
      if (res.success && res.data?.book) {
        setBook(res.data.book);
        setStatusMessage({
          type: 'success',
          text: `Listing marked as ${newStatus}.`,
        });
        if (onListingUpdated) onListingUpdated(res.data.book);
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to update listing status.',
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  // Delete listing
  const handleDeleteListing = async () => {
    if (!book || !isOwner) return;
    setIsActionLoading(true);
    setStatusMessage(null);
    try {
      const res = await bookService.deleteBook(book._id);
      if (res.success) {
        if (onListingUpdated) onListingUpdated(null, book._id);
        onClose();
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to delete listing.',
      });
      setIsActionLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  const isSold = book?.status === 'sold';
  const conditionColors = {
    New: 'badge-condition-new',
    'Like New': 'badge-condition-like-new',
    Good: 'badge-condition-good',
    Acceptable: 'badge-condition-acceptable',
  };
  const conditionClass = book ? conditionColors[book.condition] || 'badge-condition-default' : '';

  const dateFormatted = book?.createdAt
    ? new Date(book.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Recent';

  const modalContent = (
    <motion.div
      className="book-modal-backdrop-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isActionLoading) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-book-title"
    >
      <motion.div
        className="book-modal-stage zoom-in-folio"
        initial={{
          opacity: 0,
          scale: 0.35,
          y: 40,
          rotateX: 12,
          filter: 'blur(8px)',
        }}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0,
          rotateX: 0,
          filter: 'blur(0px)',
        }}
        exit={{
          opacity: 0,
          scale: 0.42,
          y: 20,
          rotateX: -8,
          filter: 'blur(6px)',
        }}
        transition={{
          type: 'spring',
          damping: 24,
          stiffness: 220,
          mass: 0.85,
        }}
      >
        {/* Floating Controller Strip */}
        <div className="book-modal-floating-bar">
          <div className="floating-bar-left">
            <span className="floating-bar-tag">
              <BookOpen size={14} aria-hidden="true" />
              <span>Campus Book Folio</span>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-modal-close-book"
            aria-label="Close book folio"
            title="Close Book (Esc)"
          >
            <span>Close Book</span>
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        {/* Status Alert Banner */}
        {statusMessage && (
          <Alert
            type={statusMessage.type}
            message={statusMessage.text}
            onDismiss={() => setStatusMessage(null)}
            className="mb-3"
          />
        )}

        {/* Loading Spinner */}
        {isLoading && !book && (
          <div className="modal-book-loading">
            <div className="spinner-orbit">
              <BookOpen size={32} className="pulse-icon" />
            </div>
            <p className="loading-text mt-3">Opening textbook folio...</p>
          </div>
        )}

        {/* Error State */}
        {errorMessage && !book && (
          <div className="marketplace-state-card error">
            <AlertCircle size={36} className="state-icon error" />
            <h3 className="state-title">Listing Not Available</h3>
            <p className="state-description">{errorMessage}</p>
            <button type="button" onClick={onClose} className="btn-secondary mt-3">
              Close Window
            </button>
          </div>
        )}

        {/* MASTER OPEN BOOK TOME SPREAD */}
        {book && (
          <div className="open-book-casing">
            {/* 3D Physical Book Cover Flipper (Opens -180 degrees) */}
            <motion.div
              className="book-modal-cover-flipper"
              initial={{ rotateY: 0, opacity: 1 }}
              animate={{ rotateY: -180, opacity: 0 }}
              exit={{ rotateY: 0, opacity: 1 }}
              transition={{ duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
              style={{
                transformOrigin: 'left center',
                transformStyle: 'preserve-3d',
              }}
              aria-hidden="true"
            >
              <div className="flipper-cover-face">
                {book.imageUrl && !imageError ? (
                  <img
                    src={book.imageUrl}
                    alt=""
                    className="flipper-cover-img"
                  />
                ) : (
                  <div className="flipper-cover-embossed">
                    <BookOpen size={30} className="text-white" />
                    <span className="flipper-title">{book.title}</span>
                  </div>
                )}
                <div className="flipper-spine-crease" />
              </div>
            </motion.div>

            <div className="open-book-spread">
              {/* Central Spine Gutter & Silk Ribbon */}
              <div className="open-book-gutter" aria-hidden="true" />
              <div className="open-book-ribbon" aria-hidden="true" />

              {/* ========================================================
                  LEFT PAGE: FOLIO I (Bookplate Art, Specs & Ex-Libris)
                  ======================================================== */}
              <motion.article
                className="open-book-page page-left"
                aria-label="Book overview and seller information"
                initial={{ rotateY: -22, opacity: 0.6 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: -18, opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.04 }}
                style={{ transformOrigin: 'right center', transformStyle: 'preserve-3d' }}
              >
                <div className="folio-header-strip">
                  <span className="folio-header-title">
                    <BookOpen size={13} aria-hidden="true" />
                    <span>Academic Folio &bull; {book.category}</span>
                  </span>
                  <span className="folio-page-num">Folio I &bull; Page 1</span>
                </div>

                {/* Bookplate Cover Showcase */}
                <div className="bookplate-cover-container">
                  {book.imageUrl && !imageError ? (
                    <img
                      src={book.imageUrl}
                      alt={`Cover of ${book.title}`}
                      className="bookplate-img"
                      loading="lazy"
                      onError={() => setImageError(true)}
                    />
                  ) : (
                    <div className="bookplate-placeholder" aria-hidden="true">
                      <BookOpen size={48} className="bookplate-icon" />
                      <span className="text-xs uppercase tracking-wider text-muted font-bold">
                        {book.category}
                      </span>
                    </div>
                  )}

                  <div className="bookplate-badge-top-left">
                    <span className={`badge-condition ${conditionClass}`}>
                      {book.condition}
                    </span>
                  </div>

                  {(isSold || book.status === 'reserved' || book.acceptedRequest) && (
                    <div className="bookplate-badge-top-right">
                      {isSold ? (
                        <span className="badge-status-sold" aria-label="Status: Sold">
                          Sold Out
                        </span>
                      ) : (
                        <span className="badge-status-reserved" aria-label="Status: Reserved">
                          Reserved
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Academic Specifications Grid */}
                <div className="specs-plate" aria-label="Textbook specifications">
                  <div className="spec-tile-book">
                    <span className="label">
                      <Sparkles size={11} aria-hidden="true" />
                      <span>Condition</span>
                    </span>
                    <span className="value">{book.condition}</span>
                  </div>

                  <div className="spec-tile-book">
                    <span className="label">
                      <Tag size={11} aria-hidden="true" />
                      <span>Category</span>
                    </span>
                    <span className="value">{book.category}</span>
                  </div>

                  {book.isbn ? (
                    <div className="spec-tile-book">
                      <span className="label">
                        <Barcode size={11} aria-hidden="true" />
                        <span>ISBN</span>
                      </span>
                      <span className="value font-mono">{book.isbn}</span>
                    </div>
                  ) : (
                    <div className="spec-tile-book">
                      <span className="label">
                        <Tag size={11} aria-hidden="true" />
                        <span>Format</span>
                      </span>
                      <span className="value">Course Material</span>
                    </div>
                  )}

                  <div className="spec-tile-book">
                    <span className="label">
                      <Calendar size={11} aria-hidden="true" />
                      <span>Listed Date</span>
                    </span>
                    <span className="value">{dateFormatted}</span>
                  </div>
                </div>

                {/* Ex-Libris Seller Inscription */}
                <div className="ex-libris-card">
                  <span className="ex-libris-header">
                    <ShieldCheck size={13} aria-hidden="true" />
                    <span>Ex-Libris &bull; Email-Verified Seller</span>
                  </span>

                  <div className="ex-libris-row">
                    <div className="ex-libris-avatar" aria-hidden="true">
                      {book.seller?.avatarUrl ? (
                        <img
                          src={book.seller.avatarUrl}
                          alt=""
                          className="ex-libris-avatar-img"
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      ) : (
                        <User size={18} />
                      )}
                    </div>

                    <div className="ex-libris-meta">
                      {book.seller ? (
                        <Link
                          to={`/students/${book.seller._id || book.seller}`}
                          className="ex-libris-name"
                          title="View public student profile"
                          onClick={onClose}
                        >
                          {book.seller?.displayName || book.seller?.name || 'Verified Student'}
                        </Link>
                      ) : (
                        <span className="ex-libris-name">Email-Verified Student</span>
                      )}
                      <span className="ex-libris-status">
                        <CheckCircle2 size={11} aria-hidden="true" />
                        <span>Registered Student Account</span>
                      </span>
                    </div>
                  </div>

                  {book.seller && (
                    <Link
                      to={`/students/${book.seller._id || book.seller}`}
                      className="btn-ex-libris"
                      title="View full student profile"
                      onClick={onClose}
                    >
                      View Student Profile &rarr;
                    </Link>
                  )}
                </div>

                {/* Left Page Footer */}
                <div className="folio-footer-strip">
                  <span>Bookend Campus Textbook Exchange</span>
                  <span>Folio I &bull; Page 1</span>
                </div>
              </motion.article>

              {/* ========================================================
                  RIGHT PAGE: FOLIO II (Title, Price Seal, Notes & Desk)
                  ======================================================== */}
              <motion.article
                className="open-book-page page-right"
                aria-label="Book details and purchase actions"
                initial={{ rotateY: 22, opacity: 0.6 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: 18, opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.04 }}
                style={{ transformOrigin: 'left center', transformStyle: 'preserve-3d' }}
              >
                <div className="folio-header-strip">
                  <span className="folio-header-title">
                    <Sparkles size={13} aria-hidden="true" />
                    <span>Registry Record &bull; Student Second-Hand</span>
                  </span>
                  <span className="folio-page-num">Folio II &bull; Page 2</span>
                </div>

                {/* Book Title & Author */}
                <div className="right-page-header">
                  <h1 id="modal-book-title" className="tome-book-title">{book.title}</h1>
                  <p className="tome-book-author">
                    Authored by <strong className="text-secondary">{book.author}</strong>
                  </p>
                </div>

                {/* Official Campus Price Seal */}
                <div className="tome-price-seal">
                  <div>
                    <span className="tome-price-label">Fixed Student Price</span>
                    <div className="tome-price-amount">{formatINR(book.price, book.priceInPaise)}</div>
                  </div>

                  <div>
                    {isSold ? (
                      <span className="tome-status-badge sold">
                        <AlertCircle size={14} aria-hidden="true" />
                        <span>Sold Out</span>
                      </span>
                    ) : book.status === 'reserved' || book.acceptedRequest ? (
                      <span className="tome-status-badge reserved">
                        <Clock size={14} aria-hidden="true" />
                        <span>Reserved for Buyer</span>
                      </span>
                    ) : (
                      <span className="tome-status-badge available">
                        <CheckCircle2 size={14} aria-hidden="true" />
                        <span>Available for Purchase</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Chapter Description */}
                <section className="tome-chapter-section" aria-labelledby="chapter-notes-title">
                  <h2 id="chapter-notes-title" className="chapter-title">
                    Chapter Notes & Synopsis
                  </h2>
                  <div className="chapter-body">
                    {book.description.split('\n').map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>
                </section>

                {/* Purchase Desk & Action Hub */}
                <div className="tome-action-desk">
                  {/* Owner Controls */}
                  {isOwner && (
                    <div className="tome-owner-strip" aria-label="Listing Owner Controls">
                      <div className="tome-owner-header">
                        <ShieldCheck size={14} aria-hidden="true" />
                        <span>You are the seller of this listing</span>
                      </div>

                      <div className="tome-owner-btns">
                        {book.status === 'reserved' || isSold ? (
                          <button
                            type="button"
                            disabled
                            className="btn-secondary opacity-60 cursor-not-allowed"
                            title={book.status === 'reserved' ? 'Cannot edit listing while reserved' : 'Cannot edit sold listing'}
                          >
                            <Edit3 size={14} aria-hidden="true" />
                            <span>Edit Disabled ({book.status})</span>
                          </button>
                        ) : (
                          <Link
                            to={`/books/${book._id}/edit`}
                            className="btn-secondary"
                            id="edit-listing-btn"
                            onClick={onClose}
                          >
                            <Edit3 size={14} aria-hidden="true" />
                            <span>Edit Listing</span>
                          </Link>
                        )}

                        <button
                          type="button"
                          onClick={handleStatusToggle}
                          disabled={isActionLoading || Boolean(book.status === 'reserved' || book.acceptedRequest)}
                          className="btn-secondary"
                          id="toggle-status-btn"
                          title={book.status === 'reserved' ? 'Cannot manually toggle status while reserved. Use Requests page.' : ''}
                        >
                          <RefreshCw size={14} className={isActionLoading ? 'spinner' : ''} aria-hidden="true" />
                          <span>{isSold ? 'Relist' : 'Mark Sold'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(true)}
                          disabled={isActionLoading || Boolean(book.status === 'reserved' || isSold || book.acceptedRequest)}
                          className="btn-danger-outline"
                          id="delete-listing-btn"
                          title={book.status === 'reserved' ? 'Cannot delete reserved listing' : isSold ? 'Cannot delete sold listing' : ''}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Buyer Purchase Request Section */}
                  {!isOwner && (
                    <div className="tome-buyer-card" aria-label="Purchase Request">
                      {requestFeedback && (
                        <Alert
                          type={requestFeedback.type}
                          message={requestFeedback.text}
                          onDismiss={() => setRequestFeedback(null)}
                          className="mb-3"
                        />
                      )}

                      {!user ? (
                        <div className="tome-buyer-card guest">
                          <span className="tome-prompt-title">Interested in purchasing this textbook?</span>
                          <span className="tome-prompt-sub">
                            Log in with your email-verified account to send a purchase request directly to {book.seller?.name || 'the seller'}.
                          </span>
                          <Link
                            to="/login"
                            state={{ from: `/books/${book._id}` }}
                            className="btn-primary mt-2"
                            id="login-to-buy-btn"
                            onClick={onClose}
                          >
                            <User size={15} aria-hidden="true" />
                            <span>Log In to Request Purchase</span>
                          </Link>
                        </div>
                      ) : userRequest && ['pending', 'accepted'].includes(userRequest.status) ? (
                        <div className={`buyer-active-request-card ${userRequest.status} status-${userRequest.status}`}>
                          <div className="active-req-header">
                            {userRequest.status === 'pending' ? (
                              <>
                                <Clock size={16} className="text-warning" aria-hidden="true" />
                                <span className="active-req-title">Your Request is Pending Review</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={16} className="text-success" aria-hidden="true" />
                                <span className="active-req-title">Request Accepted by Seller!</span>
                              </>
                            )}
                          </div>

                          <p className="active-req-body">
                            {userRequest.status === 'pending'
                              ? `You sent a purchase request to ${book.seller?.name || 'the seller'}. The book is reserved awaiting response.`
                              : `Great news! ${book.seller?.name || 'The seller'} accepted your purchase request. Meet at the campus library for handover.`}
                          </p>

                          {userRequest.message && (
                            <div className="active-req-msg-quote">
                              <MessageSquare size={13} aria-hidden="true" />
                              <span>Your note: &ldquo;{userRequest.message}&rdquo;</span>
                            </div>
                          )}

                          <div className="active-req-actions">
                            <button
                              type="button"
                              onClick={handleCancelUserRequest}
                              disabled={isSubmittingRequest}
                              className="btn-danger-outline btn-sm"
                              id="cancel-request-btn"
                            >
                              <XCircle size={13} aria-hidden="true" />
                              <span>
                                {isSubmittingRequest
                                  ? 'Cancelling...'
                                  : userRequest.status === 'accepted'
                                  ? 'Cancel Reservation'
                                  : 'Cancel Request'}
                              </span>
                            </button>
                            <Link to="/purchase-requests?tab=sent" className="btn-secondary btn-sm" onClick={onClose}>
                              <Inbox size={13} aria-hidden="true" />
                              <span>View in My Requests</span>
                            </Link>
                          </div>
                        </div>
                      ) : isSold ? (
                        <div className="buyer-request-box sold">
                          <AlertCircle size={16} className="text-muted" aria-hidden="true" />
                          <span>This textbook has been sold and is no longer accepting requests.</span>
                        </div>
                      ) : book.acceptedRequest ? (
                        <div className="buyer-request-box reserved">
                          <Clock size={16} className="text-warning" aria-hidden="true" />
                          <span>This textbook is currently reserved by an accepted request from another student.</span>
                        </div>
                      ) : (
                        <div className="tome-buyer-action-panel">
                          {!showRequestForm ? (
                            <div className="tome-buyer-prompt">
                              <div>
                                <h3 className="tome-prompt-title">Ready to buy this book?</h3>
                                <p className="tome-prompt-sub">
                                  Send a purchase request to reserve this book with {book.seller?.name || 'the seller'}.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowRequestForm(true)}
                                className="btn-primary"
                                id="open-request-form-btn"
                              >
                                <Send size={14} aria-hidden="true" />
                                <span>Request to Buy</span>
                              </button>
                            </div>
                          ) : (
                            <form onSubmit={handleSendPurchaseRequest} className="purchase-request-form-clean" id="purchase-request-form">
                              <div className="form-header-row">
                                <div className="flex items-center gap-2">
                                  <Send size={15} className="text-primary" aria-hidden="true" />
                                  <strong className="text-main text-sm">Send Purchase Request</strong>
                                </div>
                                <span className="price-tag-mini">{formatINR(book.price, book.priceInPaise)}</span>
                              </div>

                              <div className="form-row-clean">
                                <label htmlFor="purchase-message" className="form-label-clean">
                                  Message to Seller <span className="optional-tag">(Optional)</span>
                                </label>
                                <textarea
                                  id="purchase-message"
                                  value={requestMessage}
                                  onChange={(e) => setRequestMessage(e.target.value)}
                                  maxLength={500}
                                  rows={3}
                                  className="form-textarea-clean"
                                  placeholder="e.g. Hi! I need this textbook for CS101. Can we meet at the campus library?"
                                  disabled={isSubmittingRequest}
                                />
                                <div className="textarea-footer">
                                  <span className="char-count">{requestMessage.length}/500 characters</span>
                                </div>
                              </div>

                              <div className="form-actions-clean">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowRequestForm(false);
                                    setRequestMessage('');
                                  }}
                                  disabled={isSubmittingRequest}
                                  className="btn-secondary btn-sm"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={isSubmittingRequest}
                                  className="btn-primary btn-sm"
                                  id="submit-purchase-request-btn"
                                >
                                  <Send size={13} aria-hidden="true" />
                                  <span>{isSubmittingRequest ? 'Sending...' : 'Send Request'}</span>
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Page Footer */}
                <div className="folio-footer-strip">
                  <span>Campus Library In-Person Handover</span>
                  <span>Folio II &bull; Page 2</span>
                </div>
              </motion.article>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-del-confirm-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isActionLoading) {
                setShowDeleteConfirm(false);
              }
            }}
          >
            <div className="modal-card">
              <div className="modal-header-icon danger" aria-hidden="true">
                <Trash2 size={24} />
              </div>
              <h2 id="modal-del-confirm-title" className="modal-title">Delete Book Listing?</h2>
              <p className="modal-description">
                Are you sure you want to permanently delete <strong>{book?.title}</strong>? This action cannot be undone and will remove the book from the campus marketplace.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isActionLoading}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteListing}
                  disabled={isActionLoading}
                  className="btn-danger"
                  id="confirm-delete-btn"
                >
                  {isActionLoading ? 'Deleting...' : 'Yes, Delete Listing'}
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  return createPortal(modalContent, document.body);
};

export default BookDetailsModal;

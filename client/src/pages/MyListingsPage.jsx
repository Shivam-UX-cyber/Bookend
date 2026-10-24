import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  PlusCircle,
  Tag,
  CheckCircle2,
  Trash2,
  Edit3,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Layers,
  Search,
  X,
} from 'lucide-react';
import { bookService } from '../services/bookService';
import { BookCard } from '../components/BookCard';
import { Alert } from '../components/Alert';

export const MyListingsPage = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Stateful URL filters: status ('all', 'available', 'sold') and page number
  const activeTab = searchParams.get('status') || 'all';
  const currentPage = parseInt(searchParams.get('page'), 10) || 1;

  const [searchQuery, setSearchQuery] = useState('');
  const [books, setBooks] = useState([]);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState(
    location.state?.successMessage
      ? { type: 'success', text: location.state.successMessage }
      : null
  );

  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [bookToDelete, setBookToDelete] = useState(null);

  const activeRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Close delete modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && bookToDelete && !actionLoadingId) {
        setBookToDelete(null);
      }
    };
    if (bookToDelete) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bookToDelete, actionLoadingId]);

  // Fetch books matching current tab & page
  const fetchMyBooks = useCallback(async () => {
    const requestId = ++activeRequestIdRef.current;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const statusParam = activeTab === 'all' ? '' : activeTab;
      const res = await bookService.getMyBooks({
        status: statusParam,
        page: currentPage,
        limit: 12,
      });

      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) {
        return;
      }

      if (res.success && res.data) {
        setBooks(res.data.books || []);
        setPagination(
          res.data.pagination || {
            total: 0,
            page: 1,
            limit: 12,
            totalPages: 1,
            hasPrev: false,
            hasNext: false,
          }
        );
      } else {
        setErrorMessage(res.message || 'Failed to retrieve your listings.');
      }
    } catch (err) {
      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) {
        return;
      }
      setErrorMessage(err.message || 'Failed to load your listings.');
    } finally {
      if (isMountedRef.current && requestId === activeRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeTab, currentPage]);

  useEffect(() => {
    fetchMyBooks();
  }, [fetchMyBooks]);

  // Switch status tab statefully
  const handleTabChange = (newStatus) => {
    const nextParams = new URLSearchParams(searchParams);
    if (newStatus === 'all') {
      nextParams.delete('status');
    } else {
      nextParams.set('status', newStatus);
    }
    nextParams.set('page', '1');
    setSearchParams(nextParams);
    setSearchQuery('');
    setFeedbackMessage(null);
  };

  // Change page statefully
  const handlePageChange = (newPage) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('page', String(newPage));
    setSearchParams(nextParams);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Filter listings locally by search query
  const filteredBooks = useMemo(() => {
    if (!searchQuery.trim()) return books;
    const q = searchQuery.toLowerCase().trim();
    return books.filter((b) => {
      const title = b.title?.toLowerCase() || '';
      const author = b.author?.toLowerCase() || '';
      const subject = b.subject?.toLowerCase() || '';
      const isbn = b.isbn?.toLowerCase() || '';
      return (
        title.includes(q) ||
        author.includes(q) ||
        subject.includes(q) ||
        isbn.includes(q)
      );
    });
  }, [books, searchQuery]);

  // Toggle book status between available and sold
  const handleStatusToggle = async (book) => {
    const newStatus = book.status === 'available' ? 'sold' : 'available';
    setActionLoadingId(book._id);
    setFeedbackMessage(null);
    try {
      const res = await bookService.updateBookStatus(book._id, newStatus);
      if (res.success && res.data?.book) {
        setFeedbackMessage({
          type: 'success',
          text: `"${book.title}" is now marked as ${newStatus}.`,
        });
        await fetchMyBooks();
      }
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to change listing status.',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Delete book permanently
  const handleConfirmDelete = async () => {
    if (!bookToDelete) return;
    setActionLoadingId(bookToDelete._id);
    setFeedbackMessage(null);
    try {
      const res = await bookService.deleteBook(bookToDelete._id);
      if (res.success) {
        setFeedbackMessage({
          type: 'success',
          text: `"${bookToDelete.title}" listing deleted successfully.`,
        });
        setBookToDelete(null);
        await fetchMyBooks();
      }
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to delete listing.',
      });
      setBookToDelete(null);
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="page-shell-unified">
      {/* Unified Clean Header */}
      <header className="page-header-unified">
        <div>
          <h1 id="my-listings-title" className="page-title-unified">
            My Book Listings
          </h1>
          <p className="page-subtitle-unified">
            Manage your textbook inventory. Update prices, toggle between available and sold, or remove old listings.
          </p>
        </div>

        <Link to="/books/new" className="btn-primary" id="list-new-book-btn">
          <PlusCircle size={17} aria-hidden="true" />
          <span>Sell a Book</span>
        </Link>
      </header>

      {/* Flash Feedback */}
      {feedbackMessage && (
        <Alert
          type={feedbackMessage.type}
          message={feedbackMessage.text}
          onDismiss={() => setFeedbackMessage(null)}
          className="mb-4"
        />
      )}

      {/* Unified Toolbar */}
      <div className="toolbar-unified">
        {/* Stateful Filter Pills */}
        <div className="pills-unified" role="tablist" aria-label="Filter listings by status">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            onClick={() => handleTabChange('all')}
            className={`pill-unified ${activeTab === 'all' ? 'active' : ''}`}
          >
            <span>All Listings</span>
            {activeTab === 'all' && pagination.total > 0 && (
              <span className="pill-badge-unified">{pagination.total}</span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'available'}
            onClick={() => handleTabChange('available')}
            className={`pill-unified ${activeTab === 'available' ? 'active' : ''}`}
          >
            <span className="status-dot green" aria-hidden="true" />
            <span>Available</span>
            {activeTab === 'available' && pagination.total > 0 && (
              <span className="pill-badge-unified">{pagination.total}</span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sold'}
            onClick={() => handleTabChange('sold')}
            className={`pill-unified ${activeTab === 'sold' ? 'active' : ''}`}
          >
            <span className="status-dot gray" aria-hidden="true" />
            <span>Sold Out</span>
            {activeTab === 'sold' && pagination.total > 0 && (
              <span className="pill-badge-unified">{pagination.total}</span>
            )}
          </button>
        </div>

        {/* Unified Search Box */}
        <div className="search-box-unified">
          <Search size={14} className="search-icon-unified" aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your listings..."
            className="search-input-unified"
            aria-label="Search your book listings"
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
          <h2 className="state-title">Failed to load listings</h2>
          <p className="state-description">{errorMessage}</p>
          <button type="button" onClick={fetchMyBooks} className="btn-primary btn-retry">
            <RefreshCw size={16} aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="books-grid" aria-busy="true" aria-label="Loading your listings">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="book-card-skeleton">
              <div className="skeleton-media" />
              <div className="skeleton-body">
                <div className="skeleton-line skeleton-meta" />
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-desc" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !errorMessage && filteredBooks.length === 0 && (
        <div className="marketplace-state-card empty" role="region" aria-label="No listings in inventory">
          <BookOpen size={48} className="state-icon muted" aria-hidden="true" />
          <h2 className="state-title">
            {searchQuery
              ? `No listings found matching "${searchQuery}"`
              : activeTab === 'sold'
              ? 'No sold books in your history'
              : activeTab === 'available'
              ? 'No available books currently listed'
              : 'You have not listed any textbooks yet'}
          </h2>
          <p className="state-description">
            {searchQuery
              ? 'Try checking for typos or searching by book author or subject.'
              : activeTab === 'all'
              ? 'Ready to declutter your desk? List your second-hand books and connect with fellow students on campus.'
              : `You have zero listings currently marked as ${activeTab}.`}
          </p>
          <div className="empty-actions">
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="btn-secondary"
              >
                Clear Search Filter
              </button>
            ) : (
              <Link to="/books/new" className="btn-primary">
                <PlusCircle size={16} aria-hidden="true" />
                <span>List a Book for Sale</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Books Grid */}
      {!isLoading && !errorMessage && filteredBooks.length > 0 && (
        <div className="books-grid" role="region" aria-label="Your book listings">
          {filteredBooks.map((book) => (
            <BookCard
              key={book._id}
              book={book}
              isOwner={true}
              onStatusToggle={handleStatusToggle}
              onDelete={(b) => setBookToDelete(b)}
              isActionLoading={actionLoadingId === book._id}
            />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && pagination.totalPages > 1 && (
        <nav className="marketplace-pagination" aria-label="My Listings page navigation">
          <button
            type="button"
            onClick={() => handlePageChange(Math.max(1, pagination.page - 1))}
            disabled={!pagination.hasPrev}
            className="pagination-btn"
            aria-label="Go to previous page"
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
            aria-label="Go to next page"
          >
            <span>Next</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}

      {/* Delete Confirmation Modal */}
      {bookToDelete && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-del-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !actionLoadingId) {
              setBookToDelete(null);
            }
          }}
        >
          <div className="modal-card">
            <div className="modal-header-icon danger" aria-hidden="true">
              <Trash2 size={24} />
            </div>
            <h2 id="modal-del-title" className="modal-title">Delete Listing?</h2>
            <p className="modal-description">
              Are you sure you want to remove <strong>{bookToDelete.title}</strong> from your listings? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setBookToDelete(null)}
                disabled={actionLoadingId === bookToDelete._id}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={actionLoadingId === bookToDelete._id}
                className="btn-danger"
              >
                {actionLoadingId === bookToDelete._id ? 'Deleting...' : 'Delete Listing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyListingsPage;

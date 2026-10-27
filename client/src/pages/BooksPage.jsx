import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams, useParams, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import {
  Search,
  PlusCircle,
  Filter,
  ArrowUpDown,
  X,
  RefreshCw,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { bookService, BOOK_CATEGORIES, BOOK_CONDITIONS } from '../services/bookService';
import { BookCard } from '../components/BookCard';
import { BookDetailsModal } from '../components/BookDetailsModal';

export const BooksPage = () => {
  const { isAuthenticated } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: routeBookId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const activeModalBookId = routeBookId || searchParams.get('bookId');

  // URL searchParams is the single source of truth for marketplace query state
  const searchQuery = searchParams.get('search') || '';
  const selectedCategory = searchParams.get('category') || '';
  const selectedCondition = searchParams.get('condition') || '';
  const sortBy = searchParams.get('sortBy') || 'newest';
  const currentPage = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);

  // Local state for search text input so user can type smoothly without lag
  const [searchInput, setSearchInput] = useState(searchQuery);

  // Keep local search input in sync when URL changes externally (e.g. Browser Back/Forward or reset)
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // Debounced live search: updates the URL search param 350ms after user stops typing
  useEffect(() => {
    if (searchInput.trim() === searchQuery.trim()) return;

    const timer = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const trimmed = searchInput.trim();
          if (trimmed) {
            next.set('search', trimmed);
          } else {
            next.delete('search');
          }
          next.delete('page'); // reset to page 1
          return next;
        },
        { replace: true }
      );
    }, 350);

    return () => clearTimeout(timer);
  }, [searchInput, searchQuery, setSearchParams]);

  // Data fetching state
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

  const activeRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch books from backend strictly when URL params change
  const fetchMarketplaceBooks = useCallback(async () => {
    const requestId = ++activeRequestIdRef.current;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await bookService.getBooks({
        search: searchQuery,
        category: selectedCategory,
        condition: selectedCondition,
        sortBy,
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
        setErrorMessage(res.message || 'Failed to retrieve book listings.');
      }
    } catch (err) {
      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) {
        return;
      }
      setErrorMessage(err.message || 'Failed to load books. Please check your connection.');
    } finally {
      if (isMountedRef.current && requestId === activeRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [searchQuery, selectedCategory, selectedCondition, sortBy, currentPage]);

  useEffect(() => {
    fetchMarketplaceBooks();
  }, [fetchMarketplaceBooks]);

  // Immediate submit handler (e.g. Enter key or search button)
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (trimmed) {
          next.set('search', trimmed);
        } else {
          next.delete('search');
        }
        next.delete('page');
        return next;
      },
      { replace: false }
    );
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('search');
        next.delete('page');
        return next;
      },
      { replace: false }
    );
  };

  const handleCategoryChange = (cat) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (cat) next.set('category', cat);
      else next.delete('category');
      next.delete('page');
      return next;
    });
  };

  const handleConditionChange = (cond) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (cond) next.set('condition', cond);
      else next.delete('condition');
      next.delete('page');
      return next;
    });
  };

  const handleSortChange = (sort) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (sort && sort !== 'newest') next.set('sortBy', sort);
      else next.delete('sortBy');
      next.delete('page');
      return next;
    });
  };

  const handlePageChange = (newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newPage > 1) next.set('page', String(newPage));
      else next.delete('page');
      return next;
    });
  };

  const handleClearFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: false });
  };

  const hasActiveFilters = Boolean(
    searchQuery.trim() || selectedCategory || selectedCondition || (sortBy && sortBy !== 'newest')
  );

  return (
    <div className="marketplace-container">
      {/* Marketplace Header Hero */}
      <section className="marketplace-hero" aria-labelledby="marketplace-title">
        <div className="marketplace-hero-top">
          <div className="marketplace-hero-text">
            <div className="hero-pill-cluster">
              <span className="hero-badge">
                <BookOpen size={14} aria-hidden="true" />
                <span>Campus Book Marketplace</span>
              </span>
            </div>
            <h1 id="marketplace-title" className="marketplace-title">
              Find & Sell Second-Hand Textbooks
            </h1>
            <p className="marketplace-subtitle">
              Buy course materials directly from fellow students. Email-verified accounts, fair student pricing, and direct peer-to-peer exchanges.
            </p>
          </div>

          <div className="marketplace-hero-cta">
            {isAuthenticated ? (
              <Link to="/books/new" className="btn-primary btn-sell-hero" id="sell-book-btn">
                <PlusCircle size={18} aria-hidden="true" />
                <span>Sell a Book</span>
              </Link>
            ) : (
              <Link to="/login" state={{ from: '/books/new' }} className="btn-primary btn-sell-hero">
                <PlusCircle size={18} aria-hidden="true" />
                <span>Log in to Sell a Book</span>
              </Link>
            )}
          </div>
        </div>

        <div className="hero-trust-strip" aria-label="Bookend marketplace highlights">
          <div className="trust-item">
            <ShieldCheck size={15} className="trust-icon" aria-hidden="true" />
            <span>Email-Verified Accounts</span>
          </div>
          <div className="trust-item">
            <Sparkles size={15} className="trust-icon" aria-hidden="true" />
            <span>Direct Peer Exchanges</span>
          </div>
          <div className="trust-item">
            <CheckCircle2 size={15} className="trust-icon" aria-hidden="true" />
            <span>Campus In-Person Handover</span>
          </div>
        </div>
      </section>

      {/* Search and Filters Bar */}
      <section className="marketplace-controls" aria-label="Book Search and Filtering">
        <form onSubmit={handleSearchSubmit} className="search-form" role="search">
          <div className="search-input-wrapper">
            <Search size={18} className="search-icon" aria-hidden="true" />
            <input
              type="text"
              id="marketplace-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by title, author..."
              className="marketplace-search-input"
              aria-label="Search textbooks by title or author"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="search-clear-btn"
                aria-label="Clear search text"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </form>

        <div className="filters-cluster">
          {/* Category Filter */}
          <div className="filter-select-wrapper">
            <Filter size={15} className="filter-icon" aria-hidden="true" />
            <select
              id="marketplace-category-select"
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="marketplace-select"
              aria-label="Filter by academic category"
            >
              <option value="">All Categories</option>
              {BOOK_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Condition Filter */}
          <div className="filter-select-wrapper">
            <SlidersHorizontal size={15} className="filter-icon" aria-hidden="true" />
            <select
              id="marketplace-condition-select"
              value={selectedCondition}
              onChange={(e) => handleConditionChange(e.target.value)}
              className="marketplace-select"
              aria-label="Filter by book condition"
            >
              <option value="">All Conditions</option>
              {BOOK_CONDITIONS.map((cond) => (
                <option key={cond} value={cond}>
                  {cond}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By Filter */}
          <div className="filter-select-wrapper">
            <ArrowUpDown size={15} className="filter-icon" aria-hidden="true" />
            <select
              id="marketplace-sort-select"
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value)}
              className="marketplace-select"
              aria-label="Sort listings by price or date"
            >
              <option value="newest">Newest First</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="btn-clear-filters"
              aria-label="Clear all applied filters"
            >
              <X size={14} aria-hidden="true" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </section>

      {/* Interactive Active Filter Chips */}
      {hasActiveFilters && (
        <div className="active-filters-chips-bar" aria-label="Active filters">
          <span className="active-filters-label">Active filters:</span>
          {searchQuery.trim() && (
            <button
              type="button"
              className="filter-chip"
              onClick={handleClearSearch}
              title="Remove search query filter"
            >
              <span>Search: &ldquo;{searchQuery}&rdquo;</span>
              <X size={13} aria-hidden="true" />
            </button>
          )}
          {selectedCategory && (
            <button
              type="button"
              className="filter-chip"
              onClick={() => handleCategoryChange('')}
              title="Remove category filter"
            >
              <span>Category: {selectedCategory}</span>
              <X size={13} aria-hidden="true" />
            </button>
          )}
          {selectedCondition && (
            <button
              type="button"
              className="filter-chip"
              onClick={() => handleConditionChange('')}
              title="Remove condition filter"
            >
              <span>Condition: {selectedCondition}</span>
              <X size={13} aria-hidden="true" />
            </button>
          )}
          {sortBy && sortBy !== 'newest' && (
            <button
              type="button"
              className="filter-chip"
              onClick={() => handleSortChange('newest')}
              title="Reset sort order"
            >
              <span>Sort: {sortBy.replace('_', ' ')}</span>
              <X size={13} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="filter-chip-clear-all"
            onClick={handleClearFilters}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Results Count & Active Status Strip */}
      <div className="marketplace-meta-strip">
        <span className="results-counter">
          {isLoading ? (
            'Loading available listings...'
          ) : (
            <>
              Showing <strong>{books.length}</strong> of <strong>{pagination.total}</strong> available{' '}
              {pagination.total === 1 ? 'book' : 'books'}
            </>
          )}
        </span>
      </div>

      {/* Error State with Retry */}
      {errorMessage && !isLoading && (
        <div className="marketplace-state-card error" role="alert">
          <AlertCircle size={36} className="state-icon error" aria-hidden="true" />
          <h2 className="state-title">Failed to load marketplace listings</h2>
          <p className="state-description">{errorMessage}</p>
          <button
            type="button"
            onClick={fetchMarketplaceBooks}
            className="btn-primary btn-retry"
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Retry Connection</span>
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="books-grid" aria-busy="true" aria-label="Loading book listings">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="book-card-skeleton">
              <div className="skeleton-media" />
              <div className="skeleton-body">
                <div className="skeleton-line skeleton-meta" />
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-author" />
                <div className="skeleton-line skeleton-desc" />
                <div className="skeleton-footer">
                  <div className="skeleton-price" />
                  <div className="skeleton-btn" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !errorMessage && books.length === 0 && (
        <div className="marketplace-state-card empty" role="region" aria-label="No listings found">
          <BookOpen size={48} className="state-icon muted" aria-hidden="true" />
          <h2 className="state-title">No book listings found</h2>
          <p className="state-description">
            {hasActiveFilters
              ? 'No books match your current filters. Try relaxing your search criteria or resetting filters.'
              : 'There are currently no textbooks listed for sale on campus. Be the first student to publish a listing!'}
          </p>
          {hasActiveFilters ? (
            <div className="empty-filter-recovery">
              <button
                type="button"
                onClick={handleClearFilters}
                className="btn-secondary"
              >
                Clear All Filters
              </button>
              <div className="popular-categories-suggestion">
                <span className="suggestion-label">Or browse by popular course category:</span>
                <div className="suggestion-chips">
                  {BOOK_CATEGORIES.slice(0, 5).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className="category-pill-btn"
                      onClick={() => {
                        setSearchInput('');
                        setSearchParams(new URLSearchParams({ category: cat }), { replace: false });
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-actions">
              {isAuthenticated ? (
                <Link to="/books/new" className="btn-primary">
                  <PlusCircle size={16} aria-hidden="true" />
                  <span>List a Book for Sale</span>
                </Link>
              ) : (
                <Link to="/login" state={{ from: '/books/new' }} className="btn-primary">
                  <PlusCircle size={16} aria-hidden="true" />
                  <span>Log in to Sell a Book</span>
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Books Grid */}
      {!isLoading && !errorMessage && books.length > 0 && (
        <div className="books-grid" role="region" aria-label="Available campus textbooks">
          {books.map((book) => (
            <BookCard key={book._id} book={book} />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && pagination.totalPages > 1 && (
        <nav className="marketplace-pagination" aria-label="Marketplace page navigation">
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

      {/* Direct URL or Deep-Linked In-Page Book Details Modal */}
      <AnimatePresence>
        {activeModalBookId && (
          <BookDetailsModal
            key={`route-book-modal-${activeModalBookId}`}
            bookId={activeModalBookId}
            onClose={() => {
              if (routeBookId) {
                navigate({ pathname: '/books', search: location.search }, { replace: true });
              } else {
                setSearchParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete('bookId');
                    return next;
                  },
                  { replace: true }
                );
              }
            }}
            onListingUpdated={() => {
              fetchMarketplaceBooks();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

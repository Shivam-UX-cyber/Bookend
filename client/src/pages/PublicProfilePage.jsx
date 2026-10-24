import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  User,
  ShieldCheck,
  Building,
  GraduationCap,
  Calendar,
  MapPin,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertCircle,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react';
import { userService } from '../services/userService';
import { BookCard } from '../components/BookCard';
import { Alert } from '../components/Alert';

export const PublicProfilePage = () => {
  const { userId } = useParams();

  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchPublicProfile = async (page = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await userService.getPublicProfile(userId, page, 8);
      if (res?.success && res.data?.profile) {
        setProfile(res.data.profile);
        setCurrentPage(page);
      } else {
        setError('Student profile could not be loaded.');
      }
    } catch (err) {
      if (err.status === 404) {
        setError('Student profile not found. The account may not exist or is no longer active on Bookend.');
      } else {
        setError(err.message || 'Unable to connect to the campus marketplace server.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPublicProfile(1);
    setAvatarFailed(false);
  }, [userId]);

  const handlePageChange = (newPage) => {
    fetchPublicProfile(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isLoading && !profile) {
    return (
      <div className="container py-8 max-w-5xl mx-auto px-4" role="status" aria-live="polite">
        <div className="public-profile-skeleton">
          <div className="skeleton-header-box">
            <div className="skeleton-avatar-large"></div>
            <div className="skeleton-info-lines">
              <div className="skeleton-line title"></div>
              <div className="skeleton-line bio"></div>
              <div className="skeleton-badges-row"></div>
            </div>
          </div>
          <div className="skeleton-books-grid mt-8">
            <div className="skeleton-book-card"></div>
            <div className="skeleton-book-card"></div>
            <div className="skeleton-book-card"></div>
            <div className="skeleton-book-card"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="container py-12 max-w-2xl mx-auto px-4 text-center">
        <div className="unavailable-profile-card">
          <div className="unavailable-icon-wrapper" aria-hidden="true">
            <AlertCircle size={40} className="text-warning" />
          </div>
          <h1 className="unavailable-title">Student Profile Unavailable</h1>
          <p className="unavailable-desc">
            {error || 'This student profile could not be retrieved from the campus marketplace.'}
          </p>
          <div className="unavailable-actions mt-6 flex justify-center gap-3">
            <Link to="/books" className="btn-primary">
              <BookOpen size={16} aria-hidden="true" />
              <span>Browse All Marketplace Books</span>
            </Link>
            <button
              type="button"
              onClick={() => fetchPublicProfile(currentPage)}
              className="btn-secondary"
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>Try Again</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const {
    displayName,
    avatarUrl,
    bio,
    department,
    course,
    studyYear,
    campus,
    createdAt,
    books = [],
    pagination,
  } = profile;

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <div className="page-shell-unified">
      {/* Breadcrumb Navigation */}
      <nav className="breadcrumb-nav mb-6" aria-label="Breadcrumb">
        <Link to="/books" className="breadcrumb-link">
          Marketplace
        </Link>
        <span className="breadcrumb-sep" aria-hidden="true">/</span>
        <span className="breadcrumb-current">Student Profile</span>
      </nav>

      {/* Main Student Header Card */}
      <header className="public-profile-header-card" aria-label="Student Information">
        <div className="header-card-content">
          {/* Avatar */}
          <div className="public-avatar-wrapper">
            {avatarUrl && !avatarFailed ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="public-avatar-image"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <div className="public-avatar-fallback" aria-hidden="true">
                {displayName ? displayName.charAt(0).toUpperCase() : <User size={36} />}
              </div>
            )}
          </div>

          {/* Student Info */}
          <div className="public-info-cluster">
            <div className="name-and-badge-row">
              <h1 className="public-display-name">{displayName}</h1>
              <span className="campus-verified-tag" title="Email-Verified Peer">
                <ShieldCheck size={14} aria-hidden="true" />
                <span>Email-Verified Peer</span>
              </span>
            </div>

            {/* Optional Bio (only rendered if permitted by seller's privacy settings) */}
            {bio && (
              <p className="public-student-bio">
                {bio}
              </p>
            )}

            {/* Academic & Campus Details Pills (only rendered if returned by server) */}
            <div className="public-meta-pills-list">
              {department && (
                <div className="meta-pill" title="Academic Department">
                  <Building size={13} aria-hidden="true" />
                  <span>{department}</span>
                </div>
              )}

              {course && (
                <div className="meta-pill" title="Course / Program">
                  <BookOpen size={13} aria-hidden="true" />
                  <span>{course}</span>
                </div>
              )}

              {studyYear && (
                <div className="meta-pill" title="Year of Study">
                  <GraduationCap size={13} aria-hidden="true" />
                  <span>{studyYear}</span>
                </div>
              )}

              {campus && (
                <div className="meta-pill" title="Campus Location">
                  <MapPin size={13} aria-hidden="true" />
                  <span>{campus}</span>
                </div>
              )}

              {memberSince && (
                <div className="meta-pill" title="Account Created">
                  <Calendar size={13} aria-hidden="true" />
                  <span>Student since {memberSince}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Seller Quick Stats Bar */}
        <div className="public-stats-bar">
          <div className="stat-unit">
            <span className="stat-num">{pagination?.total ?? books.length}</span>
            <span className="stat-label">Total Listings</span>
          </div>
          <div className="stat-unit">
            <span className="stat-badge-campus">
              <Sparkles size={14} aria-hidden="true" />
              <span>Campus Bookend Seller</span>
            </span>
          </div>
        </div>
      </header>

      {/* Seller's Book Listings Section */}
      <section className="seller-books-section mt-10" aria-labelledby="seller-books-heading">
        <div className="section-header-flex">
          <div>
            <h2 id="seller-books-heading" className="section-headline">
              Textbooks Listed by {displayName}
            </h2>
            <p className="section-subtext">
              Browse available second-hand textbooks and request a safe on-campus handover.
            </p>
          </div>

          {pagination && pagination.total > 0 && (
            <span className="listings-count-badge">
              {pagination.total} {pagination.total === 1 ? 'book' : 'books'}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="books-loading-spinner py-12 text-center" role="status">
            <div className="spinner-orbit inline-block">
              <BookOpen size={24} className="pulse-icon" aria-hidden="true" />
            </div>
            <p className="text-muted mt-2 text-sm">Loading seller listings...</p>
          </div>
        ) : books.length === 0 ? (
          <div className="seller-empty-listings-box">
            <div className="empty-icon-circle" aria-hidden="true">
              <ShoppingBag size={32} />
            </div>
            <h3 className="empty-title">No Active Listings Currently</h3>
            <p className="empty-desc">
              {displayName} does not have any textbooks listed for sale at the moment.
            </p>
            <Link to="/books" className="btn-secondary mt-4">
              <BookOpen size={15} aria-hidden="true" />
              <span>Browse Other Campus Listings</span>
            </Link>
          </div>
        ) : (
          <>
            <div className="books-grid mt-6">
              {books.map((book) => (
                <BookCard key={book._id} book={book} isOwner={false} />
              ))}
            </div>

            {/* Pagination Controls */}
            {pagination && pagination.totalPages > 1 && (
              <nav className="marketplace-pagination" aria-label="Seller listings pagination">
                <button
                  type="button"
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={!pagination.hasPrev || isLoading}
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
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={!pagination.hasNext || isLoading}
                  className="pagination-btn"
                  aria-label="Next page"
                >
                  <span>Next</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default PublicProfilePage;

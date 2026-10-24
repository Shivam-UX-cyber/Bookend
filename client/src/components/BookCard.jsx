import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { BookOpen, User, Tag, CheckCircle2, ChevronRight, Edit3, Trash2, Eye } from 'lucide-react';
import { formatINR } from '../services/bookService';
import { BookDetailsModal } from './BookDetailsModal';

// Obsidian Monochrome Bookbinding Themes (Charcoal, Obsidian, Slate, Onyx)
const getBookBindingTheme = (category = '', id = '') => {
  const themes = ['binding-obsidian', 'binding-charcoal', 'binding-slate', 'binding-onyx'];
  const hash = (category + (id || 'default')).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return themes[hash % themes.length];
};

export const BookCard = ({
  book: initialBook,
  isOwner = false,
  onStatusToggle = null,
  onDelete = null,
  isActionLoading = false,
}) => {
  const [book, setBook] = useState(initialBook);
  const [isDeleted, setIsDeleted] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setBook(initialBook);
  }, [initialBook]);

  if (isDeleted || !book) {
    return null;
  }

  const bindingTheme = getBookBindingTheme(book.category, book._id);

  const conditionColors = {
    New: 'badge-condition-new',
    'Like New': 'badge-condition-like-new',
    Good: 'badge-condition-good',
    Acceptable: 'badge-condition-acceptable',
  };

  const conditionClass = conditionColors[book.condition] || 'badge-condition-default';
  const isSold = book.status === 'sold';
  const isReserved = book.status === 'reserved' || Boolean(book.acceptedRequest);

  const handleOpenModal = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsModalOpen(true);
  };

  const handleCardClick = (e) => {
    // Only exclude owner management buttons and public student profile links
    if (
      e.target.closest(
        'a.book-card-seller-link, .btn-card-owner-edit, .btn-card-owner-delete, .btn-card-owner-status'
      )
    ) {
      return;
    }
    handleOpenModal(e);
  };

  return (
    <>
      <article
        className={`book-card full-tome-book ${bindingTheme} ${isSold ? 'book-card-sold' : ''}`}
        aria-labelledby={`book-title-${book._id}`}
        onClick={handleCardClick}
      >
        {/* Ambient Ground Shelf Shadow below the full book */}
        <div className="full-tome-ground-shadow" aria-hidden="true" />

        {/* 3D Physical Book Structure */}
        <div
          className="full-tome-3d-wrapper"
          role="button"
          tabIndex={0}
          aria-label={`Textbook: ${book.title} by ${book.author}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOpenModal(e);
            }
          }}
        >
          {/* Full-Height 3D Leather Spine on Left Edge */}
          <div className="full-tome-spine" aria-hidden="true">
            <span className="spine-headband" />
            <div className="spine-ribs-group">
              <span className="spine-rib" />
              <span className="spine-rib" />
              <span className="spine-rib" />
              <span className="spine-rib" />
              <span className="spine-rib" />
            </div>
            <span className="spine-tailband" />
          </div>

          {/* Full-Height Layered Page Edges on Right */}
          <div className="full-tome-pages-edge" aria-hidden="true" />

          {/* Layered Paper Edge on Bottom */}
          <div className="full-tome-pages-bottom" aria-hidden="true" />

          {/* Silk Satin Bookmark Ribbon */}
          <div className="full-tome-ribbon" aria-hidden="true" />

          {/* Complete Front Hardcover Face */}
          <div className="full-tome-cover">
            {/* Stamped Chrome Foil Frame & Corner Filigree */}
            <div className="book-cover-foil-frame" aria-hidden="true">
              <span className="corner-filigree corner-tl" />
              <span className="corner-filigree corner-tr" />
              <span className="corner-filigree corner-bl" />
              <span className="corner-filigree corner-br" />
            </div>

            {/* Embossed Spine Hinge Crease */}
            <div className="book-cover-hinge" aria-hidden="true" />

            {/* Luminous Specular Sheen Pass */}
            <div className="book-cover-sheen" aria-hidden="true" />

            {/* Top Badge Strip (Condition & Status) */}
            <div className="full-tome-top-badges">
              <span className={`badge-condition ${conditionClass}`}>
                {book.condition}
              </span>

              {(isSold || isReserved) && (
                <span className={isSold ? 'badge-status-sold' : 'badge-status-reserved'}>
                  {isSold ? 'Sold Out' : 'Reserved'}
                </span>
              )}
            </div>

            {/* Book Artwork / Embossed Tome Crest Showcase */}
            <div className="full-tome-artwork-section">
              {book.imageUrl && !imageError ? (
                <div className="full-tome-art-plate">
                  <img
                    src={book.imageUrl}
                    alt={`Cover of ${book.title}`}
                    className="full-tome-img"
                    loading="lazy"
                    decoding="async"
                    onError={() => setImageError(true)}
                  />
                  <div className="full-tome-art-bevel" />
                </div>
              ) : (
                <div className="full-tome-embossed-crest" aria-hidden="true">
                  <div className="leather-texture-overlay" />
                  <div className="hardcover-insignia">
                    <BookOpen size={28} className="hardcover-crest-icon" />
                  </div>
                  <span className="full-tome-crest-label">CAMPUS FOLIO &bull; EMAIL-VERIFIED</span>
                </div>
              )}

              {/* Hover Quick View Lens (contained strictly to the Artwork Plate) */}
              <div className="book-3d-hover-lens" aria-hidden="true">
                <span className="hover-lens-pill">
                  <Eye size={13} aria-hidden="true" />
                  <span>View Details</span>
                </span>
              </div>
            </div>

            {/* Book Info Section (Category, Title, Author) */}
            <div className="full-tome-meta-section">
              <div className="full-tome-category-row">
                <span className="full-tome-category-pill" title={book.category}>
                  <Tag size={10} aria-hidden="true" />
                  <span>{book.category}</span>
                </span>
              </div>

              <h3 id={`book-title-${book._id}`} className="full-tome-title" title={book.title}>
                <button
                  type="button"
                  className="book-card-title-btn"
                  onClick={handleOpenModal}
                  aria-label={`View details for ${book.title}`}
                >
                  {book.title}
                </button>
              </h3>

              <p className="full-tome-author" title={book.author}>
                by <span className="author-name">{book.author}</span>
              </p>
            </div>

            {/* Bookstore Obi Band (Physical Book Belly Wrap) */}
            <div className="full-tome-obi-band">
              <div className="obi-band-texture" />

              {/* Price & Seller Row */}
              <div className="obi-band-meta-row">
                <div className="book-card-price-group">
                  <span className="price-label">Price</span>
                  <span className="price-value">{formatINR(book.price, book.priceInPaise)}</span>
                </div>

                {isOwner ? (
                  <div className="book-card-owner-indicator" title="Listed by you">
                    <span className="owner-dot" aria-hidden="true" />
                    <span className="seller-name">Your Listing</span>
                  </div>
                ) : book.seller ? (
                  <Link
                    to={`/students/${book.seller._id || book.seller}`}
                    className="book-card-seller book-card-seller-link"
                    title={`View student profile for ${book.seller?.displayName || book.seller?.name || 'Student'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {book.seller?.avatarUrl ? (
                      <img
                        src={book.seller.avatarUrl}
                        alt=""
                        className="book-card-seller-avatar"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <User size={13} className="seller-icon" aria-hidden="true" />
                    )}
                    <span className="seller-name">{book.seller?.displayName || book.seller?.name || 'Student'}</span>
                  </Link>
                ) : (
                  <div className="book-card-seller" title="Listed by Student">
                    <User size={13} className="seller-icon" aria-hidden="true" />
                    <span className="seller-name">Student</span>
                  </div>
                )}
              </div>

              {/* Card Actions on the Obi Band */}
              <div className={`book-card-actions ${isOwner ? 'is-owner' : ''}`}>
                {!isOwner ? (
                  <button
                    type="button"
                    className="btn-card-details"
                    aria-label={`View details for ${book.title}`}
                    onClick={handleOpenModal}
                  >
                    <Eye size={15} aria-hidden="true" />
                    <span>View Details</span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-card-details btn-card-details-compact"
                      aria-label={`View details for ${book.title}`}
                      title="View full listing details"
                      onClick={handleOpenModal}
                    >
                      <Eye size={13} aria-hidden="true" />
                      <span>View</span>
                    </button>

                    {isReserved || isSold ? (
                      <button
                        type="button"
                        disabled
                        className="btn-card-owner-edit opacity-60 cursor-not-allowed"
                        title={isReserved ? 'Cannot edit while reserved' : 'Cannot edit sold listing'}
                        aria-label={`Cannot edit ${book.title}`}
                      >
                        <Edit3 size={12} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                    ) : (
                      <Link
                        to={`/books/${book._id}/edit`}
                        className="btn-card-owner-edit"
                        title="Edit listing details"
                        aria-label={`Edit ${book.title}`}
                      >
                        <Edit3 size={12} aria-hidden="true" />
                        <span>Edit</span>
                      </Link>
                    )}

                    {onStatusToggle && (
                      <button
                        type="button"
                        onClick={() => onStatusToggle(book)}
                        disabled={isActionLoading || isReserved}
                        className={`btn-card-owner-status ${isSold ? 'relist' : 'mark-sold'}`}
                        title={isReserved ? 'Cannot change status while reserved' : isSold ? 'Mark listing back as available' : 'Mark listing as sold'}
                        aria-label={isSold ? `Mark ${book.title} as available` : `Mark ${book.title} as sold`}
                      >
                        <CheckCircle2 size={12} aria-hidden="true" />
                        <span>{isSold ? 'Relist' : 'Sold'}</span>
                      </button>
                    )}

                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(book)}
                        disabled={isActionLoading || isReserved || isSold}
                        className="btn-card-owner-delete"
                        title={isReserved ? 'Cannot delete while reserved' : isSold ? 'Cannot delete sold listing' : 'Delete this listing'}
                        aria-label={`Delete ${book.title}`}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* 3D Book Details Modal (z-index > page: z-index 10000) */}
      <AnimatePresence>
        {isModalOpen && (
          <BookDetailsModal
            key={`modal-${book._id}`}
            bookId={book._id}
            initialBook={book}
            onClose={() => setIsModalOpen(false)}
            onListingUpdated={(updatedBook, deletedId) => {
              if (deletedId) {
                setIsDeleted(true);
                if (onDelete) {
                  onDelete({ _id: deletedId, title: book.title });
                }
              } else if (updatedBook) {
                setBook(updatedBook);
                if (onStatusToggle) {
                  onStatusToggle(updatedBook);
                }
              }
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default BookCard;

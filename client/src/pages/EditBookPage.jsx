import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit3,
  BookOpen,
  DollarSign,
  Barcode,
  Image,
  AlertCircle,
  Tag,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { bookService, BOOK_CATEGORIES, BOOK_CONDITIONS, formatINR } from '../services/bookService';
import { validateBookForm } from '../utils/validation';
import { Alert } from '../components/Alert';

export const EditBookPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [formData, setFormData] = useState({
    title: '',
    author: '',
    description: '',
    category: '',
    condition: 'Good',
    price: '',
    isbn: '',
    imageUrl: '',
  });

  const [isLoading, setIsLoading] = useState(true);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load existing book data
  const loadBookData = useCallback(async () => {
    setIsLoading(true);
    setFormError('');
    try {
      const res = await bookService.getBookById(id);
      if (res.success && res.data?.book) {
        const book = res.data.book;

        // Check ownership
        const sellerId = book.seller?._id || book.seller;
        if (user && sellerId && sellerId.toString() !== user._id.toString()) {
          navigate('/my-listings', {
            replace: true,
            state: { errorMessage: 'You are not authorized to edit this listing.' },
          });
          return;
        }

        setFormData({
          title: book.title || '',
          author: book.author || '',
          description: book.description || '',
          category: book.category || '',
          condition: book.condition || 'Good',
          price: book.price !== undefined ? String(book.price) : '',
          isbn: book.isbn || '',
          imageUrl: book.imageUrl || '',
        });
      } else {
        setFormError('Book listing not found.');
      }
    } catch (err) {
      setFormError(err.message || 'Failed to retrieve listing details.');
    } finally {
      setIsLoading(false);
    }
  }, [id, user, navigate]);

  useEffect(() => {
    loadBookData();
  }, [loadBookData]);

  const validateClientSide = () => {
    const { isValid, errors } = validateBookForm(formData);
    setFieldErrors(errors);
    return isValid;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!validateClientSide()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await bookService.updateBook(id, {
        title: formData.title.trim(),
        author: formData.author.trim(),
        description: formData.description.trim(),
        category: formData.category,
        condition: formData.condition,
        price: Number(formData.price),
        isbn: formData.isbn.trim(),
        imageUrl: formData.imageUrl.trim(),
      });

      if (res.success && res.data?.book) {
        navigate(`/books/${id}`, {
          state: { successMessage: 'Your book listing has been updated successfully.' },
        });
      } else {
        setFormError(res.message || 'Failed to update book listing.');
      }
    } catch (err) {
      if (err.isValidationError && err.data?.errors) {
        const backendErrors = {};
        err.data.errors.forEach((e) => {
          backendErrors[e.field] = e.message;
        });
        setFieldErrors(backendErrors);
        setFormError(err.message || 'Please correct the highlighted fields.');
      } else {
        setFormError(err.message || 'Server error while updating listing.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="book-detail-loading" role="status" aria-live="polite">
        <div className="loading-card">
          <div className="spinner-orbit">
            <BookOpen size={28} className="pulse-icon" aria-hidden="true" />
          </div>
          <p className="loading-text">Loading listing data for editing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="form-page-container">
      <div className="form-nav-bar">
        <Link to={`/books/${id}`} className="btn-back-nav">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back to Book Details</span>
        </Link>
      </div>

      <div className="form-card-container">
        <div className="form-card-header">
          <div className="form-header-badge">
            <Edit3 size={20} className="badge-icon" aria-hidden="true" />
            <span>Update Listing</span>
          </div>
          <h1 className="form-title">Edit Book Listing</h1>
          <p className="form-subtitle">
            Update pricing, condition, description, or image details for your textbook.
          </p>
        </div>

        {formError && (
          <Alert
            type="error"
            message={formError}
            onDismiss={() => setFormError('')}
            className="mb-4"
          />
        )}

        <form onSubmit={handleSubmit} noValidate className="book-form">
          {/* Title */}
          <div className="form-group">
            <label htmlFor="edit-title" className="form-label">
              Book Title <span className="required-star">*</span>
            </label>
            <input
              type="text"
              id="edit-title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              className={`form-input ${fieldErrors.title ? 'input-error' : ''}`}
              maxLength={150}
              aria-invalid={Boolean(fieldErrors.title)}
            />
            {fieldErrors.title && (
              <span className="field-error-msg" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>{fieldErrors.title}</span>
              </span>
            )}
          </div>

          {/* Author */}
          <div className="form-group">
            <label htmlFor="edit-author" className="form-label">
              Author(s) <span className="required-star">*</span>
            </label>
            <input
              type="text"
              id="edit-author"
              name="author"
              value={formData.author}
              onChange={handleChange}
              className={`form-input ${fieldErrors.author ? 'input-error' : ''}`}
              maxLength={100}
              aria-invalid={Boolean(fieldErrors.author)}
            />
            {fieldErrors.author && (
              <span className="field-error-msg" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>{fieldErrors.author}</span>
              </span>
            )}
          </div>

          {/* Category & Condition Row */}
          <div className="form-grid-2col">
            <div className="form-group">
              <label htmlFor="edit-category" className="form-label">
                Academic Category <span className="required-star">*</span>
              </label>
              <select
                id="edit-category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                className={`form-select ${fieldErrors.category ? 'input-error' : ''}`}
              >
                <option value="">Select Category</option>
                {BOOK_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {fieldErrors.category && (
                <span className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.category}</span>
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="edit-condition" className="form-label">
                Book Condition <span className="required-star">*</span>
              </label>
              <select
                id="edit-condition"
                name="condition"
                value={formData.condition}
                onChange={handleChange}
                className={`form-select ${fieldErrors.condition ? 'input-error' : ''}`}
              >
                {BOOK_CONDITIONS.map((cond) => (
                  <option key={cond} value={cond}>
                    {cond}
                  </option>
                ))}
              </select>
              {fieldErrors.condition && (
                <span className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.condition}</span>
                </span>
              )}
            </div>
          </div>

          {/* Price & ISBN Row */}
          <div className="form-grid-2col">
            <div className="form-group">
              <label htmlFor="edit-price" className="form-label">
                Selling Price in INR (₹) <span className="required-star">*</span>
              </label>
              <div className="input-prefix-wrapper">
                <span className="input-prefix" aria-hidden="true">
                  ₹
                </span>
                <input
                  type="number"
                  step="any"
                  min="1"
                  max="100000"
                  id="edit-price"
                  name="price"
                  value={formData.price}
                  onChange={handleChange}
                  className={`form-input with-prefix ${fieldErrors.price ? 'input-error' : ''}`}
                />
              </div>
              {formData.price && !isNaN(Number(formData.price)) && Number(formData.price) >= 1 && (
                <div className="form-hint-preview">
                  <span>Formatted Price: <strong>{formatINR(Number(formData.price))}</strong></span>
                </div>
              )}
              {fieldErrors.price && (
                <span className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.price}</span>
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="edit-isbn" className="form-label">
                ISBN <span className="optional-tag">(Optional)</span>
              </label>
              <input
                type="text"
                id="edit-isbn"
                name="isbn"
                value={formData.isbn}
                onChange={handleChange}
                className={`form-input ${fieldErrors.isbn ? 'input-error' : ''}`}
                maxLength={20}
              />
              {fieldErrors.isbn && (
                <span className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.isbn}</span>
                </span>
              )}
            </div>
          </div>

          {/* Image URL */}
          <div className="form-group">
            <label htmlFor="edit-image" className="form-label">
              Book Cover Image URL <span className="optional-tag">(Optional)</span>
            </label>
            <input
              type="url"
              id="edit-image"
              name="imageUrl"
              value={formData.imageUrl}
              onChange={handleChange}
              className={`form-input ${fieldErrors.imageUrl ? 'input-error' : ''}`}
              maxLength={500}
            />
            {formData.imageUrl && /^https?:\/\/.+/i.test(formData.imageUrl) && !fieldErrors.imageUrl && (
              <div className="form-image-preview-box">
                <span className="preview-label">Cover Preview:</span>
                <img
                  src={formData.imageUrl}
                  alt="Book cover preview"
                  className="form-image-preview-thumb"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </div>
            )}
            {fieldErrors.imageUrl && (
              <span className="field-error-msg" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>{fieldErrors.imageUrl}</span>
              </span>
            )}
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="edit-description" className="form-label">
              Description & Course Notes <span className="required-star">*</span>
            </label>
            <textarea
              id="edit-description"
              name="description"
              rows={4}
              value={formData.description}
              onChange={handleChange}
              className={`form-textarea ${fieldErrors.description ? 'input-error' : ''}`}
              maxLength={2000}
            />
            <div className="textarea-footer">
              {fieldErrors.description ? (
                <span className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.description}</span>
                </span>
              ) : (
                <span className="char-count">
                  {formData.description.length}/2000 characters
                </span>
              )}
            </div>
          </div>

          {/* Form Actions */}
          <div className="form-actions">
            <Link to="/my-listings" className="btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary btn-submit-form"
              id="save-book-btn"
            >
              {isSubmitting ? (
                <span>Saving Changes...</span>
              ) : (
                <>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

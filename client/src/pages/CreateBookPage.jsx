import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  BookPlus,
  BookOpen,
  DollarSign,
  Barcode,
  Image,
  AlertCircle,
  Tag,
  CheckCircle2,
} from 'lucide-react';
import { bookService, BOOK_CATEGORIES, BOOK_CONDITIONS, formatINR } from '../services/bookService';
import { validateBookForm } from '../utils/validation';
import { Alert } from '../components/Alert';

export const CreateBookPage = () => {
  const navigate = useNavigate();

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

  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const res = await bookService.createBook({
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
        navigate(`/books/${res.data.book._id}`, {
          state: { successMessage: 'Your book listing has been published for sale!' },
        });
      } else {
        setFormError(res.message || 'Failed to publish book listing.');
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
        setFormError(err.message || 'Server error while publishing listing.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="form-page-container">
      <div className="form-nav-bar">
        <Link to="/books" className="btn-back-nav">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back to Marketplace</span>
        </Link>
      </div>

      <div className="form-card-container">
        <div className="form-card-header">
          <div className="form-header-badge">
            <BookPlus size={20} className="badge-icon" aria-hidden="true" />
            <span>Marketplace Listing</span>
          </div>
          <h1 className="form-title">Sell a Second-Hand Book</h1>
          <p className="form-subtitle">
            Provide accurate textbook details to help campus students find your course materials.
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
            <label htmlFor="book-title" className="form-label">
              Book Title <span className="required-star">*</span>
            </label>
            <input
              type="text"
              id="book-title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="e.g. Introduction to Algorithms, 4th Edition"
              className={`form-input ${fieldErrors.title ? 'input-error' : ''}`}
              maxLength={150}
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? 'title-error' : undefined}
            />
            {fieldErrors.title && (
              <span id="title-error" className="field-error-msg" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>{fieldErrors.title}</span>
              </span>
            )}
          </div>

          {/* Author */}
          <div className="form-group">
            <label htmlFor="book-author" className="form-label">
              Author(s) <span className="required-star">*</span>
            </label>
            <input
              type="text"
              id="book-author"
              name="author"
              value={formData.author}
              onChange={handleChange}
              placeholder="e.g. Thomas H. Cormen, Charles E. Leiserson"
              className={`form-input ${fieldErrors.author ? 'input-error' : ''}`}
              maxLength={100}
              aria-invalid={Boolean(fieldErrors.author)}
              aria-describedby={fieldErrors.author ? 'author-error' : undefined}
            />
            {fieldErrors.author && (
              <span id="author-error" className="field-error-msg" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>{fieldErrors.author}</span>
              </span>
            )}
          </div>

          {/* Category & Condition Row */}
          <div className="form-grid-2col">
            <div className="form-group">
              <label htmlFor="book-category" className="form-label">
                Academic Category <span className="required-star">*</span>
              </label>
              <select
                id="book-category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                className={`form-select ${fieldErrors.category ? 'input-error' : ''}`}
                aria-invalid={Boolean(fieldErrors.category)}
                aria-describedby={fieldErrors.category ? 'category-error' : undefined}
              >
                <option value="">Select Category</option>
                {BOOK_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {fieldErrors.category && (
                <span id="category-error" className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.category}</span>
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="book-condition" className="form-label">
                Book Condition <span className="required-star">*</span>
              </label>
              <select
                id="book-condition"
                name="condition"
                value={formData.condition}
                onChange={handleChange}
                className={`form-select ${fieldErrors.condition ? 'input-error' : ''}`}
                aria-invalid={Boolean(fieldErrors.condition)}
                aria-describedby={fieldErrors.condition ? 'condition-error' : undefined}
              >
                {BOOK_CONDITIONS.map((cond) => (
                  <option key={cond} value={cond}>
                    {cond}
                  </option>
                ))}
              </select>
              {fieldErrors.condition && (
                <span id="condition-error" className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.condition}</span>
                </span>
              )}
            </div>
          </div>

          {/* Price & ISBN Row */}
          <div className="form-grid-2col">
            <div className="form-group">
              <label htmlFor="book-price" className="form-label">
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
                  id="book-price"
                  name="price"
                  value={formData.price}
                  onChange={handleChange}
                  placeholder="e.g. 450"
                  className={`form-input with-prefix ${fieldErrors.price ? 'input-error' : ''}`}
                  aria-invalid={Boolean(fieldErrors.price)}
                  aria-describedby={fieldErrors.price ? 'price-error' : undefined}
                />
              </div>
              {formData.price && !isNaN(Number(formData.price)) && Number(formData.price) >= 1 && (
                <div className="form-hint-preview">
                  <span>Formatted Price: <strong>{formatINR(Number(formData.price))}</strong></span>
                </div>
              )}
              {fieldErrors.price && (
                <span id="price-error" className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.price}</span>
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="book-isbn" className="form-label">
                ISBN <span className="optional-tag">(Optional)</span>
              </label>
              <input
                type="text"
                id="book-isbn"
                name="isbn"
                value={formData.isbn}
                onChange={handleChange}
                placeholder="10 or 13-digit ISBN"
                className={`form-input ${fieldErrors.isbn ? 'input-error' : ''}`}
                maxLength={20}
                aria-invalid={Boolean(fieldErrors.isbn)}
                aria-describedby={fieldErrors.isbn ? 'isbn-error' : undefined}
              />
              {fieldErrors.isbn && (
                <span id="isbn-error" className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.isbn}</span>
                </span>
              )}
            </div>
          </div>

          {/* Image URL */}
          <div className="form-group">
            <label htmlFor="book-image" className="form-label">
              Book Cover Image URL <span className="optional-tag">(Optional)</span>
            </label>
            <input
              type="url"
              id="book-image"
              name="imageUrl"
              value={formData.imageUrl}
              onChange={handleChange}
              placeholder="https://images.example.com/textbook-cover.jpg"
              className={`form-input ${fieldErrors.imageUrl ? 'input-error' : ''}`}
              maxLength={500}
              aria-invalid={Boolean(fieldErrors.imageUrl)}
              aria-describedby={fieldErrors.imageUrl ? 'image-error' : undefined}
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
              <span id="image-error" className="field-error-msg" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>{fieldErrors.imageUrl}</span>
              </span>
            )}
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="book-description" className="form-label">
              Description & Course Notes <span className="required-star">*</span>
            </label>
            <textarea
              id="book-description"
              name="description"
              rows={4}
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe syllabus edition, highlighting, missing pages, or course code (e.g. Used for CS101 with Prof. Sharma)..."
              className={`form-textarea ${fieldErrors.description ? 'input-error' : ''}`}
              maxLength={2000}
              aria-invalid={Boolean(fieldErrors.description)}
              aria-describedby={fieldErrors.description ? 'desc-error' : undefined}
            />
            <div className="textarea-footer">
              {fieldErrors.description ? (
                <span id="desc-error" className="field-error-msg" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.description}</span>
                </span>
              ) : (
                <span className="char-count">
                  {formData.description.length}/2000 characters (minimum 10)
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="form-actions">
            <Link to="/books" className="btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary btn-submit-form"
              id="submit-book-btn"
            >
              {isSubmitting ? (
                <span>Publishing Listing...</span>
              ) : (
                <>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>Publish Book for Sale</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

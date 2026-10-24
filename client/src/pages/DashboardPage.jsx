import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck,
  LogOut,
  User,
  Layers,
  BookOpen,
  Calendar,
  FileCheck,
  PlusCircle,
  Inbox,
  ArrowRight,
  GraduationCap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Alert } from '../components/Alert';

export const DashboardPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  const handleLogout = async () => {
    setIsSigningOut(true);
    setLogoutError('');
    try {
      const result = await logout();
      if (result.success) {
        navigate('/login', {
          state: { successMessage: 'You have been safely signed out.' },
        });
      } else {
        setLogoutError(result.error || 'Server session revocation could not be confirmed.');
      }
    } finally {
      setIsSigningOut(false);
    }
  };

  const memberSinceFormatted = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Current Academic Term';

  return (
    <div className="dashboard-container">
      {/* Top Welcome Hero */}
      <section className="dashboard-hero" aria-labelledby="dashboard-heading">
        <div className="hero-content">
          <div className="hero-pill-cluster">
            <span className="hero-badge">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>Email-Verified Student</span>
            </span>
            <span className="hero-meta-tag">
              <Calendar size={13} aria-hidden="true" />
              <span>Joined {memberSinceFormatted}</span>
            </span>
          </div>

          <h1 id="dashboard-heading" className="hero-title">
            Welcome back, {user?.name || 'Student'}!
          </h1>
          <p className="hero-subtitle">
            Manage your textbook listings, check purchase requests, and trade course materials directly with fellow students.
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            onClick={handleLogout}
            disabled={isSigningOut}
            className="btn-danger-outline"
            aria-label="Sign out of student account"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{isSigningOut ? 'Signing out...' : 'Sign Out'}</span>
          </button>
        </div>
      </section>

      {logoutError && (
        <Alert
          type="warning"
          message={logoutError}
          onDismiss={() => setLogoutError('')}
          className="mb-4"
        />
      )}

      {/* Quick Action Navigation Grid */}
      <section className="dashboard-actions-grid" aria-label="Student Quick Actions">
        <Link to="/books" className="action-tile-card" id="dashboard-browse-books">
          <div className="action-tile-icon-box primary">
            <BookOpen size={24} aria-hidden="true" />
          </div>
          <div className="action-tile-body">
            <h2 className="action-tile-title">Browse Marketplace</h2>
            <p className="action-tile-desc">Find textbooks and reading lists posted by students on campus.</p>
          </div>
          <div className="action-tile-footer">
            <span>Explore books</span>
            <ArrowRight size={15} aria-hidden="true" />
          </div>
        </Link>

        <Link to="/books/new" className="action-tile-card" id="dashboard-sell-book">
          <div className="action-tile-icon-box success">
            <PlusCircle size={24} aria-hidden="true" />
          </div>
          <div className="action-tile-body">
            <h2 className="action-tile-title">Sell a Book</h2>
            <p className="action-tile-desc">List a textbook for sale in under a minute with fair student pricing.</p>
          </div>
          <div className="action-tile-footer">
            <span>Post listing</span>
            <ArrowRight size={15} aria-hidden="true" />
          </div>
        </Link>

        <Link to="/my-listings" className="action-tile-card" id="dashboard-my-listings">
          <div className="action-tile-icon-box cyan">
            <Layers size={24} aria-hidden="true" />
          </div>
          <div className="action-tile-body">
            <h2 className="action-tile-title">My Listings</h2>
            <p className="action-tile-desc">Track and manage the books you currently have available or sold.</p>
          </div>
          <div className="action-tile-footer">
            <span>View inventory</span>
            <ArrowRight size={15} aria-hidden="true" />
          </div>
        </Link>

        <Link to="/purchase-requests" className="action-tile-card" id="dashboard-requests">
          <div className="action-tile-icon-box purple">
            <Inbox size={24} aria-hidden="true" />
          </div>
          <div className="action-tile-body">
            <h2 className="action-tile-title">Purchase Requests</h2>
            <p className="action-tile-desc">Respond to buyer offers, accept requests, and confirm campus trades.</p>
          </div>
          <div className="action-tile-footer">
            <span>Manage requests</span>
            <ArrowRight size={15} aria-hidden="true" />
          </div>
        </Link>
      </section>

      {/* Main Content 2-Column Section */}
      <section className="dashboard-main-grid" aria-label="Student Account Details & Guidelines">
        {/* Left Column: Student Profile Summary */}
        <div className="dashboard-column">
          <div className="dashboard-card">
            <div className="card-header">
              <div className="card-header-icon" aria-hidden="true">
                <User size={20} />
              </div>
              <div>
                <h2 className="card-title">My Profile</h2>
                <p className="card-desc">Your campus account details</p>
              </div>
            </div>

            <div className="profile-attributes-list">
              <div className="attr-item">
                <span className="attr-title">Full Name</span>
                <span className="attr-data">{user?.name || 'Student'}</span>
              </div>
              <div className="attr-item">
                <span className="attr-title">Student Email</span>
                <span className="attr-data">{user?.email}</span>
              </div>
              <div className="attr-item">
                <span className="attr-title">Account Status</span>
                <span className="badge-verified">
                  <ShieldCheck size={13} aria-hidden="true" />
                  <span>Email Verified</span>
                </span>
              </div>
              <div className="attr-item">
                <span className="attr-title">Member Since</span>
                <span className="attr-data">{memberSinceFormatted}</span>
              </div>
            </div>

            <div className="dashboard-profile-actions">
              <Link
                to="/profile/edit"
                className="btn-secondary btn-sm flex items-center justify-center gap-2"
                id="dashboard-edit-profile-btn"
              >
                <User size={14} aria-hidden="true" />
                <span>Edit Profile & Academic Details</span>
              </Link>
              {(user?.id || user?._id) && (
                <Link
                  to={`/students/${user.id || user._id}`}
                  className="btn-secondary btn-sm flex items-center justify-center gap-2 opacity-90"
                  id="dashboard-view-public-profile-btn"
                >
                  <GraduationCap size={14} aria-hidden="true" />
                  <span>View Public Seller Profile</span>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Practical Campus Exchange Guide */}
        <div className="dashboard-column">
          <div className="dashboard-card prep-guide-card">
            <div className="card-header">
              <div className="card-header-icon" aria-hidden="true">
                <FileCheck size={20} />
              </div>
              <div>
                <h2 className="card-title">Campus Exchange Guide</h2>
                <p className="card-desc">Tips for smooth textbook buying and selling</p>
              </div>
            </div>

            <div className="prep-steps-list">
              <div className="prep-step-item">
                <div className="prep-step-num" aria-hidden="true">1</div>
                <div className="prep-step-info">
                  <strong>Match Required Editions</strong>
                  <p>Check syllabus reading lists for ISBNs and editions before buying so you get the exact version needed.</p>
                </div>
              </div>

              <div className="prep-step-item">
                <div className="prep-step-num" aria-hidden="true">2</div>
                <div className="prep-step-info">
                  <strong>Be Transparent with Condition</strong>
                  <p>State whether the textbook has highlighting, notes, or wear so trades remain fair and trustworthy.</p>
                </div>
              </div>

              <div className="prep-step-item">
                <div className="prep-step-num" aria-hidden="true">3</div>
                <div className="prep-step-info">
                  <strong>Meet at Public Campus Spots</strong>
                  <p>Coordinate textbook handovers at convenient on-campus locations like the library, cafeteria, or student center.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

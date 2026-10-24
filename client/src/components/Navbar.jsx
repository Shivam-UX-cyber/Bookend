import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  LogOut,
  User as UserIcon,
  ShieldCheck,
  Menu,
  X,
  LayoutDashboard,
  Layers,
  PlusCircle,
  Inbox,
  ChevronDown,
  GraduationCap,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { NotificationBell } from './NotificationBell';

export const Navbar = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  const navRef = useRef(null);
  const userDropdownRef = useRef(null);

  // Close menus on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setUserDropdownOpen(false);
  }, [location.pathname]);

  // Handle outside clicks and Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (userDropdownOpen) setUserDropdownOpen(false);
        if (mobileMenuOpen) setMobileMenuOpen(false);
      }
    };

    const handleClickOutside = (e) => {
      if (
        userDropdownRef.current &&
        !userDropdownRef.current.contains(e.target) &&
        userDropdownOpen
      ) {
        setUserDropdownOpen(false);
      }
      if (
        navRef.current &&
        !navRef.current.contains(e.target) &&
        mobileMenuOpen
      ) {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userDropdownOpen, mobileMenuOpen]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Reset avatar error when avatarUrl changes
  useEffect(() => {
    setAvatarError(false);
  }, [user?.avatarUrl]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const res = await logout();
      navigate('/login', {
        state: res?.success
          ? { successMessage: 'You have been safely signed out.' }
          : { warningMessage: res?.error || 'Local session ended. Server session could not be confirmed.' },
      });
    } finally {
      setIsLoggingOut(false);
      setUserDropdownOpen(false);
      setMobileMenuOpen(false);
    }
  };

  const isDashboardActive = location.pathname === '/dashboard';
  const isBooksActive =
    location.pathname === '/books' ||
    (location.pathname.startsWith('/books/') && location.pathname !== '/books/new');
  const isMyListingsActive = location.pathname === '/my-listings';
  const isSellActive = location.pathname === '/books/new';
  const isRequestsActive = location.pathname.startsWith('/purchase-requests');
  const isProfileActive =
    location.pathname === '/profile/edit' ||
    location.pathname.startsWith('/students/');
  const isLoginActive = location.pathname === '/login';
  const isRegisterActive = location.pathname === '/register';

  const userDisplayName = user?.displayName || user?.name || 'Student';
  const userInitial = userDisplayName ? userDisplayName.charAt(0).toUpperCase() : 'S';
  const firstName = userDisplayName.split(' ')[0] || userDisplayName;
  const userProfileId = user?.id || user?._id;

  return (
    <>
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      <header className="navbar-header" role="banner" ref={navRef}>
        <div className="navbar-container">
          {/* Brand Logo */}
          <Link
            to={isAuthenticated ? '/dashboard' : '/books'}
            className="navbar-brand"
            aria-label="Bookend — Campus Book Exchange Home"
          >
            <div className="brand-logo-icon" aria-hidden="true">
              <BookOpen size={20} className="brand-icon" />
            </div>
            <div className="brand-text-group">
              <span className="brand-title">Bookend</span>
              <span className="brand-badge">Campus Book Exchange</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="navbar-actions-desktop" aria-label="Primary Navigation">
            {/* Primary Nav Links */}
            <div className="nav-links-cluster">
              <Link
                to="/books"
                className={`nav-link ${isBooksActive ? 'active' : ''}`}
                aria-current={isBooksActive ? 'page' : undefined}
              >
                <BookOpen size={15} aria-hidden="true" />
                <span>Browse</span>
              </Link>

              {isAuthenticated && (
                <>
                  <Link
                    to="/my-listings"
                    className={`nav-link ${isMyListingsActive ? 'active' : ''}`}
                    aria-current={isMyListingsActive ? 'page' : undefined}
                  >
                    <Layers size={15} aria-hidden="true" />
                    <span>My Listings</span>
                  </Link>

                  <Link
                    to="/purchase-requests"
                    className={`nav-link ${isRequestsActive ? 'active' : ''}`}
                    aria-current={isRequestsActive ? 'page' : undefined}
                    id="nav-requests-btn"
                  >
                    <Inbox size={15} aria-hidden="true" />
                    <span>Requests</span>
                  </Link>

                  <Link
                    to="/dashboard"
                    className={`nav-link ${isDashboardActive ? 'active' : ''}`}
                    aria-current={isDashboardActive ? 'page' : undefined}
                  >
                    <LayoutDashboard size={15} aria-hidden="true" />
                    <span>Dashboard</span>
                  </Link>
                </>
              )}
            </div>

            {/* Right Action Cluster */}
            <div className="nav-right-cluster">
              {isAuthenticated ? (
                <>
                  <Link
                    to="/books/new"
                    className={`btn-nav-sell ${isSellActive ? 'active' : ''}`}
                    id="nav-sell-btn"
                  >
                    <PlusCircle size={15} aria-hidden="true" />
                    <span>Sell a Book</span>
                  </Link>

                  <NotificationBell />

                  {/* Desktop User Menu Dropdown */}
                  <div className="user-dropdown-container" ref={userDropdownRef}>
                    <button
                      type="button"
                      className={`user-profile-trigger ${userDropdownOpen ? 'active' : ''}`}
                      onClick={() => setUserDropdownOpen((prev) => !prev)}
                      aria-expanded={userDropdownOpen}
                      aria-haspopup="true"
                      aria-label={`User menu for ${userDisplayName}`}
                    >
                      <div className="user-avatar-circle" aria-hidden="true">
                        {user?.avatarUrl && !avatarError ? (
                          <img
                            src={user.avatarUrl}
                            alt=""
                            className="user-nav-avatar-img"
                            onError={() => setAvatarError(true)}
                          />
                        ) : (
                          userInitial
                        )}
                      </div>
                      <span className="user-trigger-name">{firstName}</span>
                      <ChevronDown
                        size={14}
                        className={`user-trigger-chevron ${userDropdownOpen ? 'rotate' : ''}`}
                        aria-hidden="true"
                      />
                    </button>

                    {userDropdownOpen && (
                      <div
                        className="user-menu-dropdown"
                        role="menu"
                        aria-label="User Account Menu"
                      >
                        {/* Dropdown User Info Card */}
                        <div className="dropdown-user-header">
                          <div className="dropdown-avatar-circle" aria-hidden="true">
                            {user?.avatarUrl && !avatarError ? (
                              <img
                                src={user.avatarUrl}
                                alt=""
                                className="user-nav-avatar-img"
                                onError={() => setAvatarError(true)}
                              />
                            ) : (
                              userInitial
                            )}
                          </div>
                          <div className="dropdown-user-info">
                            <span className="dropdown-name" title={userDisplayName}>
                              {userDisplayName}
                            </span>
                            <span className="dropdown-email" title={user?.email}>
                              {user?.email}
                            </span>
                            <span className="dropdown-verified-badge">
                              <ShieldCheck size={11} aria-hidden="true" />
                              <span>Email-Verified Student</span>
                            </span>
                          </div>
                        </div>

                        <div className="dropdown-divider" />

                        {/* Navigation Links */}
                        <div className="dropdown-links-list">
                          <Link
                            to="/dashboard"
                            className={`dropdown-item ${isDashboardActive ? 'active' : ''}`}
                            role="menuitem"
                          >
                            <LayoutDashboard size={15} aria-hidden="true" />
                            <span>Dashboard</span>
                          </Link>

                          <Link
                            to="/my-listings"
                            className={`dropdown-item ${isMyListingsActive ? 'active' : ''}`}
                            role="menuitem"
                          >
                            <Layers size={15} aria-hidden="true" />
                            <span>My Listings</span>
                          </Link>

                          <Link
                            to="/purchase-requests"
                            className={`dropdown-item ${isRequestsActive ? 'active' : ''}`}
                            role="menuitem"
                          >
                            <Inbox size={15} aria-hidden="true" />
                            <span>Purchase Requests</span>
                          </Link>

                          {userProfileId && (
                            <Link
                              to={`/students/${userProfileId}`}
                              className="dropdown-item"
                              role="menuitem"
                            >
                              <GraduationCap size={15} aria-hidden="true" />
                              <span>Public Seller Profile</span>
                            </Link>
                          )}

                          <Link
                            to="/profile/edit"
                            className={`dropdown-item ${isProfileActive ? 'active' : ''}`}
                            role="menuitem"
                          >
                            <Settings size={15} aria-hidden="true" />
                            <span>Edit Profile & Privacy</span>
                          </Link>
                        </div>

                        <div className="dropdown-divider" />

                        {/* Sign Out Button */}
                        <button
                          type="button"
                          onClick={handleLogout}
                          disabled={isLoggingOut}
                          className="dropdown-item dropdown-logout-btn btn-nav-logout"
                          role="menuitem"
                        >
                          <LogOut size={15} aria-hidden="true" />
                          <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="nav-auth-links">
                  <Link
                    to="/login"
                    className={`btn-nav-login ${isLoginActive ? 'active' : ''}`}
                    aria-current={isLoginActive ? 'page' : undefined}
                  >
                    Log In
                  </Link>
                  <Link
                    to="/register"
                    className={`btn-nav-register ${isRegisterActive ? 'active' : ''}`}
                    aria-current={isRegisterActive ? 'page' : undefined}
                  >
                    Sign Up
                  </Link>
                </div>
              )}
            </div>
          </nav>

          {/* Mobile Header Controls */}
          <div className="mobile-header-controls">
            {isAuthenticated && <NotificationBell isMobile={true} />}
            <button
              type="button"
              className="mobile-menu-toggle"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-drawer"
            >
              {mobileMenuOpen ? (
                <X size={22} aria-hidden="true" />
              ) : (
                <Menu size={22} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Backdrop Overlay */}
        {mobileMenuOpen && (
          <div
            className="mobile-nav-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <nav
            id="mobile-nav-drawer"
            className="mobile-nav-drawer"
            aria-label="Mobile Primary Navigation"
          >
            {isAuthenticated ? (
              <div className="mobile-user-section">
                {/* Mobile Profile Card */}
                <div className="mobile-profile-card">
                  <div className="user-avatar-circle large" aria-hidden="true">
                    {user?.avatarUrl && !avatarError ? (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="user-nav-avatar-img"
                        onError={() => setAvatarError(true)}
                      />
                    ) : (
                      userInitial
                    )}
                  </div>
                  <div className="mobile-profile-info">
                    <strong className="mobile-user-name">{userDisplayName}</strong>
                    <span className="mobile-user-email">{user?.email}</span>
                    <span className="mobile-verified-tag">
                      <ShieldCheck size={12} aria-hidden="true" />
                      <span>Email-Verified Student</span>
                    </span>
                  </div>
                </div>

                {/* Primary Sell Action */}
                <Link
                  to="/books/new"
                  className="btn-nav-sell mobile-sell-btn"
                  id="mobile-nav-sell-btn"
                >
                  <PlusCircle size={17} aria-hidden="true" />
                  <span>Sell a Book</span>
                </Link>

                {/* Mobile Navigation Links */}
                <div className="mobile-links-list">
                  <Link
                    to="/books"
                    className={`mobile-nav-item ${isBooksActive ? 'active' : ''}`}
                    aria-current={isBooksActive ? 'page' : undefined}
                  >
                    <BookOpen size={18} aria-hidden="true" />
                    <span>Browse Books</span>
                  </Link>

                  <Link
                    to="/my-listings"
                    className={`mobile-nav-item ${isMyListingsActive ? 'active' : ''}`}
                    aria-current={isMyListingsActive ? 'page' : undefined}
                  >
                    <Layers size={18} aria-hidden="true" />
                    <span>My Listings</span>
                  </Link>

                  <Link
                    to="/purchase-requests"
                    className={`mobile-nav-item ${isRequestsActive ? 'active' : ''}`}
                    aria-current={isRequestsActive ? 'page' : undefined}
                  >
                    <Inbox size={18} aria-hidden="true" />
                    <span>Purchase Requests</span>
                  </Link>

                  <Link
                    to="/dashboard"
                    className={`mobile-nav-item ${isDashboardActive ? 'active' : ''}`}
                    aria-current={isDashboardActive ? 'page' : undefined}
                  >
                    <LayoutDashboard size={18} aria-hidden="true" />
                    <span>Dashboard</span>
                  </Link>

                  {userProfileId && (
                    <Link
                      to={`/students/${userProfileId}`}
                      className="mobile-nav-item"
                    >
                      <GraduationCap size={18} aria-hidden="true" />
                      <span>Public Seller Profile</span>
                    </Link>
                  )}

                  <Link
                    to="/profile/edit"
                    className={`mobile-nav-item ${isProfileActive ? 'active' : ''}`}
                    aria-current={isProfileActive ? 'page' : undefined}
                  >
                    <Settings size={18} aria-hidden="true" />
                    <span>Profile & Settings</span>
                  </Link>
                </div>

                {/* Mobile Sign Out */}
                <div className="mobile-logout-wrapper">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="btn-danger-outline btn-block"
                  >
                    <LogOut size={16} aria-hidden="true" />
                    <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="mobile-auth-links">
                <Link to="/books" className="mobile-nav-item">
                  <BookOpen size={18} aria-hidden="true" />
                  <span>Browse Books</span>
                </Link>
                <Link to="/login" className="btn-secondary btn-block mt-3">
                  Log In
                </Link>
                <Link to="/register" className="btn-primary btn-block">
                  Sign Up
                </Link>
              </div>
            )}
          </nav>
        )}
      </header>
    </>
  );
};

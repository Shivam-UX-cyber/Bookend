import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { Navbar } from './components/Navbar';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyOtpPage } from './pages/VerifyOtpPage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { BooksPage } from './pages/BooksPage';
import { CreateBookPage } from './pages/CreateBookPage';
import { EditBookPage } from './pages/EditBookPage';
import { MyListingsPage } from './pages/MyListingsPage';
import { PurchaseRequestsPage } from './pages/PurchaseRequestsPage';
import { ProfileEditPage } from './pages/ProfileEditPage';
import { PublicProfilePage } from './pages/PublicProfilePage';
import { NotFoundPage } from './pages/NotFoundPage';

import { SmokeBackground } from './components/SmokeBackground';
import { BookOpen } from 'lucide-react';

// Root redirector based on auth state
const RootRedirect = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="auth-loading-screen" role="status" aria-live="polite">
        <div className="loading-card">
          <div className="spinner-orbit">
            <BookOpen size={28} className="pulse-icon" aria-hidden="true" />
          </div>
          <p className="loading-text">Verifying secure student session...</p>
        </div>
      </div>
    );
  }
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Navigate to="/books" replace />;
};

export const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <div className="app-root">
            <SmokeBackground />
            <Navbar />
            <main className="main-content" id="main-content">
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/verify-otp" element={<VerifyOtpPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />

              {/* Book Marketplace Routes */}
              <Route path="/books" element={<BooksPage />} />
              <Route
                path="/books/new"
                element={
                  <ProtectedRoute>
                    <CreateBookPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/books/:id" element={<BooksPage />} />
              <Route
                path="/books/:id/edit"
                element={
                  <ProtectedRoute>
                    <EditBookPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/my-listings"
                element={
                  <ProtectedRoute>
                    <MyListingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/purchase-requests"
                element={
                  <ProtectedRoute>
                    <PurchaseRequestsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile/edit"
                element={
                  <ProtectedRoute>
                    <ProfileEditPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={<Navigate to="/profile/edit" replace />}
              />
              <Route
                path="/settings/profile"
                element={<Navigate to="/profile/edit" replace />}
              />
              <Route path="/students/:userId" element={<PublicProfilePage />} />
              <Route path="/users/:userId" element={<PublicProfilePage />} />

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
        </div>
      </NotificationProvider>
    </AuthProvider>
  </BrowserRouter>
  );
};

export default App;

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { Navbar } from './components/Navbar';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SmokeBackground } from './components/SmokeBackground';
import { BookOpen } from 'lucide-react';

// Route-level code-splitting for performance and faster initial paint
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const VerifyOtpPage = lazy(() => import('./pages/VerifyOtpPage').then(m => ({ default: m.VerifyOtpPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const BooksPage = lazy(() => import('./pages/BooksPage').then(m => ({ default: m.BooksPage })));
const CreateBookPage = lazy(() => import('./pages/CreateBookPage').then(m => ({ default: m.CreateBookPage })));
const EditBookPage = lazy(() => import('./pages/EditBookPage').then(m => ({ default: m.EditBookPage })));
const MyListingsPage = lazy(() => import('./pages/MyListingsPage').then(m => ({ default: m.MyListingsPage })));
const PurchaseRequestsPage = lazy(() => import('./pages/PurchaseRequestsPage').then(m => ({ default: m.PurchaseRequestsPage })));
const ProfileEditPage = lazy(() => import('./pages/ProfileEditPage').then(m => ({ default: m.ProfileEditPage })));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage').then(m => ({ default: m.PublicProfilePage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

const PageLoaderFallback = () => (
  <div className="auth-loading-screen" role="status" aria-live="polite">
    <div className="loading-card">
      <div className="spinner-orbit">
        <BookOpen size={28} className="pulse-icon" aria-hidden="true" />
      </div>
      <p className="loading-text">Loading page content...</p>
    </div>
  </div>
);

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
              <Suspense fallback={<PageLoaderFallback />}>
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
              </Suspense>
            </main>
        </div>
      </NotificationProvider>
    </AuthProvider>
  </BrowserRouter>
  );
};

export default App;

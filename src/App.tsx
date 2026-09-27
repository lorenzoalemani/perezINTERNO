import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthContext';
import ProtectedRoute from './features/auth/ProtectedRoute';
import LoginPage from './features/auth/LoginPage';
import AppLayout from './components/AppLayout';
import DashboardPage from './features/orders/DashboardPage';
import NewOrderPage from './features/orders/NewOrderPage';
import CashPage from './features/cash/CashPage';
import StatsPage from './features/stats/StatsPage';
import ProductsPage from './features/products/ProductsPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/pedidos/nuevo" element={<NewOrderPage />} />
            <Route path="/pendientes" element={<Navigate to="/" replace />} />
            <Route path="/pedidos" element={<Navigate to="/" replace />} />
            <Route
              path="/caja"
              element={
                <ProtectedRoute requireRole="admin">
                  <CashPage />
                </ProtectedRoute>
              }
            />
            <Route path="/estadisticas" element={<StatsPage />} />
            <Route
              path="/productos"
              element={
                <ProtectedRoute requireRole="admin">
                  <ProductsPage />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

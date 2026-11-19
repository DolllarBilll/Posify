import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import CashierMonitor from './pages/CashierMonitor';
import AdminPanel from './pages/AdminPanel';
import KitchenMonitor from './pages/KitchenMonitor';

function App() {
  const [user, setUser] = useState(() => {
    const saved = sessionStorage.getItem('pos_user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleLogin = (userData) => {
    setUser(userData);
    sessionStorage.setItem('pos_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    sessionStorage.removeItem('pos_user');
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route
          path="/cashier"
          element={<CashierMonitor user={user} onLogout={handleLogout} />}
        />
        <Route
          path="/admin"
          element={<AdminPanel user={user} />}
        />
        <Route path="/kitchen" element={<KitchenMonitor />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
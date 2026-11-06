import { Navigate, Route, Routes } from 'react-router';
import AdminPage from './admin/AdminPage.js';
import BeamerPage from './beamer/BeamerPage.js';

export function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="/beamer" element={<BeamerPage />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

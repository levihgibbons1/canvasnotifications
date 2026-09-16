import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api, AuthError, type Me } from './api';
import Shell from './components/Shell';
import Login from './pages/Login';
import Feed from './pages/Feed';
import Upcoming from './pages/Upcoming';
import Courses from './pages/Courses';
import Settings from './pages/Settings';
import Outbox from './pages/Outbox';

interface AppCtx {
  me: Me | null;
  refresh: () => Promise<void>;
  toast: (msg: string, tone?: 'ok' | 'err') => void;
}
const Ctx = createContext<AppCtx>({ me: null, refresh: async () => {}, toast: () => {} });
export const useApp = () => useContext(Ctx);

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: 'ok' | 'err' }[]>([]);
  const location = useLocation();

  const refresh = useCallback(async () => {
    try { setMe(await api.get<Me>('/me')); }
    catch (e) { if (e instanceof AuthError) setMe(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, location.pathname === '/login']);

  const toast = useCallback((msg: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);

  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner /></div>;

  return (
    <Ctx.Provider value={{ me, refresh, toast }}>
      <Routes>
        <Route path="/login" element={me ? <Navigate to="/" replace /> : <Login />} />
        <Route element={me ? <Shell /> : <Navigate to="/login" replace />}>
          <Route path="/" element={<Feed />} />
          <Route path="/upcoming" element={<Upcoming />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/outbox" element={<Outbox />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`rise rounded-lg px-4 py-2.5 text-sm shadow-[var(--shadow-pop)] border ${t.tone === 'err' ? 'bg-signal text-white border-signal' : 'bg-ink text-paper border-ink'}`}>{t.msg}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`spin inline-block h-4 w-4 rounded-full border-2 border-line border-t-signal ${className}`} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <div className="display text-2xl text-ink-2">{title}</div>
      {children && <div className="mt-2 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

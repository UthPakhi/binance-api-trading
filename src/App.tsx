import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { Calculator } from './components/Calculator';
import { Button } from './components/Button';
import { auth, loginWithGoogle, logout } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Calculator as CalcIcon, History as HistIcon, LogOut, TrendingUp } from 'lucide-react';
import { cn } from './lib/utils';
import { TradeProvider } from './lib/TradeContext';
import { Toaster, toast } from 'react-hot-toast';
import { PriceAlertManager } from './components/PriceAlertManager';

// Dynamic code-splitting: History tab & heavy charts only load when accessed
const History = lazy(() => import('./components/History').then(m => ({ default: m.History })));

function HistorySkeleton() {
  return (
    <div className="space-y-4 animate-pulse p-1 sm:p-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-16 bg-neutral-900/60 rounded-xl border border-neutral-800/60" />
        ))}
      </div>
      <div className="h-10 bg-neutral-900/50 rounded-xl border border-neutral-800/50" />
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-neutral-900/40 rounded-xl border border-neutral-800/40" />
        ))}
      </div>
    </div>
  );
}

// Session caching for instantaneous mobile launch (0ms delay)
const getCachedUser = () => {
  try {
    const raw = localStorage.getItem('trade_sizer_cached_user');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.uid) return parsed;
    }
  } catch {}
  return null;
};

export default function App() {
  const cachedUser = useMemo(() => getCachedUser(), []);
  const [user, setUser] = useState<User | any>(() => auth.currentUser || cachedUser);
  // Second tab (Trades/History) is now FIRST and DEFAULT
  const [activeTab, setActiveTab] = useState<'hist' | 'calc'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'calc') return 'calc';
      if (params.get('tab') === 'hist') return 'hist';
    }
    return 'hist'; // Default to Trades/History
  });
  // If we already have a cached session, do NOT hold the user on a loading screen
  const [loading, setLoading] = useState(() => !auth.currentUser && !cachedUser);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Safety timeout: Never keep the user waiting on a blank loading screen on slow mobile networks
    const timeout = setTimeout(() => {
      if (isMounted) {
        setLoading(false);
      }
    }, 1500);

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      clearTimeout(timeout);
      if (isMounted) {
        if (currentUser) {
          try {
            localStorage.removeItem('trade_sizer_explicit_logout');
            localStorage.setItem('trade_sizer_cached_user', JSON.stringify({
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL
            }));
          } catch {}
          setUser(currentUser);
          setLoading(false);
          setIsSigningIn(false);
        } else {
          // Check if user explicitly clicked Sign Out
          const isExplicitLogout = typeof window !== 'undefined' && localStorage.getItem('trade_sizer_explicit_logout') === 'true';
          const cached = getCachedUser();
          
          if (isExplicitLogout || !cached) {
            setUser(null);
            try {
              localStorage.removeItem('trade_sizer_cached_user');
            } catch {}
          } else {
            // Transient background token refresh or offline: PRESERVE SESSION FOREVER!
            // Never log the user out automatically
            console.info("Preserving active session across network transitions");
            setUser(cached);
          }
          setLoading(false);
          setIsSigningIn(false);
        }
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      try {
        localStorage.removeItem('trade_sizer_explicit_logout');
      } catch {}
      await loginWithGoogle();
    } catch (err: any) {
      if (err?.code !== 'auth/cancelled-popup-request' && err?.code !== 'auth/popup-closed-by-user') {
        toast.error('Failed to sign in. Please try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  if (loading && !user) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-neutral-400">
        <div className="relative flex items-center justify-center mb-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center animate-pulse">
            <TrendingUp className="w-6 h-6 text-sky-400" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
          <span>Starting Trade Sizer...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
        <Toaster 
          position="top-center" 
          gutter={8}
          containerStyle={{
            top: 'max(calc(env(safe-area-inset-top, 0px) + 54px), 76px)',
            zIndex: 999999,
            pointerEvents: 'none'
          }}
          toastOptions={{ 
            style: { 
              background: '#18181b', 
              color: '#f8fafc', 
              border: '1px solid #3f3f46',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.7)',
              fontSize: '13px',
              borderRadius: '12px',
              padding: '10px 16px',
              maxWidth: 'min(420px, 92vw)',
              pointerEvents: 'auto'
            } 
          }} 
        />
        <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-6">
          <TrendingUp className="w-8 h-8 text-sky-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2 text-center">Crypto Position Sizer</h1>
        <p className="text-neutral-400 text-center mb-8 max-w-xs">
          Calculate your exact position sizes and sync your trade history in the cloud.
        </p>
        <Button 
          onClick={handleGoogleSignIn} 
          disabled={isSigningIn}
          size="lg" 
          className="w-full max-w-xs transition-opacity bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-950/50"
        >
          {isSigningIn ? 'Connecting...' : 'Sign In with Google'}
        </Button>
      </div>
    );
  }

  return (
    <TradeProvider>
      <Toaster 
        position="top-center" 
        gutter={8}
        containerStyle={{
          top: 'max(calc(env(safe-area-inset-top, 0px) + 54px), 76px)',
          zIndex: 999999,
          pointerEvents: 'none'
        }}
        toastOptions={{ 
          style: { 
            background: '#18181b', 
            color: '#f8fafc', 
            border: '1px solid #3f3f46',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.7)',
            fontSize: '13px',
            borderRadius: '12px',
            padding: '10px 16px',
            maxWidth: 'min(420px, 92vw)',
            pointerEvents: 'auto'
          } 
        }} 
      />
      <div className="min-h-screen bg-black text-neutral-100 flex flex-col font-sans">
        {/* Header - Compact 3-zone Top Bar with iPhone Notch/Status Bar Safe-Area Integration */}
        <header className="px-3 sm:px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-2.5 bg-neutral-950/95 backdrop-blur-md border-b border-neutral-900 sticky top-0 z-20">
          <div className="w-full max-w-4xl mx-auto flex items-center justify-between gap-3">
            {/* Zone 1: Wordmark */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-sky-400" />
              </div>
              <span className="text-sm sm:text-base font-bold tracking-tight text-white font-mono">
                Trade Sizer
              </span>
            </div>

            {/* Zone 2: Navigation Segmented Tabs (Desktop/Tablet) - Trades FIRST, then Calculator */}
            <nav className="hidden sm:flex items-center p-1 bg-neutral-900 rounded-lg border border-neutral-800">
              <button
                type="button"
                onClick={() => setActiveTab('hist')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap",
                  activeTab === 'hist' 
                    ? "bg-neutral-800 text-sky-400 shadow-sm font-semibold" 
                    : "text-neutral-400 hover:text-neutral-200"
                )}
              >
                <HistIcon className="w-3.5 h-3.5" />
                <span>Trades</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('calc')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap",
                  activeTab === 'calc' 
                    ? "bg-neutral-800 text-sky-400 shadow-sm font-semibold" 
                    : "text-neutral-400 hover:text-neutral-200"
                )}
              >
                <CalcIcon className="w-3.5 h-3.5" />
                <span>Calculator</span>
              </button>
            </nav>

            {/* Zone 3: Account & Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <PriceAlertManager />
              
              <div className="w-7 h-7 rounded-full bg-neutral-800 border border-neutral-700/80 overflow-hidden shrink-0">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs font-bold text-neutral-300">
                    {user.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={logout} 
                className="h-7 w-7 text-neutral-400 hover:text-neutral-200" 
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content Area - Trades is default */}
        <main className="flex-1 overflow-y-auto px-2 py-3 sm:px-4 sm:py-4 w-full max-w-4xl mx-auto pb-24 sm:pb-8">
          {activeTab === 'hist' ? (
            <Suspense fallback={<HistorySkeleton />}>
              <History />
            </Suspense>
          ) : (
            <Calculator />
          )}
        </main>

        {/* Bottom Navigation for Mobile - 2 Clean Tabs (Trades & Calculator), Extra Clickable */}
        <nav className="sm:hidden fixed bottom-0 left-0 w-full bg-neutral-950/95 backdrop-blur-xl border-t border-neutral-800/90 pb-safe z-30 shadow-2xl">
          <div className="grid grid-cols-2 gap-2 px-4 py-2.5 max-w-md mx-auto">
            {/* 1st Tab: Trades (Default) */}
            <button 
              onClick={() => setActiveTab('hist')}
              className={cn(
                "h-13 flex flex-col items-center justify-center rounded-xl transition-all active:scale-95",
                activeTab === 'hist' 
                  ? "bg-sky-500/15 text-sky-400 border border-sky-500/30 shadow-sm shadow-sky-950/50" 
                  : "text-neutral-400 hover:text-neutral-200 border border-transparent"
              )}
            >
              <HistIcon className="w-5 h-5 mb-0.5" />
              <span className="text-xs font-semibold tracking-tight">Trades</span>
            </button>

            {/* 2nd Tab: Calculator */}
            <button 
              onClick={() => setActiveTab('calc')}
              className={cn(
                "h-13 flex flex-col items-center justify-center rounded-xl transition-all active:scale-95",
                activeTab === 'calc' 
                  ? "bg-sky-500/15 text-sky-400 border border-sky-500/30 shadow-sm shadow-sky-950/50" 
                  : "text-neutral-400 hover:text-neutral-200 border border-transparent"
              )}
            >
              <CalcIcon className="w-5 h-5 mb-0.5" />
              <span className="text-xs font-semibold tracking-tight">Calculator</span>
            </button>
          </div>
        </nav>
      </div>
    </TradeProvider>
  );
}

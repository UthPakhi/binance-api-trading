import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { Calculator } from './components/Calculator';
import { Button } from './components/Button';
import { auth, loginWithGoogle, logout, getEffectiveUser, DEFAULT_OWNER_USER } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Calculator as CalcIcon, History as HistIcon, LogOut, TrendingUp } from 'lucide-react';
import { cn } from './lib/utils';
import { TradeProvider } from './lib/TradeContext';
import { Toaster, toast } from 'react-hot-toast';
import { PriceAlertManager } from './components/PriceAlertManager';
import { ErrorBoundary } from './components/ErrorBoundary';
import { History } from './components/History';
import { triggerHaptic } from './lib/haptics';

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

// Permanent session caching for instantaneous launch (0ms delay, never asks to login again unless explicitly signed out)
const getCachedUser = () => {
  return getEffectiveUser();
};

export default function App() {
  const cachedUser = useMemo(() => getCachedUser(), []);
  const [user, setUser] = useState<User | any>(() => {
    const isExplicitLogout = typeof window !== 'undefined' && localStorage.getItem('trade_sizer_explicit_logout') === 'true';
    if (isExplicitLogout) return null;
    return auth.currentUser || cachedUser || DEFAULT_OWNER_USER;
  });
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
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [standaloneHeight, setStandaloneHeight] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const isStandalone = (window.navigator as any).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
    if (isStandalone && window.innerWidth < window.innerHeight && window.screen?.height >= window.innerHeight) {
      return window.screen.height;
    }
    return null;
  });
  const mainRef = useRef<HTMLElement | null>(null);

  // iOS Safari / Standalone PWA keyboard & viewport lock:
  // Prevents the bottom nav bar from floating up into the middle of the screen or leaving a black gap at the bottom
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let baselineHeight = Math.max(window.innerHeight, window.screen?.height || 0);

    const updateStandaloneHeight = () => {
      const isStandalone = (window.navigator as any).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
      if (isStandalone && window.innerWidth < window.innerHeight && window.screen?.height >= window.innerHeight) {
        setStandaloneHeight(window.screen.height);
      } else {
        setStandaloneHeight(null);
      }
    };
    updateStandaloneHeight();

    const resetWindowScroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
      if (document.documentElement.scrollTop !== 0) {
        document.documentElement.scrollTop = 0;
      }
      if (document.body.scrollTop !== 0) {
        document.body.scrollTop = 0;
      }
    };

    const handleViewportChange = () => {
      resetWindowScroll();
      const vv = window.visualViewport;
      if (!vv) return;
      if (vv.height > baselineHeight) {
        baselineHeight = vv.height;
      }
      const isMobile = window.innerWidth < 640;
      const activeTag = document.activeElement?.tagName;
      const isInputFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
      const heightShrunk = vv.height < baselineHeight * 0.78;
      setIsKeyboardOpen(Boolean(isMobile && (heightShrunk || (isInputFocused && vv.height < baselineHeight * 0.88))));
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        const activeTag = document.activeElement?.tagName;
        const isInputFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
        if (!isInputFocused) {
          setIsKeyboardOpen(false);
          resetWindowScroll();
        }
      }, 80);
    };

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', handleViewportChange);
      vv.addEventListener('scroll', resetWindowScroll);
    }
    window.addEventListener('resize', updateStandaloneHeight);
    window.addEventListener('orientationchange', updateStandaloneHeight);
    window.addEventListener('focusout', handleFocusOut);
    window.addEventListener('scroll', resetWindowScroll, { passive: true });

    return () => {
      if (vv) {
        vv.removeEventListener('resize', handleViewportChange);
        vv.removeEventListener('scroll', resetWindowScroll);
      }
      window.removeEventListener('resize', updateStandaloneHeight);
      window.removeEventListener('orientationchange', updateStandaloneHeight);
      window.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener('scroll', resetWindowScroll);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Safety timeout: Never keep the user waiting on a blank loading screen on slow mobile networks
    const timeout = setTimeout(() => {
      if (isMounted) {
        setLoading(false);
      }
    }, 800);

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
          
          if (isExplicitLogout) {
            setUser(null);
            try {
              localStorage.removeItem('trade_sizer_cached_user');
            } catch {}
          } else {
            // Transient background token refresh, iOS iframe storage partition, or offline: PRESERVE SESSION FOREVER!
            setUser(cached || DEFAULT_OWNER_USER);
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
    triggerHaptic('medium');
    setIsSigningIn(true);
    try {
      try {
        localStorage.removeItem('trade_sizer_explicit_logout');
      } catch {}
      const signedInUser = await loginWithGoogle();
      if (signedInUser) {
        setUser(signedInUser);
      }
    } catch (err: any) {
      setUser(DEFAULT_OWNER_USER);
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
      <div
        style={!isKeyboardOpen && standaloneHeight ? { height: `${standaloneHeight}px` } : undefined}
        className="fixed inset-0 w-full overflow-hidden bg-black text-neutral-100 flex flex-col font-sans tabular-nums"
      >
        {/* Header - Compact 3-zone Top Bar with iPhone Notch/Status Bar Safe-Area Integration */}
        <header className="shrink-0 px-3 sm:px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-2.5 bg-neutral-950/95 backdrop-blur-md border-b border-neutral-900 z-20">
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
                onClick={() => {
                  triggerHaptic('selection');
                  setActiveTab('hist');
                  mainRef.current?.scrollTo({ top: 0 });
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all active:scale-95 whitespace-nowrap",
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
                onClick={() => {
                  triggerHaptic('selection');
                  setActiveTab('calc');
                  mainRef.current?.scrollTo({ top: 0 });
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all active:scale-95 whitespace-nowrap",
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

        {/* Main Content Area - Dedicated scrollable container so header & bottom nav never detach on iOS */}
        <main
          ref={mainRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-2 py-3 sm:px-4 sm:py-4 w-full max-w-4xl mx-auto pb-6 sm:pb-8"
        >
          <ErrorBoundary fallbackTitle="Unable to load view">
            {activeTab === 'hist' ? (
              <History />
            ) : (
              <Calculator />
            )}
          </ErrorBoundary>
        </main>

        {/* Bottom Navigation for Mobile - Flex child pinned flush to bottom of screen */}
        <nav
          className={cn(
            "sm:hidden relative shrink-0 w-full bg-neutral-950/95 backdrop-blur-xl border-t border-neutral-800/90 pt-1.5 pb-safe z-30 shadow-2xl after:content-[''] after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-neutral-950/95",
            isKeyboardOpen && "hidden"
          )}
        >
          <div className="grid grid-cols-2 gap-2 px-4 max-w-md mx-auto">
            {/* 1st Tab: Trades (Default) */}
            <button 
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                setActiveTab('hist');
                mainRef.current?.scrollTo({ top: 0 });
              }}
              className={cn(
                "h-12 flex flex-col items-center justify-center rounded-xl transition-all active:scale-95",
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
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                setActiveTab('calc');
                mainRef.current?.scrollTo({ top: 0 });
              }}
              className={cn(
                "h-12 flex flex-col items-center justify-center rounded-xl transition-all active:scale-95",
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


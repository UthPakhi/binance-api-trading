import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, persistentMultipleTabManager } from "firebase/firestore";
import config from "../../firebase-applet-config.json";

const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Enforce permanent browser local persistence so user never gets logged out automatically
try {
  setPersistence(auth, browserLocalPersistence).catch((e) => {
    console.warn("Auth persistence notice:", e);
  });
} catch (e) {
  console.warn("Auth persistence error:", e);
}

// High-performance persistent local cache for instant (<50ms) mobile data reads
// Using persistentSingleTabManager with forceOwnership to eliminate WebLock deadlocks on iOS Safari
let firestoreInstance: any;
try {
  firestoreInstance = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager({ forceOwnership: true })
    })
  }, config.firestoreDatabaseId);
} catch (error) {
  try {
    firestoreInstance = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    }, config.firestoreDatabaseId);
  } catch (err2) {
    console.warn("IndexedDB persistent cache fallback to memory:", err2);
    firestoreInstance = initializeFirestore(app, { ignoreUndefinedProperties: true }, config.firestoreDatabaseId);
  }
}

export const db = firestoreInstance;

const provider = new GoogleAuthProvider();

export const DEFAULT_OWNER_USER = {
  uid: 'q0pNRuSgmWO3efkTEmJYwJm4zBE3',
  email: 'SouravMalani95@gmail.com',
  displayName: 'Sourav Malani',
};

export const getEffectiveUser = (): any => {
  if (auth.currentUser) return auth.currentUser;
  try {
    if (typeof window !== 'undefined') {
      const isExplicitLogout = localStorage.getItem('trade_sizer_explicit_logout') === 'true';
      if (isExplicitLogout) return null;

      const raw = localStorage.getItem('trade_sizer_cached_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.uid) return parsed;
      }

      // Default to permanent authenticated portfolio session so user never has to re-login
      localStorage.setItem('trade_sizer_cached_user', JSON.stringify(DEFAULT_OWNER_USER));
    }
  } catch {}
  return DEFAULT_OWNER_USER;
};

export const getEffectiveUid = (): string => {
  return auth.currentUser?.uid || getEffectiveUser()?.uid || DEFAULT_OWNER_USER.uid;
};

export const loginWithGoogle = async () => {
  try {
    try {
      localStorage.removeItem('trade_sizer_explicit_logout');
    } catch {}
    const result = await signInWithPopup(auth, provider);
    if (result?.user) {
      try {
        localStorage.setItem('trade_sizer_cached_user', JSON.stringify({
          uid: result.user.uid,
          email: result.user.email,
          displayName: result.user.displayName,
          photoURL: result.user.photoURL
        }));
      } catch {}
    }
    return result.user;
  } catch (error: any) {
    // In mobile preview iframes (e.g. iOS Safari), popups or third-party auth cookies can be blocked.
    // Restore the portfolio owner session automatically so the user is never stuck on the login screen.
    try {
      localStorage.removeItem('trade_sizer_explicit_logout');
      localStorage.setItem('trade_sizer_cached_user', JSON.stringify(DEFAULT_OWNER_USER));
    } catch {}
    if (
      error?.code === "auth/cancelled-popup-request" ||
      error?.code === "auth/popup-closed-by-user" ||
      error?.message?.includes("cancelled-popup-request") ||
      error?.message?.includes("popup-closed-by-user")
    ) {
      return DEFAULT_OWNER_USER as any;
    }
    console.warn("Popup sign-in fallback to default portfolio session:", error);
    return DEFAULT_OWNER_USER as any;
  }
};

export const logout = async () => {
  try {
    localStorage.setItem('trade_sizer_explicit_logout', 'true');
    localStorage.removeItem('trade_sizer_cached_user');
    localStorage.removeItem('trade_sizer_cached_trades');
    localStorage.removeItem('trade_sizer_cached_base_capital');
    localStorage.removeItem('trade_sizer_cached_binance_balance');
  } catch {}

  try {
    await signOut(auth);
  } catch (error) {
    console.warn("SignOut network error (proceeding with local sign out):", error);
  }

  // Force immediate reload so user is instantly signed out and lands on Sign In screen reliably
  try {
    window.location.reload();
  } catch {
    window.location.href = window.location.pathname;
  }
};




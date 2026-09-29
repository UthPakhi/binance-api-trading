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
    // Normal user actions such as closing the popup, clicking outside, or re-clicking
    // do not represent broken system states and should be gracefully handled
    if (
      error?.code === "auth/cancelled-popup-request" ||
      error?.code === "auth/popup-closed-by-user" ||
      error?.message?.includes("cancelled-popup-request") ||
      error?.message?.includes("popup-closed-by-user")
    ) {
      console.info("Sign-in popup was cancelled or superseded by another request.");
      return null;
    }
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

export const logout = async () => {
  try {
    try {
      localStorage.setItem('trade_sizer_explicit_logout', 'true');
      localStorage.removeItem('trade_sizer_cached_user');
      localStorage.removeItem('trade_sizer_cached_trades');
      localStorage.removeItem('trade_sizer_cached_base_capital');
      localStorage.removeItem('trade_sizer_cached_binance_balance');
    } catch {}
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
  }
};



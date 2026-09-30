import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from "firebase/auth";
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
    await signInWithRedirect(auth, provider);
  } catch (error: any) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

// Handle redirect result on load
getRedirectResult(auth).then((result) => {
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
}).catch((err) => {
  console.warn("Redirect result error:", err);
});

export const signInWithEmail = async (email: string, pass: string) => {
  try {
    localStorage.removeItem('trade_sizer_explicit_logout');
    const res = await signInWithEmailAndPassword(auth, email, pass);
    return res.user;
  } catch (err) {
    console.error("Email sign-in error:", err);
    throw err;
  }
};

export const signUpWithEmail = async (email: string, pass: string) => {
  try {
    localStorage.removeItem('trade_sizer_explicit_logout');
    const res = await createUserWithEmailAndPassword(auth, email, pass);
    return res.user;
  } catch (err) {
    console.error("Email sign-up error:", err);
    throw err;
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



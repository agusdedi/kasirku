// =============================================
//   FIREBASE CONFIG — firebase-config.js
//   Config dibaca dari window.__env__
//   yang di-inject oleh env.js (Vercel)
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            window.__env__.FIREBASE_API_KEY,
  authDomain:        window.__env__.FIREBASE_AUTH_DOMAIN,
  projectId:         window.__env__.FIREBASE_PROJECT_ID,
  storageBucket:     window.__env__.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: window.__env__.FIREBASE_MESSAGING_SENDER_ID,
  appId:             window.__env__.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);
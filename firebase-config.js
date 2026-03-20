// =============================================
//   FIREBASE CONFIG — firebase-config.js
//   Ganti nilai di bawah dengan config milik Anda
//   dari Firebase Console > Project Settings > Web App
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDxQJmCa_1dh8DChbxp2I9dowacJByssng",
  authDomain:        "kasirku-fd0e8.firebaseapp.com",
  projectId:         "kasirku-fd0e8",
  storageBucket:     "kasirku-fd0e8.firebasestorage.app",
  messagingSenderId: "344113719745",
  appId:             "1:344113719745:web:faafe99c15ffa041302740"
};

const app = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);
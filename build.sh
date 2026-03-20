#!/bin/bash
# =============================================
#   build.sh — Dijalankan Vercel saat deploy
#   Men-generate env.js dari Environment Variables
# =============================================

cat > env.js << ENVEOF
window.__env__ = {
  FIREBASE_API_KEY:             "$FIREBASE_API_KEY",
  FIREBASE_AUTH_DOMAIN:         "$FIREBASE_AUTH_DOMAIN",
  FIREBASE_PROJECT_ID:          "$FIREBASE_PROJECT_ID",
  FIREBASE_STORAGE_BUCKET:      "$FIREBASE_STORAGE_BUCKET",
  FIREBASE_MESSAGING_SENDER_ID: "$FIREBASE_MESSAGING_SENDER_ID",
  FIREBASE_APP_ID:              "$FIREBASE_APP_ID"
};
ENVEOF

echo "✅ env.js berhasil di-generate"
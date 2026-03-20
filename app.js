/* =============================================
   SISTEM KASIR — app.js (Firebase Edition)
   ============================================= */

import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, deleteDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp,
  runTransaction, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── STATE ─────────────────────────────────────
let items        = [];
let cart         = [];
let transactions = [];
let kasirAktif   = null;
let currentUser  = null;
let isOwner      = false;
let unsubItems   = null;
let unsubTx      = null;

// ── INIT ──────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTodayDate();
  const today = localDateStr();
  document.getElementById('filterDate').value = today;

  // Set default owner filter date
  const ownerDateEl = document.getElementById('ownerFilterDate');
  if (ownerDateEl) ownerDateEl.value = localDateStr();

  // Pastikan env.js sudah ter-load
  if (!window.__env__ || window.__env__.FIREBASE_API_KEY.startsWith('GANTI')) {
    document.getElementById('authModal').classList.remove('active');
    document.getElementById('kasirModal').classList.remove('active');
    document.getElementById('envError').style.display = 'flex';
    return;
  }

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      isOwner = user.email.startsWith('owner');
      onLoginSuccess();
    } else {
      currentUser = null;
      showAuthModal();
    }
  });
});

function setTodayDate() {
  document.getElementById('currentDate').textContent =
    new Date().toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

// ── AUTH ──────────────────────────────────────
function showAuthModal() {
  document.getElementById('authModal').classList.add('active');
  document.getElementById('kasirModal').classList.remove('active');
  stopListeners();
}

window.loginAuth = async function() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl    = document.getElementById('authError');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Email dan password wajib diisi.'; return; }

  const btn = document.getElementById('btnLoginAuth');
  btn.textContent = 'Masuk...';
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    // Tampilkan kode error spesifik untuk debugging
    const errorMap = {
      'auth/invalid-email':        '❌ Format email tidak valid.',
      'auth/user-not-found':       '❌ Email tidak terdaftar.',
      'auth/wrong-password':       '❌ Password salah.',
      'auth/invalid-credential':   '❌ Email atau password salah.',
      'auth/too-many-requests':    '❌ Terlalu banyak percobaan. Tunggu beberapa menit.',
      'auth/user-disabled':        '❌ Akun ini dinonaktifkan.',
      'auth/network-request-failed': '❌ Tidak ada koneksi internet.',
      'auth/api-key-not-valid':    '❌ API Key Firebase tidak valid. Cek env vars di Vercel.',
      'auth/configuration-not-found': '❌ Firebase Auth belum diaktifkan atau Auth Domain salah.',
    };
    const msg = errorMap[e.code] || `❌ Error: ${e.code} — ${e.message}`;
    errEl.textContent = msg;
    errEl.style.color = 'var(--red)';
    console.error('Firebase Auth Error:', e.code, e.message);
    btn.textContent = 'Masuk →';
    btn.disabled = false;
  }
}

window.logoutAuth = async function() {
  if (!confirm('Yakin ingin keluar?')) return;
  kasirAktif = null;
  localStorage.removeItem('kasir_aktif');
  stopListeners();
  await signOut(auth);
}

function onLoginSuccess() {
  document.getElementById('authModal').classList.remove('active');

  if (isOwner) {
    // Owner: tidak perlu input nama kasir, langsung masuk
    document.getElementById('ownerTabBtn').style.display = 'flex';
    document.getElementById('authUserDisplay').textContent = '👑 ' + currentUser.email;
    document.getElementById('kasirModal').classList.remove('active');

    // Set kasirAktif otomatis dari email owner
    kasirAktif = {
      name:      'Owner',
      shift:     '—',
      loginTime: new Date().toISOString(),
    };
    updateKasirBar();

  } else {
    // Kasir: wajib isi nama & shift
    document.getElementById('ownerTabBtn').style.display = 'none';
    document.getElementById('authUserDisplay').textContent = '🔑 ' + currentUser.email;

    const k = localStorage.getItem('kasir_aktif');
    if (k) {
      kasirAktif = JSON.parse(k);
      document.getElementById('kasirModal').classList.remove('active');
      updateKasirBar();
    } else {
      document.getElementById('kasirModal').classList.add('active');
    }
  }

  document.getElementById('authUserBar').style.display = 'flex';
  startListeners();
  if (window.innerWidth <= 768) switchTab(isOwner ? 'owner' : 'barang');
}

function stopListeners() {
  if (unsubItems) { unsubItems(); unsubItems = null; }
  if (unsubTx)    { unsubTx();    unsubTx    = null; }
}

// ── FIRESTORE REALTIME LISTENERS ──────────────
function startListeners() {
  unsubItems = onSnapshot(
    query(collection(db, 'items'), orderBy('createdAt', 'asc')),
    (snap) => {
      items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderItems();
    },
    (err) => showToast('Gagal sync barang: ' + err.message, 'error')
  );

  unsubTx = onSnapshot(
    query(collection(db, 'transactions'), orderBy('createdAt', 'desc')),
    (snap) => {
      transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderHistory();
      updateStats();
      if (isOwner) renderOwnerDashboard();
    },
    (err) => showToast('Gagal sync transaksi: ' + err.message, 'error')
  );
}

// ── KASIR SESSION ─────────────────────────────
window.loginKasir = function() {
  const name  = document.getElementById('kasirNameInput').value.trim();
  const shift = document.querySelector('input[name="shift"]:checked').value;
  if (!name) {
    document.getElementById('kasirNameInput').style.borderColor = 'var(--red)';
    showToast('Nama kasir wajib diisi!', 'error');
    return;
  }
  kasirAktif = { name, shift, loginTime: new Date().toISOString() };
  localStorage.setItem('kasir_aktif', JSON.stringify(kasirAktif));
  updateKasirBar();
  document.getElementById('kasirModal').classList.remove('active');
  document.getElementById('kasirNameInput').style.borderColor = '';
  showToast(`Selamat bertugas, ${name}! 👋`);
}

window.gantiKasir = function() {
  if (isOwner) return; // owner tidak perlu ganti kasir
  if (!confirm(`Ganti kasir dari "${kasirAktif?.name}"?`)) return;
  kasirAktif = null;
  localStorage.removeItem('kasir_aktif');
  document.getElementById('kasirNameInput').value = '';
  document.querySelector('input[name="shift"][value="Pagi (06:00–14:00)"]').checked = true;
  document.getElementById('kasirModal').classList.add('active');
  setTimeout(() => document.getElementById('kasirNameInput').focus(), 100);
}

function updateKasirBar() {
  if (!kasirAktif) return;
  document.getElementById('kasirAvatar').textContent       = kasirAktif.name.charAt(0).toUpperCase();
  document.getElementById('kasirNameDisplay').textContent  = kasirAktif.name;
  document.getElementById('kasirShiftDisplay').textContent = kasirAktif.shift;

  // Sembunyikan tombol Ganti untuk owner
  const gantiBtn = document.querySelector('.btn-ganti-kasir[onclick="gantiKasir()"]');
  if (gantiBtn) gantiBtn.style.display = isOwner ? 'none' : 'block';
}

// ── UTILS ─────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

// Konversi Date ke string YYYY-MM-DD berdasarkan LOCAL timezone
// (bukan UTC seperti toISOString()) agar filter tanggal tidak geser
function localDateStr(date = new Date()) {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`; // contoh: 2026-03-21
}

// Generate kode transaksi: TRX-YYMMDD-XX-0001
// Counter disimpan di Firestore doc: counters/daily/{YYMMDD}
async function generateTrxId(kasirName) {
  const now    = new Date();
  const yy     = String(now.getFullYear()).slice(2);
  const mm     = String(now.getMonth() + 1).padStart(2, '0');
  const dd     = String(now.getDate()).padStart(2, '0');
  const dateStr = yy + mm + dd; // contoh: 260321

  // Inisial kasir: ambil 2 huruf pertama tiap kata, max 2 kata, uppercase
  // contoh: "Agus Dedi" → "AD", "Budi" → "BU"
  const initials = (kasirName || 'XX')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w.charAt(0).toUpperCase())
    .join('');

  // Atomic increment counter harian di Firestore
  const counterRef = doc(db, 'counters', dateStr);
  let seq = 1;
  try {
    await runTransaction(db, async (t) => {
      const snap = await t.get(counterRef);
      seq = snap.exists() ? (snap.data().count + 1) : 1;
      t.set(counterRef, { count: seq });
    });
  } catch (e) {
    // Fallback ke timestamp jika transaksi gagal
    seq = Date.now() % 10000;
  }

  const seqStr = String(seq).padStart(4, '0'); // 0001 – 9999
  return `TRX-${dateStr}-${initials}-${seqStr}`;
}
function formatRp(n) { return 'Rp ' + Math.round(n).toLocaleString('id-ID'); }
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.className = 'toast', 2800);
}

// ── MANAJEMEN BARANG ──────────────────────────
window.addItem = async function() {
  const name     = document.getElementById('itemName').value.trim();
  const price    = parseFloat(document.getElementById('itemPrice').value);
  const stock    = parseInt(document.getElementById('itemStock').value) || 0;
  const category = document.getElementById('itemCategory').value.trim() || 'Umum';
  if (!name)             return showToast('Nama barang wajib diisi!', 'error');
  if (!price || price<=0) return showToast('Harga harus lebih dari 0!', 'error');
  try {
    await addDoc(collection(db, 'items'), { name, price, stock, category, createdAt: serverTimestamp() });
    cancelEdit();
    showToast(`"${name}" berhasil ditambahkan!`);
  } catch(e) { showToast('Gagal tambah barang: ' + e.message, 'error'); }
}

window.deleteItem = async function(id) {
  if (!confirm('Hapus barang ini?')) return;
  try {
    await deleteDoc(doc(db, 'items', id));
    cart = cart.filter(c => c.itemId !== id);
    renderCart(); recalculate();
    showToast('Barang dihapus.');
  } catch(e) { showToast('Gagal hapus: ' + e.message, 'error'); }
}

window.editItem = function(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  document.getElementById('itemName').value     = item.name;
  document.getElementById('itemPrice').value    = item.price;
  document.getElementById('itemStock').value    = item.stock;
  document.getElementById('itemCategory').value = item.category;
  const btn = document.querySelector('.btn-primary[onclick="addItem()"]');
  btn.textContent = '💾 Simpan Perubahan';
  btn.setAttribute('onclick', `saveEditItem('${id}')`);
  btn.style.background = 'var(--accent2)';
  document.getElementById('btnCancelEdit').style.display = 'block';
  document.querySelector('.sidebar').scrollTo({ top:0, behavior:'smooth' });
  showToast(`Edit mode: "${item.name}"`);
}

window.saveEditItem = async function(id) {
  const name     = document.getElementById('itemName').value.trim();
  const price    = parseFloat(document.getElementById('itemPrice').value);
  const stock    = parseInt(document.getElementById('itemStock').value) || 0;
  const category = document.getElementById('itemCategory').value.trim() || 'Umum';
  if (!name)             return showToast('Nama barang wajib diisi!', 'error');
  if (!price || price<=0) return showToast('Harga harus lebih dari 0!', 'error');
  try {
    await updateDoc(doc(db, 'items', id), { name, price, stock, category });
    cart.forEach(c => { if(c.itemId===id) { c.name=name; c.price=price; } });
    renderCart(); recalculate(); cancelEdit();
    showToast(`"${name}" berhasil diperbarui!`);
  } catch(e) { showToast('Gagal update: ' + e.message, 'error'); }
}

window.cancelEdit = function() {
  ['itemName','itemPrice','itemStock','itemCategory'].forEach(id => { document.getElementById(id).value=''; });
  const btn = document.querySelector('.btn-primary');
  btn.textContent = '+ Tambah Barang';
  btn.setAttribute('onclick', 'addItem()');
  btn.style.background = '';
  document.getElementById('btnCancelEdit').style.display = 'none';
}

window.renderItems = function renderItems() {
  const q    = document.getElementById('searchItem').value.toLowerCase();
  const list = document.getElementById('itemList');
  if (items.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:24px 12px;color:var(--muted)"><div style="font-size:32px;margin-bottom:8px">📦</div><p style="font-size:12px;line-height:1.6">Belum ada barang.<br/>Tambahkan di form atas.</p></div>`;
    return;
  }
  const filtered = items.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  if (filtered.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:12px;text-align:center;padding:16px;">Barang tidak ditemukan</p>';
    return;
  }
  list.innerHTML = filtered.map(item => `
    <div class="item-card" onclick="addToCart('${item.id}')">
      <div class="item-card-info">
        <div class="item-card-name">${item.name}</div>
        <div class="item-card-category">${item.category}</div>
        <div class="item-card-price">${formatRp(item.price)}</div>
      </div>
      <div class="item-card-right" onclick="event.stopPropagation()">
        <div class="item-card-stock ${item.stock<=5?'low':''}">Stok: ${item.stock}</div>
        <div class="item-actions">
          <button class="btn-icon btn-edit"   onclick="editItem('${item.id}')"   title="Edit">✏️</button>
          <button class="btn-icon btn-delete" onclick="deleteItem('${item.id}')" title="Hapus">🗑️</button>
        </div>
      </div>
    </div>`).join('');
}

// ── KERANJANG ─────────────────────────────────
window.addToCart = function(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  if (item.stock <= 0) return showToast('Stok habis!', 'error');
  const existing = cart.find(c => c.itemId === itemId);
  if (existing) {
    if (existing.qty >= item.stock) return showToast('Stok tidak cukup!', 'error');
    existing.qty++;
  } else {
    cart.push({ itemId, name: item.name, price: item.price, qty: 1 });
  }
  renderCart(); recalculate();
  showToast(`${item.name} ditambahkan`);
}

window.changeQty = function(itemId, delta) {
  const entry = cart.find(c => c.itemId === itemId);
  if (!entry) return;
  const item = items.find(i => i.id === itemId);
  entry.qty += delta;
  if (entry.qty <= 0) cart = cart.filter(c => c.itemId !== itemId);
  else if (item && entry.qty > item.stock) { entry.qty = item.stock; showToast('Stok tidak cukup!','error'); }
  renderCart(); recalculate();
}

window.removeFromCart = function(itemId) {
  cart = cart.filter(c => c.itemId !== itemId);
  renderCart(); recalculate();
}

window.clearCart = function() {
  if (!cart.length) return;
  if (!confirm('Bersihkan semua item di keranjang?')) return;
  cart = [];
  ['cashInput','customerName'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('discountInput').value = '0';
  renderCart(); recalculate();
}

function renderCart() {
  const tbody = document.getElementById('cartBody');
  if (cart.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><div>🛍️</div><p>Keranjang kosong.<br/>Klik barang di sebelah kiri untuk menambahkan.</p></td></tr>`;
    updateCartBadge(); return;
  }
  tbody.innerHTML = cart.map(c => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td style="font-family:var(--font-mono);color:var(--muted)">${formatRp(c.price)}</td>
      <td><div class="qty-control">
        <button class="qty-btn" onclick="changeQty('${c.itemId}',-1)">−</button>
        <span class="qty-value">${c.qty}</span>
        <button class="qty-btn" onclick="changeQty('${c.itemId}',1)">+</button>
      </div></td>
      <td class="subtotal-cell">${formatRp(c.price*c.qty)}</td>
      <td><button class="remove-btn" onclick="removeFromCart('${c.itemId}')">✕</button></td>
    </tr>`).join('');
  updateCartBadge();
}

// ── PERHITUNGAN ───────────────────────────────
function getSubtotal() { return cart.reduce((s,c) => s + c.price*c.qty, 0); }
function getTotal() {
  return getSubtotal() * (1 - (parseFloat(document.getElementById('discountInput').value)||0) / 100);
}
window.recalculate = function() {
  document.getElementById('subtotalDisplay').textContent = formatRp(getSubtotal());
  document.getElementById('totalDisplay').textContent    = formatRp(getTotal());
  calcChange();
}
window.calcChange = function() {
  const cash = parseFloat(document.getElementById('cashInput').value)||0;
  const change = cash - getTotal();
  const el = document.getElementById('changeDisplay');
  el.textContent = formatRp(Math.abs(change));
  el.className = 'change-amount' + (change < 0 ? ' negative' : '');
}
window.setQuickCash = function(amount) {
  document.getElementById('cashInput').value = amount === 0
    ? Math.ceil(getTotal())
    : (parseFloat(document.getElementById('cashInput').value)||0) + amount;
  calcChange();
}

// ── PROSES TRANSAKSI ──────────────────────────
window.processTransaction = async function() {
  if (!cart.length) return showToast('Keranjang masih kosong!', 'error');
  const total  = getTotal();
  const cash   = parseFloat(document.getElementById('cashInput').value)||0;
  if (cash < total) return showToast('Uang tidak cukup!', 'error');

  const now = new Date();
  const txData = {
    date:      now.toISOString(),          // tetap simpan full ISO untuk display waktu
    localDate: localDateStr(now),          // tambah field local date untuk filter
    customer:  document.getElementById('customerName').value.trim() || 'Umum',
    kasir:     kasirAktif?.name  || 'Tidak diketahui',
    shift:     kasirAktif?.shift || '—',
    items:     JSON.parse(JSON.stringify(cart)),
    subtotal:  getSubtotal(),
    discount:  parseFloat(document.getElementById('discountInput').value)||0,
    total, cash,
    change:    cash - total,
    createdAt: serverTimestamp()
  };

  const btn = document.querySelector('.btn-success.btn-lg');
  btn.textContent = 'Menyimpan...';
  btn.disabled = true;

  try {
    // Generate kode transaksi custom
    const trxId = await generateTrxId(kasirAktif?.name);

    const stockUpdates = cart.map(c => {
      const item = items.find(i => i.id === c.itemId);
      if (item) return updateDoc(doc(db,'items',c.itemId), { stock: item.stock - c.qty });
    }).filter(Boolean);

    // Simpan dengan custom ID sebagai field + gunakan sebagai doc ID
    const txRef = doc(db, 'transactions', trxId);
    await runTransaction(db, async (t) => {
      t.set(txRef, { ...txData, trxId });
    });
    await Promise.all(stockUpdates);

    showReceipt({ id: trxId, ...txData });
    cart = [];
    ['cashInput','customerName'].forEach(id => document.getElementById(id).value='');
    document.getElementById('discountInput').value = '0';
    renderCart(); recalculate();
    showToast('Transaksi berhasil disimpan! ✓');
  } catch(e) {
    showToast('Gagal simpan: ' + e.message, 'error');
  } finally {
    btn.textContent = '✓ Bayar & Simpan Transaksi';
    btn.disabled = false;
  }
}

// ── STRUK ─────────────────────────────────────
function showReceipt(tx) {
  const date = new Date(tx.date);
  document.getElementById('receiptDate').textContent     = date.toLocaleString('id-ID');
  document.getElementById('receiptCustomer').textContent = 'Pelanggan: ' + tx.customer;
  document.getElementById('receiptKasir').textContent    = `Kasir: ${tx.kasir} | ${tx.shift}`;
  document.getElementById('receiptSubtotal').textContent  = formatRp(tx.subtotal);
  document.getElementById('receiptTotal').textContent     = formatRp(tx.total);
  document.getElementById('receiptCash').textContent      = formatRp(tx.cash);
  document.getElementById('receiptChange').textContent    = formatRp(tx.change);
  const dRow = document.getElementById('receiptDiscountRow');
  dRow.style.display = tx.discount > 0 ? 'flex' : 'none';
  if (tx.discount > 0) document.getElementById('receiptDiscount').textContent = tx.discount + '%';
  document.getElementById('receiptItems').innerHTML = tx.items.map(i =>
    `<div class="receipt-item"><span class="receipt-item-name">${i.name} x${i.qty}</span><span class="receipt-item-sub">${formatRp(i.price*i.qty)}</span></div>`
  ).join('');
  document.getElementById('receiptModal').classList.add('active');
}
window.closeModal = function(e) {
  if (e.target.id==='receiptModal') document.getElementById('receiptModal').classList.remove('active');
}

// ── DETAIL TRANSAKSI ──────────────────────────
window.showDetailModal = function(txId) {
  const tx = transactions.find(t => t.id === txId);
  if (!tx) return;
  const date = new Date(tx.date);
  const totalQty = tx.items.reduce((s,i) => s+i.qty, 0);
  document.getElementById('detailId').textContent          = tx.id;
  document.getElementById('detailDate').textContent        = date.toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('detailTime').textContent        = date.toLocaleTimeString('id-ID');
  document.getElementById('detailCustomer').textContent    = tx.customer;
  document.getElementById('detailTotalItems').textContent  = totalQty + ' item';
  document.getElementById('detailKasir').textContent       = tx.kasir || '—';
  document.getElementById('detailShift').textContent       = tx.shift || '—';
  document.getElementById('detailSubtotal').textContent    = formatRp(tx.subtotal);
  document.getElementById('detailTotal').textContent       = formatRp(tx.total);
  document.getElementById('detailCash').textContent        = formatRp(tx.cash);
  document.getElementById('detailChange').textContent      = formatRp(tx.change);
  const dRow = document.getElementById('detailDiscountRow');
  if (tx.discount > 0) {
    dRow.style.display = 'flex';
    document.getElementById('detailDiscountLabel').textContent = `Diskon (${tx.discount}%)`;
    document.getElementById('detailDiscountVal').textContent   = '- ' + formatRp(tx.subtotal*tx.discount/100);
  } else { dRow.style.display = 'none'; }
  document.getElementById('detailTableBody').innerHTML = tx.items.map((item,idx) => `
    <tr>
      <td class="detail-num">${idx+1}</td>
      <td class="detail-name">${item.name}</td>
      <td class="detail-price">${formatRp(item.price)}</td>
      <td class="detail-qty"><span class="qty-badge">${item.qty}</span></td>
      <td class="detail-subtotal">${formatRp(item.price*item.qty)}</td>
    </tr>`).join('');
  document.getElementById('detailModal').classList.add('active');
}
window.closeDetailModal = function(e) {
  if (e.target.id==='detailModal') document.getElementById('detailModal').classList.remove('active');
}
window.printDetailReceipt = function() { window.print(); }

// ── RIWAYAT ───────────────────────────────────
// Helper: ambil local date dari transaksi (support data lama & baru)
function getTxLocalDate(tx) {
  return tx.localDate || localDateStr(new Date(tx.date));
}

window.renderHistory = function renderHistory() {
  const filterDate = document.getElementById('filterDate').value;
  const list = document.getElementById('historyList');
  let filtered = filterDate
    ? transactions.filter(tx => getTxLocalDate(tx) === filterDate)
    : transactions;
  if (!filtered.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:12px;text-align:center;padding:24px;">Belum ada transaksi</p>';
    return;
  }
  list.innerHTML = filtered.map(tx => {
    const d = new Date(tx.date);
    const time = d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    const totalItems = tx.items.reduce((s,i) => s+i.qty, 0);
    return `
      <div class="history-card" onclick="showDetailModal('${tx.id}')">
        <div class="history-card-top">
          <span class="history-id">${tx.id}</span>
          <span class="history-time">${time}</span>
        </div>
        <div class="history-customer">${tx.customer}</div>
        <div class="history-card-kasir">👨‍💼 ${tx.kasir||'—'} · ${tx.shift?tx.shift.split(' ')[0]:'—'}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="history-items-count">${totalItems} item</span>
          <span class="history-total">${formatRp(tx.total)}</span>
        </div>
      </div>`;
  }).join('');
}

function updateStats() {
  const today   = localDateStr();
  const todayTx = transactions.filter(tx => getTxLocalDate(tx) === today);
  document.getElementById('statCount').textContent   = todayTx.length;
  document.getElementById('statRevenue').textContent = formatRp(todayTx.reduce((s,tx) => s+tx.total, 0));
}

// ── OWNER DASHBOARD ───────────────────────────
window.switchOwnerDate = function() { renderOwnerDashboard(); }

function renderOwnerDashboard() {
  const filterDate = document.getElementById('ownerFilterDate')?.value || localDateStr();
  const filtered = filterDate
    ? transactions.filter(tx => getTxLocalDate(tx) === filterDate)
    : transactions;

  const totalOmset    = filtered.reduce((s,tx) => s+tx.total, 0);
  const totalTx       = filtered.length;
  const avgTx         = totalTx > 0 ? totalOmset/totalTx : 0;
  const totalItemSold = filtered.reduce((s,tx) => s+tx.items.reduce((ss,i) => ss+i.qty,0), 0);

  document.getElementById('ownerOmset').textContent   = formatRp(totalOmset);
  document.getElementById('ownerTxCount').textContent = totalTx;
  document.getElementById('ownerAvgTx').textContent   = formatRp(avgTx);
  document.getElementById('ownerItemSold').textContent = totalItemSold;

  // Rekap per kasir
  const byKasir = {};
  filtered.forEach(tx => {
    const k = tx.kasir || 'Unknown';
    if (!byKasir[k]) byKasir[k] = { count:0, total:0, shift: tx.shift||'—' };
    byKasir[k].count++;
    byKasir[k].total += tx.total;
  });
  document.getElementById('ownerKasirTable').innerHTML =
    Object.entries(byKasir).sort((a,b) => b[1].total-a[1].total).map(([name,v]) => `
      <tr>
        <td><strong>${name}</strong></td>
        <td style="color:var(--muted);font-size:12px">${v.shift.split(' ')[0]}</td>
        <td style="text-align:center">${v.count}</td>
        <td style="font-family:var(--font-mono);color:var(--accent);text-align:right">${formatRp(v.total)}</td>
      </tr>`).join('') ||
    '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px">Belum ada data</td></tr>';

  // Top barang terlaris
  const byItem = {};
  filtered.forEach(tx => tx.items.forEach(i => {
    if (!byItem[i.name]) byItem[i.name] = { qty:0, total:0 };
    byItem[i.name].qty   += i.qty;
    byItem[i.name].total += i.price * i.qty;
  }));
  document.getElementById('ownerItemTable').innerHTML =
    Object.entries(byItem).sort((a,b) => b[1].qty-a[1].qty).slice(0,8).map(([name,v]) => `
      <tr>
        <td><strong>${name}</strong></td>
        <td style="text-align:center">${v.qty}x</td>
        <td style="font-family:var(--font-mono);color:var(--accent);text-align:right">${formatRp(v.total)}</td>
      </tr>`).join('') ||
    '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:16px">Belum ada data</td></tr>';
}

// ── EXPORT EXCEL ──────────────────────────────
window.exportExcel = function(fromOwner = false) {
  const filterDate = fromOwner
    ? document.getElementById('ownerFilterDate').value
    : document.getElementById('filterDate').value;
  let filtered = filterDate
    ? transactions.filter(tx => getTxLocalDate(tx) === filterDate)
    : transactions;
  if (!filtered.length) return showToast('Tidak ada transaksi untuk diekspor!', 'error');

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(filtered.map(tx => ({
    'ID Transaksi': tx.id, 'Tanggal': new Date(tx.date).toLocaleDateString('id-ID'),
    'Waktu': new Date(tx.date).toLocaleTimeString('id-ID'),
    'Kasir': tx.kasir||'—', 'Shift': tx.shift||'—', 'Customer': tx.customer,
    'Subtotal': tx.subtotal, 'Diskon (%)': tx.discount, 'Total': tx.total,
    'Uang Diterima': tx.cash, 'Kembalian': tx.change,
    'Jml Item': tx.items.reduce((s,i) => s+i.qty, 0),
  })));
  XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan');

  const detailRows = [];
  filtered.forEach(tx => tx.items.forEach(item => detailRows.push({
    'ID Transaksi': tx.id, 'Tanggal': new Date(tx.date).toLocaleDateString('id-ID'),
    'Kasir': tx.kasir||'—', 'Nama Barang': item.name,
    'Harga Satuan': item.price, 'Qty': item.qty, 'Subtotal': item.price*item.qty,
  })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detail Item');

  const byDate = {};
  filtered.forEach(tx => {
    const d = getTxLocalDate(tx);
    if (!byDate[d]) byDate[d] = { count:0, revenue:0 };
    byDate[d].count++; byDate[d].revenue += tx.total;
  });
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.json_to_sheet(Object.entries(byDate).map(([date,v]) => ({
      'Tanggal': date, 'Jml Transaksi': v.count, 'Total Pendapatan': v.revenue
    }))), 'Rekap Harian');

  XLSX.writeFile(wb, `laporan-kasir-${filterDate||'semua'}.xlsx`);
  showToast('File Excel berhasil didownload!');
}

// ── RESPONSIVE ────────────────────────────────
window.switchTab = function(tabName) {
  document.querySelectorAll('.sidebar,.main,.history-panel,.owner-dashboard').forEach(el => el.classList.remove('tab-active'));
  const tabMap = { barang:'.sidebar', transaksi:'.main', riwayat:'.history-panel', owner:'.owner-dashboard' };
  document.querySelector(tabMap[tabName])?.classList.add('tab-active');
  document.querySelectorAll('.bnav-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('tab-'+tabName)?.classList.add('active');
  if (tabName === 'owner') renderOwnerDashboard();
}

window.toggleHistory = function() {
  document.querySelector('.history-panel').classList.toggle('panel-open');
}

function updateCartBadge() {
  const totalQty = cart.reduce((s,c) => s+c.qty, 0);
  const badge = document.getElementById('cartBadge');
  const btnGo = document.getElementById('btnGoToCart');
  const cartCount = document.getElementById('cartCount');
  if (badge) { badge.style.display = totalQty>0?'block':'none'; badge.textContent = totalQty>99?'99+':totalQty; }
  if (btnGo && cartCount) {
    btnGo.style.display = (totalQty>0 && window.innerWidth<=768) ? 'block' : 'none';
    cartCount.textContent = totalQty;
  }
}

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    document.querySelectorAll('.sidebar,.main,.history-panel,.owner-dashboard').forEach(el => el.classList.remove('tab-active'));
  } else {
    const hasActive = document.querySelector('.sidebar.tab-active,.main.tab-active,.history-panel.tab-active,.owner-dashboard.tab-active');
    if (!hasActive) switchTab('barang');
  }
});
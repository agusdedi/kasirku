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
let editingId    = null; // ID item yang sedang di-edit (null = mode tambah baru)

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
  // Jika sedang dalam mode edit, jalankan save edit
  if (editingId) return saveEditItem(editingId);

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

// Toggle form tambah barang (collapsible)
window.toggleFormBarang = function(forceOpen = false) {
  const form    = document.getElementById('formBarang');
  const icon    = document.getElementById('formToggleIcon');
  const text    = document.getElementById('formToggleText');
  const isOpen  = form.style.display !== 'none';

  if (forceOpen || !isOpen) {
    form.style.display = 'flex';
    icon.classList.add('open');
    text.textContent = 'Tutup Form';
    document.getElementById('itemName').focus();
  } else {
    form.style.display = 'none';
    icon.classList.remove('open');
    text.textContent = 'Tambah Barang Baru';
  }
}

window.editItem = function(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  document.getElementById('itemName').value     = item.name;
  document.getElementById('itemPrice').value    = item.price;
  document.getElementById('itemStock').value    = item.stock;
  document.getElementById('itemCategory').value = item.category;
  const btn = document.getElementById('btnAddItem');
  if (btn) {
    btn.textContent = '💾 Simpan Perubahan';
    btn.style.background = 'var(--acc2)';
  }
  document.getElementById('btnCancelEdit').style.display = 'block';
  // Otomatis buka form saat edit
  toggleFormBarang(true);
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
// Alias agar kompatibel jika masih dipanggil dari tempat lain
window._saveEditItem = window.saveEditItem;

window.cancelEdit = function() {
  editingId = null;
  ['itemName','itemPrice','itemStock','itemCategory'].forEach(id => { document.getElementById(id).value=''; });
  const btn = document.getElementById('btnAddItem');
  if (btn) {
    btn.textContent = '+ Tambah Barang';
    btn.style.background = '';
  }
  document.getElementById('btnCancelEdit').style.display = 'none';
  // Tutup form setelah cancel/save
  const form = document.getElementById('formBarang');
  const icon = document.getElementById('formToggleIcon');
  const text = document.getElementById('formToggleText');
  if (form) { form.style.display = 'none'; }
  if (icon) { icon.classList.remove('open'); }
  if (text) { text.textContent = 'Tambah Barang Baru'; }
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
  // Flash feedback on item card
  const cards = document.querySelectorAll('.item-card');
  cards.forEach(card => {
    if (card.getAttribute('onclick')?.includes(itemId)) {
      card.classList.remove('flash-add');
      void card.offsetWidth;
      card.classList.add('flash-add');
      setTimeout(() => card.classList.remove('flash-add'), 600);
    }
  });
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
    tbody.innerHTML = `
      <tr id="emptyCart">
        <td colspan="5" class="empty-state">
          <div class="empty-state-circle">🛍️</div>
          <div class="empty-state-title">Keranjang kosong</div>
          <div class="empty-state-sub">Pilih barang dari daftar atau scan barcode kemasan untuk mulai transaksi.</div>
          <div class="empty-state-actions">
            <div class="empty-action-btn" onclick="openScanner('cart')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
              Scan Barcode
            </div>
            <div class="empty-action-btn sec" onclick="toggleCartSearch()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Cari Barang
            </div>
          </div>
        </td>
      </tr>`;
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
  const sub   = formatRp(getSubtotal());
  const total = formatRp(getTotal());
  // Desktop
  document.getElementById('subtotalDisplay').textContent = sub;
  document.getElementById('totalDisplay').textContent    = total;
  // Drawer mobile
  const dSub = document.getElementById('drawerSubtotal');
  const dTot = document.getElementById('drawerTotal');
  if (dSub) dSub.textContent = sub;
  if (dTot) dTot.textContent = total;
  // Header mobile badge
  const badge = document.getElementById('mobileTotalBadge');
  if (badge) badge.textContent = total;
  // Drawer handle total
  const handleTotal = document.getElementById('drawerHandleTotal');
  if (handleTotal) handleTotal.textContent = total;
  calcChange();
}

window.calcChange = function() {
  const cash   = parseFloat(document.getElementById('cashInput').value) ||
                 parseFloat(document.getElementById('drawerCashInput')?.value) || 0;
  const change = cash - getTotal();
  const val    = formatRp(Math.abs(change));
  const cls    = 'change-amount' + (change < 0 ? ' negative' : '');
  // Desktop
  const el = document.getElementById('changeDisplay');
  if (el) { el.textContent = val; el.className = cls; }
  // Drawer
  const del = document.getElementById('drawerChange');
  if (del) { del.textContent = val; del.className = cls; }
}

window.setQuickCash = function(amount) {
  const isMobile = window.innerWidth <= 768;
  const inputId  = isMobile ? 'drawerCashInput' : 'cashInput';
  const cur      = parseFloat(document.getElementById(inputId)?.value) || 0;
  const val      = amount === 0 ? Math.ceil(getTotal()) : cur + amount;
  // Set kedua input agar selalu sync
  const ci = document.getElementById('cashInput');
  const di = document.getElementById('drawerCashInput');
  if (ci) ci.value = val;
  if (di) di.value = val;
  calcChange();
}

// Sync diskon dari drawer ke desktop
window.syncDiscount = function(val) {
  const di = document.getElementById('discountInput');
  if (di) di.value = val;
  recalculate();
}

// Sync cash dari drawer ke desktop
window.syncCash = function(val) {
  const ci = document.getElementById('cashInput');
  if (ci) ci.value = val;
  calcChange();
}

// ── DRAWER FUNCTIONS ──────────────────────────
window.toggleDrawer = function() {
  const drawer  = document.getElementById('paymentDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const label   = document.getElementById('drawerHandleLabel');
  if (!drawer) return;
  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    drawer.classList.remove('open');
    overlay.classList.remove('active');
    if (label) label.textContent = 'Geser untuk bayar';
  } else {
    drawer.classList.add('open');
    overlay.classList.add('active');
    if (label) label.textContent = 'Tutup';
    // Sync nilai dari desktop ke drawer saat dibuka
    const di = document.getElementById('drawerDiscountInput');
    const dc = document.getElementById('drawerCashInput');
    if (di) di.value = document.getElementById('discountInput')?.value || '0';
    if (dc) dc.value = document.getElementById('cashInput')?.value || '';
    setTimeout(() => document.getElementById('drawerCashInput')?.focus(), 300);
  }
}

window.closeDrawer = function() {
  const drawer  = document.getElementById('paymentDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const label   = document.getElementById('drawerHandleLabel');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
  if (label) label.textContent = 'Geser untuk bayar';
}

// Sync customerName mobile → desktop
document.addEventListener('DOMContentLoaded', () => {
  const cm = document.getElementById('customerNameMobile');
  const cd = document.getElementById('customerName');
  if (cm && cd) {
    cm.addEventListener('input', () => cd.value = cm.value);
    cd.addEventListener('input', () => cm.value = cd.value);
  }
});

// ── PROSES TRANSAKSI ──────────────────────────
window.processTransaction = async function() {
  if (!cart.length) return showToast('Keranjang masih kosong!', 'error');
  const total  = getTotal();
  const isMobile = window.innerWidth <= 768;
  // Ambil cash dari drawer jika mobile, dari desktop jika tidak
  const cash = parseFloat(
    isMobile
      ? (document.getElementById('drawerCashInput')?.value || document.getElementById('cashInput')?.value)
      : document.getElementById('cashInput')?.value
  ) || 0;
  if (cash < total) return showToast('Uang tidak cukup!', 'error');

  const now = new Date();
  const txData = {
    date:      now.toISOString(),
    localDate: localDateStr(now),
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
    ['cashInput','customerName','customerNameMobile'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    ['discountInput','drawerDiscountInput'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '0';
    });
    const dci = document.getElementById('drawerCashInput');
    if (dci) dci.value = '';
    closeDrawer();
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
window.printDetailReceipt = function() {
  // Ambil data dari detail modal yang sedang aktif
  const txId    = document.getElementById('detailId').textContent;
  const tx      = transactions.find(t => t.id === txId);
  if (!tx) { window.print(); return; } // fallback

  const date    = new Date(tx.date);
  const dateStr = date.toLocaleString('id-ID');
  const discountRow = tx.discount > 0
    ? `<div class="receipt-row"><span>Diskon ${tx.discount}%</span><span>- ${formatRp(tx.subtotal * tx.discount / 100)}</span></div>`
    : '';
  const itemsHtml = tx.items.map(i =>
    `<div class="receipt-item">
      <span class="receipt-item-name">${i.name} x${i.qty}</span>
      <span class="receipt-item-sub">${formatRp(i.price * i.qty)}</span>
    </div>`
  ).join('');

  // Buat atau update #printArea di body
  let printArea = document.getElementById('printArea');
  if (!printArea) {
    printArea = document.createElement('div');
    printArea.id = 'printArea';
    document.body.appendChild(printArea);
  }

  printArea.innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <h2>KasirKu</h2>
        <p>${dateStr}</p>
        <p>Pelanggan: ${tx.customer}</p>
        <p class="receipt-kasir-info">Kasir: ${tx.kasir} | ${tx.shift}</p>
      </div>
      <hr class="receipt-divider" />
      ${itemsHtml}
      <hr class="receipt-divider" />
      <div class="receipt-totals">
        <div class="receipt-row"><span>Subtotal</span><span>${formatRp(tx.subtotal)}</span></div>
        ${discountRow}
        <div class="receipt-row receipt-total"><span>TOTAL</span><span>${formatRp(tx.total)}</span></div>
        <div class="receipt-row"><span>Bayar</span><span>${formatRp(tx.cash)}</span></div>
        <div class="receipt-row receipt-change"><span>Kembalian</span><span>${formatRp(tx.change)}</span></div>
      </div>
      <div class="receipt-footer">Terima kasih telah berbelanja! 🙏</div>
    </div>`;

  window.print();
}

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
    updateStats(); // tetap update stats meski kosong
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
  updateStats(); // sync stats dengan tanggal yang difilter
}

function updateStats() {
  const filterDate = document.getElementById('filterDate')?.value || localDateStr();
  const filtered   = transactions.filter(tx => getTxLocalDate(tx) === filterDate);

  document.getElementById('statCount').textContent   = filtered.length;
  document.getElementById('statRevenue').textContent = formatRp(filtered.reduce((s,tx) => s+tx.total, 0));

  // Update judul section sesuai tanggal yang dipilih
  const titleEl = document.getElementById('historyTitle');
  if (titleEl) {
    const today    = localDateStr();
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    if (filterDate === today) {
      titleEl.textContent = 'Riwayat Hari Ini';
    } else if (filterDate === yesterday) {
      titleEl.textContent = 'Riwayat Kemarin';
    } else {
      // Format tanggal yang dipilih: "21 Mar 2026"
      const d = new Date(filterDate + 'T00:00:00');
      titleEl.textContent = 'Riwayat ' + d.toLocaleDateString('id-ID', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    }
  }
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
  const panel = document.querySelector('.history-panel');
  const isOpen = panel.classList.contains('panel-open');
  if (isOpen) {
    closeHistory();
  } else {
    panel.classList.add('panel-open');
    // Tambah overlay agar bisa klik luar untuk tutup
    let overlay = document.getElementById('historyOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'historyOverlay';
      overlay.className = 'history-overlay';
      overlay.onclick = closeHistory;
      document.body.appendChild(overlay);
    }
    overlay.classList.add('active');
  }
}

window.closeHistory = function() {
  document.querySelector('.history-panel').classList.remove('panel-open');
  const overlay = document.getElementById('historyOverlay');
  if (overlay) overlay.classList.remove('active');
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




// ── BARCODE SCANNER ───────────────────────────
// Android Chrome : native BarcodeDetector (sangat cepat, ~5ms/frame)
// ── ENGINE SCAN ──
// Android: BarcodeDetector native (hardware, ~5ms)
// iOS: ZBar WASM compiled dari C (~10ms) — JAUH lebih cepat dari ZXing JS (~200ms+)
// Keduanya pakai requestAnimationFrame loop tanpa overhead blob/URL
// ─────────────────────────────────────────────

let scannerMode     = 'cart';
let scannerRunning  = false;
let lastScannedCode = null;
let scanCooldown    = false;

let _stream      = null;
let _video       = null;
let _canvas      = null;
let _ctx         = null;
let _rafId       = null;
let _detector    = null;   // native BarcodeDetector (Android Chrome)
let _zbarScanner = null;   // ZBar WASM scanner (iOS) — compiled C, jauh lebih cepat dari ZXing JS
let _useNative   = false;
let _torchTrack  = null;
let _zoomLevel   = 1;
let _manualOpen  = false;

// ── INIT ZXING ────────────────────────────────
// ZBar WASM expose sebagai window.zbarWasm
// Throttle counter — ZBar decode setiap N frame (lebih cepat dari ZXing, bisa 1:1 atau setiap 2 frame)
let _frameCount = 0;
const _DECODE_EVERY = 2; // decode setiap 2 frame (~15fps decode pada 30fps video)

// Canvas crop — decode hanya area tengah, bukan full frame
let _cropCanvas = null;
let _cropCtx    = null;
const _CROP_SIZE = 400; // pixel — cukup besar untuk barcode tapi ringan diproses


// ── DEBUG HELPER (tampil di layar iPhone) ──
function _dbg(msg, type) {
  const el = document.getElementById('scannerDebug');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.color = type === 'ok' ? '#0f8' : type === 'err' ? '#f55' : '#ff0';
  if (type === 'ok') setTimeout(() => { if (el) el.style.display = 'none'; }, 3000);
}

async function _initZBar() {
  if (_zbarScanner) return true;
  try {
    const zbar = window.zbarWasm;
    if (!zbar) {
      console.warn('[ZBar] window.zbarWasm belum tersedia');
      _dbg('ERR: zbarWasm not loaded', 'err');
      return false;
    }
    // getDefaultScanner — setup ZBar scanner WASM
    _zbarScanner = await zbar.getDefaultScanner();
    console.log('[ZBar] scanner siap');
    _dbg('ZBar siap ✓', 'ok');
    return true;
  } catch(e) {
    console.error('[ZBar] init error:', e);
    _dbg('ERR init: ' + e.message, 'err');
    return false;
  }
}

// Jalankan init ZBar di background saat halaman load — jadi saat scanner dibuka sudah siap
function _preloadZBar() {
  if (window.zbarWasm) {
    _initZBar().catch(() => {});
  } else {
    // Tunggu script load
    setTimeout(_preloadZBar, 500);
  }
}
setTimeout(_preloadZBar, 1000);

// ── OPEN SCANNER ──────────────────────────────
window.openScanner = async function(mode) {
  scannerMode     = mode;
  lastScannedCode = null;
  scanCooldown    = false;

  document.getElementById('scannerTitle').textContent =
    mode === 'add' ? 'Scan Barcode Barang' : 'Scan untuk Transaksi';
  document.getElementById('scannerSubtitle').textContent =
    mode === 'add'
      ? 'Scan kemasan — form muncul setelah terdeteksi'
      : 'Scan kemasan — langsung masuk keranjang';

  // Update tombol manual input sesuai mode
  const manualSubmitBtn = document.getElementById('manualSubmitBtn');
  const manualSubmitIcon = document.getElementById('manualSubmitIcon');
  const manualSubmitLabel = document.getElementById('manualSubmitLabel');
  if (manualSubmitBtn && manualSubmitIcon && manualSubmitLabel) {
    if (mode === 'add') {
      manualSubmitIcon.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
      manualSubmitLabel.textContent = 'Tambah';
      manualSubmitBtn.title = 'Tambah Barang dengan Barcode Ini';
    } else {
      manualSubmitIcon.innerHTML = '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>';
      manualSubmitLabel.textContent = 'Cari';
      manualSubmitBtn.title = 'Cari Barang dengan Barcode Ini';
    }
  }

  _resetScannerUI();
  document.getElementById('scannerModal').classList.add('active');

  try {
    await _startStream();
  } catch(e) {
    // Cek apakah stream sebenarnya sudah berjalan (iOS kadang throw tapi kamera jalan)
    if (_stream && _stream.active && scannerRunning) {
      console.warn('Scanner error ignored — stream already active:', e.name);
      return;
    }
    scannerRunning = false;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    let msg = 'Tidak bisa akses kamera.';
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' ||
        /NotAllowed|Permission/i.test(e.toString())) {
      msg = isIOS
        ? 'Akses kamera ditolak. Buka Settings → Safari → Kamera → Izinkan.'
        : 'Izin kamera ditolak. Klik 🔒 di address bar → izinkan Kamera → refresh.';
    } else if (e.name === 'NotFoundError')    { msg = 'Kamera tidak ditemukan.'; }
    else if (e.name === 'NotReadableError')   { msg = 'Kamera dipakai aplikasi lain.'; }
    const hintEl = document.getElementById('scannerHint');
    if (hintEl) {
      hintEl.textContent   = '❌ ' + msg;
      hintEl.style.cssText = 'position:absolute;left:50%;bottom:50%;transform:translate(-50%,50%);background:rgba(240,86,106,.9);color:#fff;font-size:12px;font-weight:600;border-radius:8px;padding:10px 16px;white-space:normal;text-align:center;max-width:85%;line-height:1.5;z-index:10;';
    }
    showToast(msg, 'error');
  }
}

// ── START STREAM ──────────────────────────────
async function _startStream() {
  _stopAll();

  const region = document.getElementById('scannerQrRegion');
  region.innerHTML = '';
  _video = document.createElement('video');
  _video.setAttribute('playsinline',        '');
  _video.setAttribute('webkit-playsinline', '');
  _video.setAttribute('muted',              '');
  _video.setAttribute('autoplay',           '');
  _video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  region.appendChild(_video);

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API tidak tersedia — pastikan HTTPS');
  }

  // Progressive constraints — iOS hanya terima yang simpel
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
  } catch(e1) {
    if (e1.name === 'NotAllowedError' || e1.name === 'PermissionDeniedError') throw e1;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
    catch(e2) { throw e2; }
  }

  _stream          = stream;
  _video.srcObject = stream;
  _torchTrack      = stream.getVideoTracks()[0];
  _canvas          = document.createElement('canvas');
  _ctx             = _canvas.getContext('2d', { willReadFrequently: true });

  // scannerRunning = true SEBELUM play agar catch tahu stream sudah aktif
  scannerRunning = true;

  // iOS: play() sering throw tapi video tetap jalan — abaikan semua error
  try { await _video.play(); } catch(e) { /* iOS quirk */ }

  // Tunggu video punya dimensi (max 5 detik)
  await new Promise(resolve => {
    const t = setTimeout(resolve, 5000);
    const check = () => {
      if (_video && _video.videoWidth > 0) { clearTimeout(t); resolve(); }
      else setTimeout(check, 80);
    };
    check();
  });

  // Pilih engine decode
  // 1. Native BarcodeDetector — Android Chrome, sangat cepat
  _useNative = false;
  _detector  = null;
  if ('BarcodeDetector' in window) {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      // Cek apakah ini native (bukan polyfill) — native biasanya list < 20 format
      // Polyfill biasanya return [] atau list sangat panjang
      const wanted  = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code'];
      const formats = supported.length > 0
        ? wanted.filter(f => supported.includes(f))
        : wanted;
      _detector  = new BarcodeDetector({ formats: formats.length ? formats : wanted });
      _useNative = true;
    } catch(e) { /* fallback ke ZXing */ }
  }

  // 2. ZBar WASM — iOS Safari/Chrome (jauh lebih cepat dari ZXing, compiled C)
  if (!_useNative) {
    if (!_zbarScanner) {
      // Init ZBar — await langsung karena openScanner sudah async
      const ok = await _initZBar();
      if (!ok || !scannerRunning) return; // gagal init atau scanner ditutup
    }
    // Siapkan crop canvas jika belum ada (bisa null setelah closeScanner)
    if (!_cropCanvas) {
      _cropCanvas        = document.createElement('canvas');
      _cropCanvas.width  = _CROP_SIZE;
      _cropCanvas.height = _CROP_SIZE;
      _cropCtx = _cropCanvas.getContext('2d', { willReadFrequently: true });
    }
  }

  _scanLoop();
}

// ── DECODE LOOP ───────────────────────────────
function _scanLoop() {
  if (!scannerRunning) return;

  if (!_video || _video.readyState < 2 || _video.videoWidth === 0 || scanCooldown) {
    _rafId = requestAnimationFrame(_scanLoop);
    return;
  }

  _frameCount++;
  // Update hint setiap ~60 frame agar user tahu scanner aktif (animasi titik)
  if (_frameCount % 60 === 0) {
    const dots = '.'.repeat((_frameCount / 60) % 4);
    const hintEl = document.getElementById('scannerHint');
    if (hintEl && !scanCooldown) hintEl.textContent = 'Arahkan barcode ke kotak' + dots;
  }

  if (_useNative && _detector) {
    // ── PATH A: Native BarcodeDetector (Android Chrome) ──
    // Hardware-accelerated, decode setiap frame karena sudah sangat cepat
    const w = _video.videoWidth;
    const h = _video.videoHeight;
    if (_canvas.width !== w || _canvas.height !== h) {
      _canvas.width = w; _canvas.height = h;
    }
    _ctx.drawImage(_video, 0, 0, w, h);
    _detector.detect(_canvas)
      .then(results => {
        if (results.length > 0 && scannerRunning && !scanCooldown) {
          _onDetected(results[0].rawValue);
        } else if (scannerRunning) {
          _rafId = requestAnimationFrame(_scanLoop);
        }
      })
      .catch(() => {
        if (scannerRunning) _rafId = requestAnimationFrame(_scanLoop);
      });

  } else if (_zbarScanner) {
    // ── PATH B: ZBar WASM (iOS Safari/Chrome) ──
    // ZBar adalah port dari library C — JAUH lebih cepat dari ZXing JS
    // Bisa decode EAN-13 dalam ~5-15ms bahkan di iPhone lama
    // Throttle setiap 2 frame agar tidak blocking UI
    if (_frameCount % _DECODE_EVERY !== 0) {
      _rafId = requestAnimationFrame(_scanLoop);
      return;
    }

    const vw = _video.videoWidth;
    const vh = _video.videoHeight;

    // Crop area tengah — barcode diarahkan ke kotak tengah viewport
    const cropSize = Math.min(vw, vh, _CROP_SIZE * 2);
    const cropX    = Math.floor((vw - cropSize) / 2);
    const cropY    = Math.floor((vh - cropSize) / 2);

    _cropCtx.drawImage(
      _video,
      cropX, cropY, cropSize, cropSize,
      0, 0, _CROP_SIZE, _CROP_SIZE
    );

    const imageData = _cropCtx.getImageData(0, 0, _CROP_SIZE, _CROP_SIZE);

    // ZBar scanImageData — async tapi sangat cepat karena WASM
    window.zbarWasm.scanImageData(imageData, _zbarScanner)
      .then(symbols => {
        if (!scannerRunning || scanCooldown) return;
        if (symbols && symbols.length > 0) {
          // Decode result — ZBar kembalikan typed array, decode ke string
          const sym = symbols[0];
          // ZBar decode() tanpa argumen = utf8 default
          const code = typeof sym.decode === 'function' ? sym.decode() : null;
          if (code) {
            _dbg('✓ ' + code, 'ok');
            _onDetected(code);
            return;
          }
        }
        if (scannerRunning) _rafId = requestAnimationFrame(_scanLoop);
      })
      .catch(() => {
        if (scannerRunning) _rafId = requestAnimationFrame(_scanLoop);
      });

  } else {
    // ZBar belum siap — tidak seharusnya terjadi (openScanner sudah init)
    // Tapi kalau terjadi, tampilkan feedback dan coba lagi
    const hintEl = document.getElementById('scannerHint');
    if (hintEl && hintEl.textContent === 'Posisikan barcode di dalam kotak') {
      hintEl.textContent = 'Memuat engine scan...';
    }
    setTimeout(() => {
      if (scannerRunning) _rafId = requestAnimationFrame(_scanLoop);
    }, 200);
  }
}

// ── DETECTED ──────────────────────────────────

// ── FEEDBACK OVERLAY (di dalam viewport, pasti terlihat di iOS) ──
function _showFeedback(msg, type, duration) {
  const el = document.getElementById('scannerFeedback');
  if (!el) return;
  el.textContent = msg;
  el.className   = `scanner-feedback-overlay ${type} show`;
  clearTimeout(el._timer);
  if (duration) {
    el._timer = setTimeout(() => {
      el.classList.remove('show');
    }, duration);
  }
}
function _hideFeedback() {
  const el = document.getElementById('scannerFeedback');
  if (el) el.classList.remove('show');
}

function _onDetected(code) {
  if (!code || !scannerRunning || scanCooldown) return;
  if (code === lastScannedCode) return;

  lastScannedCode = code;
  scanCooldown    = true;

  // Hentikan loop sementara
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

  // Flash viewport hijau
  _flashSuccess();

  // Tampilkan kode di result area (desktop/tablet)
  const resultEl = document.getElementById('scannerResult');
  if (resultEl) resultEl.style.display = 'flex';
  const codeEl = document.getElementById('scannerResultCode');
  if (codeEl) codeEl.textContent = code;

  // Feedback overlay di viewport — pasti terlihat di iOS
  _showFeedback('📷 ' + code, 'info', 0); // 0 = jangan auto-hide, tunggu handler

  const hintEl = document.getElementById('scannerHint');
  if (hintEl) hintEl.textContent = '✓ Terdeteksi!';

  if (scannerMode === 'cart') {
    _handleCartScan(code);
  } else {
    _handleAddScan(code);
  }
}

function _flashSuccess() {
  // Flash border hijau di viewport
  const vp = document.querySelector('.scanner-viewport');
  if (vp) {
    vp.style.outline = '4px solid #23d18b';
    vp.style.outlineOffset = '-4px';
    setTimeout(() => { vp.style.outline = ''; vp.style.outlineOffset = ''; }, 600);
  }
  // Flash overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:absolute;inset:0;
    background:rgba(35,209,139,0.22);
    pointer-events:none;z-index:10;
    animation:_flashAnim 0.5s ease-out forwards;
  `;
  const vp2 = document.querySelector('.scanner-viewport');
  if (vp2) {
    vp2.appendChild(overlay);
    setTimeout(() => overlay.remove(), 500);
  }
  // Injeksi keyframe sekali
  if (!document.getElementById('_flashKf')) {
    const s = document.createElement('style');
    s.id = '_flashKf';
    s.textContent = '@keyframes _flashAnim{0%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(s);
  }
}

function _resumeScan() {
  scanCooldown    = false;
  lastScannedCode = null;
  _hideFeedback();
  const hintEl = document.getElementById('scannerHint');
  if (hintEl) {
    hintEl.textContent = 'Posisikan barcode di dalam kotak';
    hintEl.style.cssText = ''; // reset style jika ada override
  }
  if (scannerRunning) _rafId = requestAnimationFrame(_scanLoop);
}

// ── CART MODE: langsung tambah, tanpa konfirmasi ──
function _handleCartScan(code) {
  const item = items.find(i => i.barcode === code);

  if (item) {
    addToCart(item.id);
    // Feedback overlay hijau — terlihat langsung di viewport
    _showFeedback(`✓ ${item.name} ditambahkan`, 'success', 1500);
    // Auto lanjut scan setelah 1.5 detik
    setTimeout(() => {
      if (!scannerRunning) return;
      _hideFeedback();
      const resultEl = document.getElementById('scannerResult');
      if (resultEl) resultEl.style.display = 'none';
      _resumeScan();
    }, 1500);

  } else {
    // Barang tidak ditemukan — feedback overlay merah
    _showFeedback('❌ Barang tidak ditemukan\nTambahkan dulu via tab Barang', 'error', 2500);
    // Flash border merah di viewport
    const vp = document.querySelector('.scanner-viewport');
    if (vp) {
      vp.style.outline = '4px solid #f0566a';
      vp.style.outlineOffset = '-4px';
      setTimeout(() => { vp.style.outline = ''; vp.style.outlineOffset = ''; }, 800);
    }
    setTimeout(() => {
      if (!scannerRunning) return;
      _hideFeedback();
      const resultEl = document.getElementById('scannerResult');
      if (resultEl) resultEl.style.display = 'none';
      _resumeScan();
    }, 2500);
  }
}

// ── ADD MODE: form konfirmasi ──────────────────
function _handleAddScan(code) {
  const addForm   = document.getElementById('scannerAddForm');
  const addFields = document.getElementById('scannerAddFields');
  const foundMsg  = document.getElementById('scannerFoundMsg');
  const existing  = items.find(i => i.barcode === code);

  if (existing) {
    // Sudah ada — feedback overlay hijau, lanjut scan
    _showFeedback(`✓ "${existing.name}" sudah ada di daftar`, 'success', 2000);
    if (addForm) addForm.style.display = 'none';
    setTimeout(() => {
      if (!scannerRunning) return;
      _hideFeedback();
      const resultEl = document.getElementById('scannerResult');
      if (resultEl) resultEl.style.display = 'none';
      _resumeScan();
    }, 2000);

  } else {
    // Barang baru — sembunyikan feedback overlay, tampilkan form
    _hideFeedback();
    const hintEl = document.getElementById('scannerHint');
    if (hintEl) hintEl.textContent = 'Isi detail barang di bawah';
    if (addForm) addForm.style.display = 'block';
    if (foundMsg) foundMsg.innerHTML =
      `<span style="color:var(--acc2)">Barcode <b>${code}</b> baru — lengkapi detail:</span>`;
    if (addFields) addFields.style.display = 'flex';
    ['scanNewName','scanNewPrice','scanNewStock','scanNewCategory'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    // Scroll modal ke bawah agar form terlihat di iOS
    const box = document.querySelector('.scanner-modal-box');
    if (box) setTimeout(() => box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }), 100);
    setTimeout(() => document.getElementById('scanNewName')?.focus(), 200);
  }
}

window.confirmAddItem = async function() {
  const name     = document.getElementById('scanNewName').value.trim();
  const price    = parseFloat(document.getElementById('scanNewPrice').value);
  const stock    = parseInt(document.getElementById('scanNewStock').value) || 0;
  const category = document.getElementById('scanNewCategory').value.trim() || 'Umum';
  const barcode  = lastScannedCode;

  if (!name)              return showToast('Nama barang wajib diisi!', 'error');
  if (!price || price<=0) return showToast('Harga harus lebih dari 0!', 'error');
  if (!barcode)           return showToast('Barcode tidak valid.', 'error');

  try {
    await addDoc(collection(db,'items'), {
      name, price, stock, category, barcode,
      createdAt: serverTimestamp()
    });
    showToast(`"${name}" berhasil ditambahkan!`);
    window.resumeScanner();
  } catch(e) {
    showToast('Gagal simpan: ' + e.message, 'error');
  }
}

window.resumeScanner = function() {
  _resetScannerUI();
  _resumeScan();
}

function _resetScannerUI() {
  ['scannerResult','scannerAddForm','scannerCartMsg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const addFields = document.getElementById('scannerAddFields');
  if (addFields) addFields.style.display = 'none';
  const codeEl = document.getElementById('scannerResultCode');
  if (codeEl) codeEl.textContent = '';
  const hintEl = document.getElementById('scannerHint');
  if (hintEl) hintEl.textContent = 'Posisikan barcode di dalam kotak';
}

window.closeScanner = function() {
  scannerRunning = false;
  _stopAll();
  document.getElementById('scannerModal').classList.remove('active');
  lastScannedCode = null;
  scanCooldown    = false;
  _resetScannerUI();
}

function _stopAll() {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) {
    _stream.getTracks().forEach(t => t.stop());
    _stream = null;
  }
  if (_video) {
    _video.srcObject = null;
    _video = null;
  }
  _torchTrack = null;
  _canvas = null;
  _ctx    = null;
  // Reset ZBar scanner state (scanner object dipertahankan untuk reuse, hanya reset state)
  // _zbarScanner tetap hidup agar decode berikutnya langsung siap
  _cropCanvas  = null;
  _cropCtx     = null;
  _frameCount  = 0;
  // Clear region
  const region = document.getElementById('scannerQrRegion');
  if (region) region.innerHTML = '';
}

// Tutup saat klik overlay
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scannerModal')?.addEventListener('click', e => {
    if (e.target.id === 'scannerModal') window.closeScanner();
  });
});

// ── CART SEARCH ───────────────────────────────
let cartSearchOpen = false;

window.toggleCartSearch = function() {
  const panel = document.getElementById('cartSearchPanel');
  if (!panel) return;
  cartSearchOpen = !cartSearchOpen;
  panel.classList.toggle('open', cartSearchOpen);
  if (cartSearchOpen) {
    setTimeout(() => document.getElementById('cartSearchInput')?.focus(), 150);
    renderCartSearch();
  }
}

window.closeCartSearch = function() {
  cartSearchOpen = false;
  const panel = document.getElementById('cartSearchPanel');
  if (panel) panel.classList.remove('open');
  const input = document.getElementById('cartSearchInput');
  if (input) input.value = '';
  const results = document.getElementById('cartSearchResults');
  if (results) results.innerHTML = '';
}

window.renderCartSearch = function() {
  const q       = (document.getElementById('cartSearchInput')?.value || '').toLowerCase().trim();
  const results = document.getElementById('cartSearchResults');
  if (!results) return;

  if (!q) {
    // Tampilkan semua barang saat kosong
    const all = items.slice(0, 20);
    if (all.length === 0) {
      results.innerHTML = '<div class="cart-search-empty">Belum ada barang di daftar.</div>';
      return;
    }
    results.innerHTML = all.map(item => cartSearchItemHTML(item)).join('');
    return;
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(q) ||
    i.category.toLowerCase().includes(q) ||
    (i.barcode && i.barcode.includes(q))
  );

  if (filtered.length === 0) {
    results.innerHTML = `<div class="cart-search-empty">Barang "${q}" tidak ditemukan.</div>`;
    return;
  }

  results.innerHTML = filtered.map(item => cartSearchItemHTML(item)).join('');
}

function cartSearchItemHTML(item) {
  const inCart = cart.find(c => c.itemId === item.id);
  const qty    = inCart ? inCart.qty : 0;
  return `
    <div class="cart-search-item ${item.stock <= 0 ? 'out-of-stock' : ''}" onclick="addToCartFromSearch('${item.id}')">
      <div class="cart-search-item-info">
        <div class="cart-search-item-name">${item.name}</div>
        <div class="cart-search-item-meta">
          <span class="cart-search-item-price">${formatRp(item.price)}</span>
          <span class="cart-search-item-cat">${item.category}</span>
          ${item.stock <= 5 ? `<span class="cart-search-item-stock-low">Stok: ${item.stock}</span>` : ''}
        </div>
      </div>
      <div class="cart-search-item-right">
        ${qty > 0 ? `<span class="cart-search-qty-badge">${qty}</span>` : ''}
        <div class="cart-search-add-btn ${item.stock <= 0 ? 'disabled' : ''}">
          ${item.stock <= 0 ? '✕' : '+'}
        </div>
      </div>
    </div>
  `;
}

window.addToCartFromSearch = function(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item || item.stock <= 0) return;
  addToCart(itemId);
  // Re-render hasil search agar qty badge update
  renderCartSearch();
}

// ── SCANNER CONTROLS ──────────────────────────
window.toggleFlash = function() {
  const btn = document.getElementById('ctrlFlash');
  if (!btn) return;
  const isOn = btn.classList.contains('active');
  if (!_torchTrack) { showToast('Kamera belum aktif', 'error'); return; }
  const caps = _torchTrack.getCapabilities?.() || {};
  if (caps.torch) {
    _torchTrack.applyConstraints({ advanced: [{ torch: !isOn }] })
      .then(() => {
        btn.classList.toggle('active', !isOn);
        btn.querySelector('.ctrl-label').textContent = !isOn ? 'Flash ON' : 'Flash';
      })
      .catch(() => showToast('Flash tidak tersedia di device ini', 'error'));
  } else {
    showToast('Flash tidak tersedia di device ini', 'error');
  }
}

window.toggleZoom = function() {
  const btn = document.getElementById('ctrlZoom');
  if (!btn) return;
  if (!_torchTrack) { showToast('Kamera belum aktif', 'error'); return; }
  const caps = _torchTrack.getCapabilities?.() || {};
  if (!caps.zoom) { showToast('Zoom tidak tersedia di device ini', 'error'); return; }
  const levels = [1, 1.5, 2, 2.5];
  const idx    = levels.indexOf(_zoomLevel);
  _zoomLevel   = levels[(idx + 1) % levels.length];
  _torchTrack.applyConstraints({ advanced: [{ zoom: _zoomLevel }] })
    .then(() => {
      btn.classList.toggle('active', _zoomLevel > 1);
      btn.querySelector('.ctrl-label').textContent = _zoomLevel > 1 ? `${_zoomLevel}×` : 'Zoom';
    })
    .catch(() => showToast('Zoom tidak tersedia', 'error'));
}

window.toggleManualInput = function() {
  const panel = document.getElementById('manualInputPanel');
  const btn   = document.getElementById('ctrlManual');
  if (!panel || !btn) return;
  _manualOpen = !_manualOpen;
  panel.style.display = _manualOpen ? 'block' : 'none';
  btn.classList.toggle('active', _manualOpen);
  if (_manualOpen) {
    setTimeout(() => document.getElementById('manualBarcodeInput')?.focus(), 100);
  }
}

window.submitManualBarcode = function() {
  const input = document.getElementById('manualBarcodeInput');
  if (!input) return;
  const code = input.value.trim();
  if (!code) return;
  input.value = '';
  // Process same as scan
  const resultEl = document.getElementById('scannerResult');
  if (resultEl) resultEl.style.display = 'flex';
  const codeEl = document.getElementById('scannerResultCode');
  if (codeEl) codeEl.textContent = code;
  // Proses sama seperti scan
  scanCooldown    = false;
  lastScannedCode = null;
  _onDetected(code);
  // Tutup panel manual
  _manualOpen = false;
  const panel2 = document.getElementById('manualInputPanel');
  const btn2   = document.getElementById('ctrlManual');
  if (panel2) panel2.style.display = 'none';
  if (btn2)   btn2.classList.remove('active');
}
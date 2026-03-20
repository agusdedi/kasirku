/* =============================================
   SISTEM KASIR — app.js
   ============================================= */

// ── STATE ─────────────────────────────────────
let items        = [];   // daftar barang
let cart         = [];   // keranjang transaksi aktif
let transactions = [];   // riwayat transaksi
let kasirAktif   = null; // { name, shift, loginTime }

// ── INIT ──────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  renderItems();
  renderHistory();
  updateStats();
  setTodayDate();

  // Set filter date ke hari ini
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('filterDate').value = today;

  // Cek apakah kasir sudah login
  if (kasirAktif) {
    document.getElementById('kasirModal').classList.remove('active');
    updateKasirBar();
  }
  // Jika belum login, modal tetap tampil (sudah active by default)

  // Init responsive tab (mobile)
  if (window.innerWidth <= 768) {
    switchTab('barang');
  }
});

function setTodayDate() {
  const now = new Date();
  document.getElementById('currentDate').textContent =
    now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ── KASIR ─────────────────────────────────────
function loginKasir() {
  const name = document.getElementById('kasirNameInput').value.trim();
  const shift = document.querySelector('input[name="shift"]:checked').value;

  if (!name) {
    document.getElementById('kasirNameInput').focus();
    document.getElementById('kasirNameInput').style.borderColor = 'var(--red)';
    showToast('Nama kasir wajib diisi!', 'error');
    return;
  }

  kasirAktif = {
    name,
    shift,
    loginTime: new Date().toISOString(),
  };

  saveToStorage();
  updateKasirBar();
  document.getElementById('kasirModal').classList.remove('active');
  document.getElementById('kasirNameInput').style.borderColor = '';
  showToast(`Selamat bertugas, ${name}! 👋`);
}

function gantiKasir() {
  if (!confirm(`Ganti kasir dari "${kasirAktif?.name}"?\nSemua data transaksi tetap tersimpan.`)) return;
  kasirAktif = null;
  localStorage.removeItem('kasir_aktif');

  // Reset form login
  document.getElementById('kasirNameInput').value = '';
  document.querySelector('input[name="shift"][value="Pagi (06:00–14:00)"]').checked = true;
  document.getElementById('kasirModal').classList.add('active');
  setTimeout(() => document.getElementById('kasirNameInput').focus(), 100);
}

function updateKasirBar() {
  if (!kasirAktif) return;
  const initial = kasirAktif.name.charAt(0).toUpperCase();
  document.getElementById('kasirAvatar').textContent    = initial;
  document.getElementById('kasirNameDisplay').textContent = kasirAktif.name;
  document.getElementById('kasirShiftDisplay').textContent = kasirAktif.shift;
}


function saveToStorage() {
  localStorage.setItem('kasir_items',        JSON.stringify(items));
  localStorage.setItem('kasir_transactions', JSON.stringify(transactions));
  if (kasirAktif) localStorage.setItem('kasir_aktif', JSON.stringify(kasirAktif));
}

function loadFromStorage() {
  const i = localStorage.getItem('kasir_items');
  const t = localStorage.getItem('kasir_transactions');
  const k = localStorage.getItem('kasir_aktif');
  if (i) items        = JSON.parse(i);
  if (t) transactions = JSON.parse(t);
  if (k) kasirAktif   = JSON.parse(k);

  // Daftar barang dimulai kosong — tambahkan manual
}

// ── UTILS ─────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function formatRp(n) {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.className = 'toast', 2500);
}

// ── MANAJEMEN BARANG ──────────────────────────
function addItem() {
  const name     = document.getElementById('itemName').value.trim();
  const price    = parseFloat(document.getElementById('itemPrice').value);
  const stock    = parseInt(document.getElementById('itemStock').value) || 0;
  const category = document.getElementById('itemCategory').value.trim() || 'Umum';

  if (!name)        return showToast('Nama barang wajib diisi!', 'error');
  if (!price || price <= 0) return showToast('Harga harus lebih dari 0!', 'error');

  items.push({ id: uid(), name, price, stock, category });
  saveToStorage();
  renderItems();

  // Reset form
  cancelEdit();
  showToast(`"${name}" berhasil ditambahkan!`);
}

function deleteItem(id) {
  if (!confirm('Hapus barang ini?')) return;
  items = items.filter(i => i.id !== id);
  // Juga hapus dari keranjang jika ada
  cart  = cart.filter(c => c.itemId !== id);
  saveToStorage();
  renderItems();
  renderCart();
  recalculate();
}

function editItem(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  // Isi form dengan data barang yang dipilih
  document.getElementById('itemName').value     = item.name;
  document.getElementById('itemPrice').value    = item.price;
  document.getElementById('itemStock').value    = item.stock;
  document.getElementById('itemCategory').value = item.category;

  // Ganti tombol "Tambah" menjadi "Simpan Perubahan"
  const btn = document.querySelector('.btn-primary[onclick="addItem()"]');
  btn.textContent = '💾 Simpan Perubahan';
  btn.setAttribute('onclick', `saveEditItem('${id}')`);
  btn.style.background = 'var(--accent2)';
  document.getElementById('btnCancelEdit').style.display = 'block';

  // Scroll ke atas agar form terlihat
  document.querySelector('.sidebar').scrollTo({ top: 0, behavior: 'smooth' });
  showToast(`Edit mode: "${item.name}"`);
}

function saveEditItem(id) {
  const name     = document.getElementById('itemName').value.trim();
  const price    = parseFloat(document.getElementById('itemPrice').value);
  const stock    = parseInt(document.getElementById('itemStock').value) || 0;
  const category = document.getElementById('itemCategory').value.trim() || 'Umum';

  if (!name)            return showToast('Nama barang wajib diisi!', 'error');
  if (!price || price <= 0) return showToast('Harga harus lebih dari 0!', 'error');

  const item = items.find(i => i.id === id);
  if (!item) return;

  item.name     = name;
  item.price    = price;
  item.stock    = stock;
  item.category = category;

  // Update nama & harga di keranjang jika sedang ada
  cart.forEach(c => {
    if (c.itemId === id) { c.name = name; c.price = price; }
  });

  saveToStorage();
  renderItems();
  renderCart();
  recalculate();
  cancelEdit();
  showToast(`"${name}" berhasil diperbarui!`);
}

function cancelEdit() {
  ['itemName','itemPrice','itemStock','itemCategory'].forEach(id => {
    document.getElementById(id).value = '';
  });
  const btn = document.querySelector('.btn-primary');
  btn.textContent = '+ Tambah Barang';
  btn.setAttribute('onclick', 'addItem()');
  btn.style.background = '';
  document.getElementById('btnCancelEdit').style.display = 'none';
}

function renderItems() {
  const q    = document.getElementById('searchItem').value.toLowerCase();
  const list = document.getElementById('itemList');

  if (items.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:24px 12px;color:var(--muted)">
        <div style="font-size:32px;margin-bottom:8px">📦</div>
        <p style="font-size:12px;line-height:1.6">Belum ada barang.<br/>Tambahkan di form atas.</p>
      </div>`;
    return;
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
  );

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
        <div class="item-card-stock ${item.stock <= 5 ? 'low' : ''}">Stok: ${item.stock}</div>
        <div class="item-actions">
          <button class="btn-icon btn-edit"   onclick="editItem('${item.id}')"   title="Edit">✏️</button>
          <button class="btn-icon btn-delete" onclick="deleteItem('${item.id}')" title="Hapus">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');
}

// ── KERANJANG ─────────────────────────────────
function addToCart(itemId) {
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

  renderCart();
  recalculate();
  showToast(`${item.name} ditambahkan ke keranjang`);
}

function changeQty(itemId, delta) {
  const entry = cart.find(c => c.itemId === itemId);
  if (!entry) return;
  const item = items.find(i => i.id === itemId);

  entry.qty += delta;
  if (entry.qty <= 0) {
    cart = cart.filter(c => c.itemId !== itemId);
  } else if (item && entry.qty > item.stock) {
    entry.qty = item.stock;
    showToast('Stok tidak cukup!', 'error');
  }

  renderCart();
  recalculate();
}

function removeFromCart(itemId) {
  cart = cart.filter(c => c.itemId !== itemId);
  renderCart();
  recalculate();
}

function clearCart() {
  if (cart.length === 0) return;
  if (!confirm('Bersihkan semua item di keranjang?')) return;
  cart = [];
  document.getElementById('cashInput').value = '';
  document.getElementById('discountInput').value = '0';
  document.getElementById('customerName').value = '';
  renderCart();
  recalculate();
}

function renderCart() {
  const tbody = document.getElementById('cartBody');
  if (cart.length === 0) {
    tbody.innerHTML = `
      <tr id="emptyCart">
        <td colspan="5" class="empty-state">
          <div>🛍️</div>
          <p>Keranjang kosong.<br/>Klik barang di sebelah kiri untuk menambahkan.</p>
        </td>
      </tr>`;
    updateCartBadge();
    return;
  }

  tbody.innerHTML = cart.map(c => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td style="font-family:var(--font-mono);color:var(--muted)">${formatRp(c.price)}</td>
      <td>
        <div class="qty-control">
          <button class="qty-btn" onclick="changeQty('${c.itemId}', -1)">−</button>
          <span class="qty-value">${c.qty}</span>
          <button class="qty-btn" onclick="changeQty('${c.itemId}', 1)">+</button>
        </div>
      </td>
      <td class="subtotal-cell">${formatRp(c.price * c.qty)}</td>
      <td><button class="remove-btn" onclick="removeFromCart('${c.itemId}')">✕</button></td>
    </tr>
  `).join('');
  updateCartBadge();
}

// ── PERHITUNGAN ───────────────────────────────
function getSubtotal() {
  return cart.reduce((sum, c) => sum + c.price * c.qty, 0);
}

function getTotal() {
  const sub      = getSubtotal();
  const discount = parseFloat(document.getElementById('discountInput').value) || 0;
  return sub * (1 - discount / 100);
}

function recalculate() {
  document.getElementById('subtotalDisplay').textContent = formatRp(getSubtotal());
  document.getElementById('totalDisplay').textContent    = formatRp(getTotal());
  calcChange();
}

function calcChange() {
  const cash   = parseFloat(document.getElementById('cashInput').value) || 0;
  const total  = getTotal();
  const change = cash - total;
  const el     = document.getElementById('changeDisplay');
  el.textContent = formatRp(Math.abs(change));
  el.className   = 'change-amount' + (change < 0 ? ' negative' : '');
}

function setQuickCash(amount) {
  if (amount === 0) {
    // Nominal pas
    document.getElementById('cashInput').value = Math.ceil(getTotal());
  } else {
    // Tambahkan ke nominal yang ada
    const current = parseFloat(document.getElementById('cashInput').value) || 0;
    document.getElementById('cashInput').value = current + amount;
  }
  calcChange();
}

// ── PROSES TRANSAKSI ──────────────────────────
function processTransaction() {
  if (cart.length === 0) return showToast('Keranjang masih kosong!', 'error');

  const total    = getTotal();
  const cash     = parseFloat(document.getElementById('cashInput').value) || 0;
  const change   = cash - total;
  const discount = parseFloat(document.getElementById('discountInput').value) || 0;

  if (cash < total) return showToast('Uang tidak cukup!', 'error');

  const customer = document.getElementById('customerName').value.trim() || 'Umum';
  const now      = new Date();

  // Kurangi stok
  cart.forEach(c => {
    const item = items.find(i => i.id === c.itemId);
    if (item) item.stock -= c.qty;
  });

  // Buat transaksi
  const tx = {
    id:        'TRX-' + uid().toUpperCase(),
    date:      now.toISOString(),
    customer,
    kasir:     kasirAktif?.name  || 'Tidak diketahui',
    shift:     kasirAktif?.shift || '—',
    items:     JSON.parse(JSON.stringify(cart)),
    subtotal:  getSubtotal(),
    discount,
    total,
    cash,
    change,
  };
  transactions.push(tx);

  saveToStorage();
  showReceipt(tx);

  // Reset
  cart = [];
  document.getElementById('cashInput').value     = '';
  document.getElementById('discountInput').value = '0';
  document.getElementById('customerName').value  = '';

  renderCart();
  renderItems();
  renderHistory();
  updateStats();
  recalculate();

  showToast('Transaksi berhasil disimpan! ✓');
}

// ── STRUK ─────────────────────────────────────
function showReceipt(tx) {
  const date = new Date(tx.date);
  document.getElementById('receiptDate').textContent     = date.toLocaleString('id-ID');
  document.getElementById('receiptCustomer').textContent = 'Pelanggan: ' + tx.customer;
  document.getElementById('receiptKasir').textContent    = `Kasir: ${tx.kasir || '—'} | ${tx.shift || '—'}`;
  document.getElementById('receiptSubtotal').textContent  = formatRp(tx.subtotal);
  document.getElementById('receiptTotal').textContent     = formatRp(tx.total);
  document.getElementById('receiptCash').textContent      = formatRp(tx.cash);
  document.getElementById('receiptChange').textContent    = formatRp(tx.change);

  const discountRow = document.getElementById('receiptDiscountRow');
  if (tx.discount > 0) {
    discountRow.style.display = 'flex';
    document.getElementById('receiptDiscount').textContent = tx.discount + '%';
  } else {
    discountRow.style.display = 'none';
  }

  document.getElementById('receiptItems').innerHTML = tx.items.map(i => `
    <div class="receipt-item">
      <span class="receipt-item-name">${i.name} x${i.qty}</span>
      <span class="receipt-item-sub">${formatRp(i.price * i.qty)}</span>
    </div>
  `).join('');

  document.getElementById('receiptModal').classList.add('active');
}

function closeModal(e) {
  if (e.target.id === 'receiptModal') {
    document.getElementById('receiptModal').classList.remove('active');
  }
}

// ── DETAIL TRANSAKSI ──────────────────────────
function showDetailModal(txId) {
  const tx = transactions.find(t => t.id === txId);
  if (!tx) return;

  const date = new Date(tx.date);
  const totalQty = tx.items.reduce((s, i) => s + i.qty, 0);

  document.getElementById('detailId').textContent          = tx.id;
  document.getElementById('detailDate').textContent        = date.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('detailTime').textContent        = date.toLocaleTimeString('id-ID');
  document.getElementById('detailCustomer').textContent    = tx.customer;
  document.getElementById('detailTotalItems').textContent  = totalQty + ' item';
  document.getElementById('detailKasir').textContent       = tx.kasir  || '—';
  document.getElementById('detailShift').textContent       = tx.shift  || '—';
  document.getElementById('detailSubtotal').textContent    = formatRp(tx.subtotal);
  document.getElementById('detailTotal').textContent       = formatRp(tx.total);
  document.getElementById('detailCash').textContent        = formatRp(tx.cash);
  document.getElementById('detailChange').textContent      = formatRp(tx.change);

  // Diskon
  const discRow = document.getElementById('detailDiscountRow');
  if (tx.discount > 0) {
    discRow.style.display = 'flex';
    document.getElementById('detailDiscountLabel').textContent = `Diskon (${tx.discount}%)`;
    document.getElementById('detailDiscountVal').textContent   = '- ' + formatRp(tx.subtotal * tx.discount / 100);
  } else {
    discRow.style.display = 'none';
  }

  // Tabel item
  document.getElementById('detailTableBody').innerHTML = tx.items.map((item, idx) => `
    <tr>
      <td class="detail-num">${idx + 1}</td>
      <td class="detail-name">${item.name}</td>
      <td class="detail-price">${formatRp(item.price)}</td>
      <td class="detail-qty"><span class="qty-badge">${item.qty}</span></td>
      <td class="detail-subtotal">${formatRp(item.price * item.qty)}</td>
    </tr>
  `).join('');

  document.getElementById('detailModal').classList.add('active');
}

function closeDetailModal(e) {
  if (e.target.id === 'detailModal') {
    document.getElementById('detailModal').classList.remove('active');
  }
}

function printDetailReceipt() {
  window.print();
}

// ── RIWAYAT ───────────────────────────────────
function renderHistory() {
  const filterDate = document.getElementById('filterDate').value;
  const list       = document.getElementById('historyList');

  let filtered = transactions;
  if (filterDate) {
    filtered = transactions.filter(tx =>
      tx.date.startsWith(filterDate)
    );
  }

  filtered = [...filtered].reverse(); // terbaru di atas

  if (filtered.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:12px;text-align:center;padding:24px;">Belum ada transaksi</p>';
    return;
  }

  list.innerHTML = filtered.map(tx => {
    const d = new Date(tx.date);
    const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const totalItems = tx.items.reduce((s, i) => s + i.qty, 0);
    return `
      <div class="history-card" onclick="showDetailModal('${tx.id}')">
        <div class="history-card-top">
          <span class="history-id">${tx.id}</span>
          <span class="history-time">${time}</span>
        </div>
        <div class="history-customer">${tx.customer}</div>
        <div class="history-card-kasir">👨‍💼 ${tx.kasir || '—'} · ${tx.shift ? tx.shift.split(' ')[0] : '—'}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="history-items-count">${totalItems} item</span>
          <span class="history-total">${formatRp(tx.total)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function updateStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayTx = transactions.filter(tx => tx.date.startsWith(today));
  const revenue  = todayTx.reduce((s, tx) => s + tx.total, 0);

  document.getElementById('statCount').textContent   = todayTx.length;
  document.getElementById('statRevenue').textContent = formatRp(revenue);
}

// ── EXPORT EXCEL ──────────────────────────────
function exportExcel() {
  const filterDate = document.getElementById('filterDate').value;

  let filtered = transactions;
  if (filterDate) {
    filtered = transactions.filter(tx => tx.date.startsWith(filterDate));
  }

  if (filtered.length === 0) {
    return showToast('Tidak ada transaksi untuk diekspor!', 'error');
  }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Ringkasan Transaksi
  const summaryRows = filtered.map(tx => ({
    'ID Transaksi':  tx.id,
    'Tanggal':       new Date(tx.date).toLocaleDateString('id-ID'),
    'Waktu':         new Date(tx.date).toLocaleTimeString('id-ID'),
    'Kasir':         tx.kasir  || '—',
    'Shift':         tx.shift  || '—',
    'Customer':      tx.customer,
    'Subtotal':      tx.subtotal,
    'Diskon (%)':    tx.discount,
    'Total':         tx.total,
    'Uang Diterima': tx.cash,
    'Kembalian':     tx.change,
    'Jml Item':      tx.items.reduce((s, i) => s + i.qty, 0),
  }));
  const ws1 = XLSX.utils.json_to_sheet(summaryRows);
  ws1['!cols'] = [
    {wch:18},{wch:12},{wch:10},{wch:16},{wch:20},
    {wch:16},{wch:14},{wch:10},{wch:14},{wch:14},{wch:12},{wch:10}
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan');

  // ── Sheet 2: Detail per Item
  const detailRows = [];
  filtered.forEach(tx => {
    tx.items.forEach(item => {
      detailRows.push({
        'ID Transaksi': tx.id,
        'Tanggal':      new Date(tx.date).toLocaleDateString('id-ID'),
        'Waktu':        new Date(tx.date).toLocaleTimeString('id-ID'),
        'Customer':     tx.customer,
        'Nama Barang':  item.name,
        'Harga Satuan': item.price,
        'Qty':          item.qty,
        'Subtotal':     item.price * item.qty,
      });
    });
  });
  const ws2 = XLSX.utils.json_to_sheet(detailRows);
  ws2['!cols'] = [{wch:18},{wch:12},{wch:10},{wch:14},{wch:20},{wch:14},{wch:6},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Detail Item');

  // ── Sheet 3: Rekap Harian
  const byDate = {};
  filtered.forEach(tx => {
    const d = tx.date.split('T')[0];
    if (!byDate[d]) byDate[d] = { count: 0, revenue: 0 };
    byDate[d].count++;
    byDate[d].revenue += tx.total;
  });
  const rekapRows = Object.entries(byDate).map(([date, v]) => ({
    'Tanggal':          date,
    'Jml Transaksi':    v.count,
    'Total Pendapatan': v.revenue,
  }));
  const ws3 = XLSX.utils.json_to_sheet(rekapRows);
  ws3['!cols'] = [{wch:14},{wch:16},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws3, 'Rekap Harian');

  // Download
  const filename = `laporan-kasir-${filterDate || 'semua'}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast(`File "${filename}" berhasil didownload!`);
}

// ── RESPONSIVE: TAB SWITCHING (Mobile) ────────
function switchTab(tabName) {
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) return;

  // Semua panel
  document.querySelectorAll('.sidebar, .main, .history-panel').forEach(el => {
    el.classList.remove('tab-active');
  });

  // Aktifkan panel yang dipilih
  const tabMap = {
    'barang':    '.sidebar',
    'transaksi': '.main',
    'riwayat':   '.history-panel',
  };
  const target = document.querySelector(tabMap[tabName]);
  if (target) target.classList.add('tab-active');

  // Update active state bottom nav
  document.querySelectorAll('.bnav-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById('tab-' + tabName);
  if (activeBtn) activeBtn.classList.add('active');
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  const btnGoToCart = document.getElementById('btnGoToCart');
  const cartCount = document.getElementById('cartCount');
  const totalQty = cart.reduce((s, c) => s + c.qty, 0);

  if (badge) {
    if (totalQty > 0) {
      badge.style.display = 'block';
      badge.textContent = totalQty > 99 ? '99+' : totalQty;
    } else {
      badge.style.display = 'none';
    }
  }

  if (btnGoToCart && cartCount) {
    const isMobile = window.innerWidth <= 768;
    if (totalQty > 0 && isMobile) {
      btnGoToCart.style.display = 'block';
      cartCount.textContent = totalQty;
    } else {
      btnGoToCart.style.display = 'none';
    }
  }
}

// ── TABLET: Toggle history panel ──────────────
function toggleHistory() {
  const panel = document.querySelector('.history-panel');
  panel.classList.toggle('panel-open');
}

// Init responsive pada load
window.addEventListener('resize', () => {
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) {
    // Reset semua panel ke tampilan normal
    document.querySelectorAll('.sidebar, .main, .history-panel').forEach(el => {
      el.classList.remove('tab-active');
    });
  } else {
    // Pastikan ada satu tab aktif
    const hasActive = document.querySelector('.sidebar.tab-active, .main.tab-active, .history-panel.tab-active');
    if (!hasActive) switchTab('barang');
  }
});
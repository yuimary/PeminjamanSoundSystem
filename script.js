const LIMIT_PER_DAY = 3;
let bookings = [];
let chartMode = 'harian';

/* ============================================================
   FIREBASE: inisialisasi Auth (login) + Firestore (database)
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyB87QOIO4_HD3MGKxoD31fCT7OT_F8oHM8",
  authDomain: "peminjaman-sound-system-33041.firebaseapp.com",
  projectId: "peminjaman-sound-system-33041",
  storageBucket: "peminjaman-sound-system-33041.firebasestorage.app",
  messagingSenderId: "94049502443",
  appId: "1:94049502443:web:bcfe5831198750668daaae"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const bookingsCol = db.collection('bookings');

let bookingsUnsubscribe = null;
let migrationChecked = false;

function translateFirebaseAuthError(code){
  const map = {
    'auth/invalid-email': 'Format email tidak valid.',
    'auth/user-not-found': 'Email tidak terdaftar.',
    'auth/wrong-password': 'Password salah.',
    'auth/invalid-credential': 'Email atau password salah.',
    'auth/too-many-requests': 'Terlalu banyak percobaan gagal. Coba lagi beberapa saat.',
    'auth/network-request-failed': 'Koneksi internet bermasalah.'
  };
  return map[code] || ('Terjadi kesalahan (' + code + ').');
}

function handleAdminLogin(){
  const email = document.getElementById('f-admin-user').value.trim();
  const pass = document.getElementById('f-admin-pass').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-admin-login');

  if(!email || !pass){
    errEl.textContent = 'Email dan password wajib diisi.';
    return;
  }

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Memproses...';

  auth.signInWithEmailAndPassword(email, pass)
    .catch(err => {
      console.error(err);
      errEl.textContent = translateFirebaseAuthError(err.code);
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Login';
    });
}

function handleLogout(){
  auth.signOut();
}

// Satu-satunya sumber kebenaran soal status login: dipicu Firebase
// setiap kali status auth berubah (login, logout, atau sesi dipulihkan
// otomatis saat reload halaman).
auth.onAuthStateChanged(user => {
  if(user){
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('main-shell').style.display = '';
    switchView('dashboard');
    startBookingsListener();
  }else{
    document.getElementById('login-overlay').style.display = '';
    document.getElementById('main-shell').style.display = 'none';
    if(bookingsUnsubscribe){ bookingsUnsubscribe(); bookingsUnsubscribe = null; }
    bookings = [];
  }
});

// Dengarkan perubahan data booking secara real-time dari Firestore.
// Begitu ada perubahan (dari device mana pun), tabel/grafik/dashboard
// otomatis ke-render ulang tanpa perlu refresh halaman.
function startBookingsListener(){
  if(bookingsUnsubscribe) return; // sudah jalan, jangan dobel
  bookingsUnsubscribe = bookingsCol.onSnapshot(async snapshot => {
    bookings = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));

    if(bookings.length === 0 && !migrationChecked){
      migrationChecked = true;
      await maybeMigrateOldLocalData();
    }

    renderTable();
    renderChart();
    renderDashboard();
    checkDateStatus();
  }, err => {
    console.error(err);
    alert('Gagal memuat data dari database: ' + err.message);
  });
}

// Migrasi sekali jalan: kalau browser ini masih menyimpan data lama di
// localStorage (dari sebelum pindah ke database) dan Firestore-nya masih
// kosong, tawarkan untuk memindahkan datanya supaya tidak hilang.
const OLD_LOCAL_STORAGE_KEY = 'sound_system_bookings';
async function maybeMigrateOldLocalData(){
  let old = [];
  try{
    const raw = localStorage.getItem(OLD_LOCAL_STORAGE_KEY);
    old = raw ? JSON.parse(raw) : [];
  }catch(e){ old = []; }
  if(!old || old.length === 0) return;

  const ok = confirm(`Ditemukan ${old.length} data peminjaman lama tersimpan di browser ini (dari sebelum pakai database). Mau dipindahkan otomatis ke database sekarang?`);
  if(!ok) return;

  const CHUNK = 400;
  try{
    for(let i = 0; i < old.length; i += CHUNK){
      const batch = db.batch();
      old.slice(i, i + CHUNK).forEach(b => {
        const { id, ...rest } = b;
        batch.set(bookingsCol.doc(), rest);
      });
      await batch.commit();
    }
    alert(`Berhasil memindahkan ${old.length} data lama ke database.`);
  }catch(err){
    console.error(err);
    alert('Gagal memindahkan data lama: ' + err.message);
  }
}

// Daftar view yang ada di sidebar, beserta fungsi render yang perlu dipanggil
// tiap kali view itu dibuka (biar datanya selalu fresh).
const VIEW_RENDERERS = {
  dashboard: () => renderDashboard(),
  catat: () => {},
  rekap: () => { renderTable(); },
  grafik: () => { renderChart(); },
};

function switchView(viewName){
  Object.keys(VIEW_RENDERERS).forEach(name => {
    const el = document.getElementById('view-' + name);
    if(el) el.style.display = (name === viewName) ? '' : 'none';
  });
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  if(VIEW_RENDERERS[viewName]) VIEW_RENDERERS[viewName]();

  // Scroll ke atas tiap pindah menu, biar nggak nyangkut di posisi scroll lama
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* ============================================================
   KONFIGURASI GOOGLE SHEETS
   Isi CLIENT_ID dan API_KEY dari Google Cloud Console kamu.
   Panduan lengkap ada di file SETUP_GOOGLE_SHEETS.md
   Login Google TIDAK dipicu di awal — baru muncul saat user
   klik tombol "Buka di Google Sheets".
   ============================================================ */
const GOOGLE_CONFIG = {
  CLIENT_ID: '390061838390-kpj1vr6pdg6t87oqltus5csg986p1hni.apps.googleusercontent.com',
  API_KEY: 'AIzaSyD4cl0Gs9kOulidipM9BDy02N9G5sL2jcw'
};
const GOOGLE_DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

let gapiInited = false;
let gisInited = false;
let googleTokenClient = null;

// Dipanggil otomatis begitu https://apis.google.com/js/api.js selesai load.
// Ini hanya menyiapkan koneksi di belakang layar, TIDAK menampilkan popup login apa pun.
function gapiLoaded(){
  gapi.load('client', initializeGapiClient);
}
async function initializeGapiClient(){
  await gapi.client.init({
    apiKey: GOOGLE_CONFIG.API_KEY,
    discoveryDocs: [GOOGLE_DISCOVERY_DOC],
  });
  gapiInited = true;
}

window.onload = function(){
  // Reset checkbox jenis kegiatan biar tidak ke-restore otomatis oleh
  // browser (bfcache/form restore) saat halaman dimuat ulang.
  const pasangEl = document.getElementById('f-act-pasang');
  const acaraEl = document.getElementById('f-act-acara');
  const bongkarEl = document.getElementById('f-act-bongkar');
  if(pasangEl) pasangEl.checked = false;
  if(acaraEl) acaraEl.checked = false;
  if(bongkarEl) bongkarEl.checked = false;

  if(typeof gapi !== 'undefined') gapiLoaded();
  if(typeof google !== 'undefined' && google.accounts){
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: '', // diisi ulang saat dipakai
    });
    gisInited = true;
  }
  // Data booking sekarang dimuat lewat startBookingsListener(), yang
  // dipicu otomatis oleh auth.onAuthStateChanged() setelah user login.
};

// Meminta login/izin Google HANYA saat dipanggil (misal saat klik "Buka di Google Sheets").
// Mengembalikan Promise yang selesai begitu token didapat.
function requestGoogleAccess(){
  return new Promise((resolve, reject) => {
    if(GOOGLE_CONFIG.CLIENT_ID.startsWith('GANTI_') || GOOGLE_CONFIG.API_KEY.startsWith('GANTI_')){
      reject(new Error('CLIENT_ID / API_KEY Google belum diisi di script.js.'));
      return;
    }
    if(!gapiInited || !gisInited || !googleTokenClient){
      reject(new Error('Layanan Google belum siap dimuat, coba refresh halaman.'));
      return;
    }
    // Kalau sudah pernah login dan tokennya masih ada, langsung lanjut tanpa nanya lagi
    if(gapi.client.getToken()){
      resolve();
      return;
    }
    googleTokenClient.callback = (resp) => {
      if(resp.error){
        reject(new Error('Login Google gagal atau dibatalkan.'));
        return;
      }
      gapi.client.setToken(resp);
      resolve();
    };
    googleTokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

function fmtDateID(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
}

function renderDashboard(){
  const statsWrap = document.getElementById('dashboard-stats');
  const upcomingWrap = document.getElementById('dash-upcoming-wrap');
  if(!statsWrap || !upcomingWrap) return;

  const todayStr = new Date().toISOString().slice(0,10);
  const currentYM = todayStr.slice(0,7);

  if(bookings.length === 0){
    statsWrap.innerHTML = `<div class="dash-empty" style="grid-column: 1/-1;">
      <p>Belum ada data peminjaman.</p>
    </div>`;
    upcomingWrap.innerHTML = `<p class="empty-note">Tidak ada kegiatan dalam 7 hari ke depan.</p>`;
    return;
  }

  // Hitung statistik untuk 3 kotak di atas
  const bulanIniBookings = bookings.filter(b => b.date.slice(0,7) === currentYM);
  const totalBulanIni = bulanIniBookings.length;

  const byDateBulanIni = {};
  bulanIniBookings.forEach(b => {
    byDateBulanIni[b.date] = (byDateBulanIni[b.date] || 0) + 1;
  });
  const hariPenuh = Object.values(byDateBulanIni).filter(c => c >= LIMIT_PER_DAY).length;

  // Render 3 Kartu Statistik di Atas
  const fullDates = Object.keys(byDateBulanIni).filter(d => byDateBulanIni[d] >= LIMIT_PER_DAY).sort();

  let statsHtml = '';
  statsHtml += `<div class="stat-card stat-blue stat-clickable" onclick="goToMonthInRekap('${currentYM}')">
    <div class="stat-icon">${ICON_CALENDAR}</div>
    <div class="stat-body">
      <div class="stat-value">${totalBulanIni}</div>
      <div class="stat-label">Kegiatan bulan ini</div>
    </div>
  </div>`;
  statsHtml += `<div class="stat-card ${hariPenuh > 0 ? 'stat-red' : 'stat-green'} ${hariPenuh > 0 ? 'stat-clickable' : ''}" ${hariPenuh > 0 ? `onclick="toggleFullDaysPanel()"` : ''}>
    <div class="stat-icon">${ICON_ALERT}</div>
    <div class="stat-body">
      <div class="stat-value">${hariPenuh}</div>
      <div class="stat-label">Hari sudah penuh</div>
    </div>
  </div>`;

  if(fullDates.length > 0){
    statsHtml += `<div id="full-days-panel" class="full-days-panel">
      <div class="full-days-panel-header">
        <div class="full-days-panel-title">Tanggal yang sudah penuh bulan ini</div>
        <button type="button" class="full-days-panel-close" onclick="event.stopPropagation(); closeFullDaysPanel()">&times;</button>
      </div>
      <div class="full-days-list">`;
    fullDates.forEach(d => {
      const dd = new Date(d + 'T00:00:00');
      const label = dd.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long' });
      statsHtml += `<button type="button" class="full-day-item" onclick="event.stopPropagation(); goToDateInRekap('${d}')">
        <span>${label}</span>
        <span class="full-day-count">${byDateBulanIni[d]}/${LIMIT_PER_DAY}</span>
      </button>`;
    });
    statsHtml += `</div></div>`;
  }

  statsWrap.innerHTML = statsHtml;

  // Filter kegiatan 7 hari ke depan
  const in7Days = new Date();
  in7Days.setDate(in7Days.getDate() + 7);
  const in7DaysStr = in7Days.toISOString().slice(0,10);

  const upcomingRaw = bookings
    .filter(b => b.date >= todayStr && b.date <= in7DaysStr)
    .sort((a,b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));

  // Gabungkan kegiatan yang berada di tanggal yang sama
  const groupedByDate = {};
  upcomingRaw.forEach(b => {
    if(!groupedByDate[b.date]) groupedByDate[b.date] = [];
    groupedByDate[b.date].push(b);
  });

  const datesList = Object.keys(groupedByDate);

  if(datesList.length > 0){
    let upHtml = '<div class="upcoming-list">';
    datesList.forEach(date => {
      const items = groupedByDate[date];
      const d = new Date(date + 'T00:00:00');
      const dayNum = d.getDate();
      const monthShort = d.toLocaleDateString('id-ID', { month:'short' }).toUpperCase();
      const dayName = d.toLocaleDateString('id-ID', { weekday:'long' });

      // Buat daftar kegiatan dalam 1 tanggal tersebut, tiap kegiatan jadi box terpisah
      let subItemsHtml = items.map(b => `
        <div class="upcoming-subitem">
          <div class="upcoming-title" style="font-size:0.98rem;">${escapeHtml(b.acara)}</div>
          <div class="upcoming-meta">${b.time ? 'Jam ' + b.time : ''}${b.tempat ? ' \u2022 ' + escapeHtml(b.tempat) : ''}${b.pemohon ? ' \u2022 ' + escapeHtml(b.pemohon) : ''}</div>
        </div>
      `).join('');

      upHtml += `<div class="upcoming-item" style="align-items:flex-start;">
        <div class="upcoming-badge">
          <span class="upcoming-badge-day">${dayNum}</span>
          <span class="upcoming-badge-month">${monthShort}</span>
        </div>
        <div class="upcoming-info" style="width:100%;">
          <div style="font-weight:700; color:var(--navy); font-size:0.9rem; margin-bottom:4px;">${dayName}, ${d.getDate()} ${MONTH_NAMES_FULL_ID[d.getMonth()]} ${d.getFullYear()}</div>
          ${subItemsHtml}
        </div>
      </div>`;
    });
    upHtml += '</div>';
    upcomingWrap.innerHTML = upHtml;
  }else{
    upcomingWrap.innerHTML = `<div class="dash-empty dash-empty-small">
      <div class="dash-empty-icon">${ICON_CHECK}</div>
      <p>Tidak ada kegiatan dalam 7 hari ke depan.</p>
    </div>`;
  }
}

const ICON_CALENDAR = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3 9.5H21" stroke="currentColor" stroke-width="1.8"/><path d="M8 3V6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 3V6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ICON_ALERT = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5L21.5 20H2.5L12 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10V14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.3" r="0.9" fill="currentColor"/></svg>`;
const ICON_WRENCH = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.5 2.5-2.6-.6-.6-2.6 2.6-2.6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M8 12.5L10.8 15.3L16 9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function countForDate(dateStr){
  return bookings.filter(b => b.date === dateStr).length;
}

let editingId = null; // null = mode tambah baru, ada isi = lagi edit booking ini

function checkDateStatus(){
  const date = document.getElementById('f-date').value;
  const time = document.getElementById('f-time').value;
  const line = document.getElementById('status-line');
  const btn = document.getElementById('submit-btn');
  if(!date){
    line.className = '';
    btn.disabled = false;
    return;
  }
  // Saat mode edit, jangan hitung booking yang sedang diedit itu sendiri
  const relevantBookings = bookings.filter(b => b.date === date && b.id !== editingId);
  const count = relevantBookings.length;

  line.classList.add('show');

  // Cek bentrok jam (kalau waktu sudah diisi)
  const bentrok = time ? relevantBookings.find(b => b.time === time) : null;

  if(count >= LIMIT_PER_DAY){
    line.className = 'show full';
    line.textContent = `Tanggal ${fmtDateID(date)} sudah penuh (${count}/${LIMIT_PER_DAY} kegiatan). Pilih tanggal lain.`;
    btn.disabled = true;
  }else if(bentrok){
    line.className = 'show full';
    line.textContent = `\u26A0\uFE0F Jam ${time} di tanggal ini sudah dipakai kegiatan "${bentrok.acara}". Cek lagi jadwalnya.`;
    btn.disabled = false; // tetap boleh disimpan, cuma diperingatkan
  }else{
    line.className = 'show ok';
    line.textContent = `Tanggal ${fmtDateID(date)}: ${count}/${LIMIT_PER_DAY} kegiatan terisi. Masih tersedia.`;
    btn.disabled = false;
  }
}

function resetForm(){
  editingId = null;
  document.getElementById('f-date').value = '';
  document.getElementById('f-time').value = '';
  document.getElementById('f-pemohon').value = '';
  document.getElementById('f-acara').value = '';
  document.getElementById('f-tempat').value = '';
  document.getElementById('f-surat').value = '';
  document.getElementById('f-suratmasuk').value = '';
  document.getElementById('f-act-pasang').checked = false;
  document.getElementById('f-act-acara').checked = false;
  document.getElementById('f-act-bongkar').checked = false;
  document.getElementById('f-status').value = 'Proses';
  document.getElementById('submit-btn').textContent = 'Simpan Peminjaman';
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if(cancelBtn) cancelBtn.style.display = 'none';
  const catatTitle = document.querySelector('#view-catat .panel h2');
  if(catatTitle) catatTitle.textContent = 'Catat Peminjaman Baru';
  checkDateStatus();
}

function startEditBooking(id){
  const b = bookings.find(x => x.id === id);
  if(!b) return;
  editingId = id;

  switchView('catat');

  document.getElementById('f-date').value = b.date;
  document.getElementById('f-time').value = b.time || '';
  document.getElementById('f-pemohon').value = b.pemohon || '';
  document.getElementById('f-acara').value = b.acara || '';
  document.getElementById('f-tempat').value = b.tempat || '';
  document.getElementById('f-surat').value = b.surat || '';
  document.getElementById('f-suratmasuk').value = b.suratmasuk || '';
  document.getElementById('f-act-pasang').checked = b.actPasang !== false;
  document.getElementById('f-act-acara').checked = b.actAcara !== false;
  document.getElementById('f-act-bongkar').checked = b.actBongkar !== false;
  document.getElementById('f-status').value = b.status || 'Proses';

  document.getElementById('submit-btn').textContent = 'Update Peminjaman';
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if(cancelBtn) cancelBtn.style.display = '';
  const catatTitle = document.querySelector('#view-catat .panel h2');
  if(catatTitle) catatTitle.textContent = 'Edit Peminjaman';

  checkDateStatus();
}

/* ============================================================
   UPLOAD SURAT (PDF) -> ISI FORM OTOMATIS
   File PDF dikirim ke Netlify Function "extract-surat" (yang meneruskan
   ke Claude API di server, supaya API key tidak pernah kelihatan di
   browser), lalu hasil ekstraksinya dipakai untuk mengisi form Catat
   Peminjaman. Data yang terisi HARUS tetap dicek manual oleh pengguna
   sebelum disimpan - fungsi ini tidak pernah langsung menyimpan ke
   database sendiri.
   ============================================================ */
function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Gagal membaca file.'));
    reader.readAsDataURL(file);
  });
}

function fillFormFromExtractedSurat(d){
  if(!d) return;
  if(d.tanggal) document.getElementById('f-date').value = d.tanggal;
  if(d.waktu) document.getElementById('f-time').value = d.waktu;
  document.getElementById('f-pemohon').value = 'Team Sound';
  if(d.acara) document.getElementById('f-acara').value = d.acara;
  if(d.tempat) document.getElementById('f-tempat').value = d.tempat;
  if(d.nomor_surat) document.getElementById('f-surat').value = d.nomor_surat;
  checkDateStatus();
}

async function handleSuratPdfUpload(event){
  const file = event.target.files[0];
  const statusEl = document.getElementById('pdf-upload-status');
  if(!file) return;

  if(file.type !== 'application/pdf'){
    statusEl.className = 'pdf-upload-status full';
    statusEl.textContent = 'File harus berupa PDF.';
    event.target.value = '';
    return;
  }

  statusEl.className = 'pdf-upload-status';
  statusEl.textContent = 'Membaca isi surat, mohon tunggu...';

  try{
    const base64 = await fileToBase64(file);
    const resp = await fetch('/api/extract-surat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: base64 })
    });
    const result = await resp.json().catch(() => ({}));

    if(!resp.ok || !result.ok){
      throw new Error(result.error || 'Gagal membaca surat.');
    }

    fillFormFromExtractedSurat(result.data);

    const kosong = Object.entries(result.data || {}).filter(([, v]) => !v).map(([k]) => k);
    statusEl.className = 'pdf-upload-status ok';
    statusEl.textContent = kosong.length > 0
      ? `Data terisi otomatis. Ada beberapa info yang tidak ditemukan di surat (${kosong.join(', ')}) - cek & lengkapi manual sebelum simpan.`
      : 'Data berhasil diisi otomatis. Tetap cek dulu sebelum klik "Simpan Peminjaman".';
  }catch(err){
    console.error(err);
    statusEl.className = 'pdf-upload-status full';
    statusEl.textContent = 'Gagal membaca surat: ' + err.message + ' Silakan isi form secara manual.';
  }finally{
    event.target.value = '';
  }
}

async function submitBooking(){
  const date = document.getElementById('f-date').value;
  const time = document.getElementById('f-time').value;
  const pemohon = document.getElementById('f-pemohon').value.trim();
  const acara = document.getElementById('f-acara').value.trim();
  const tempat = document.getElementById('f-tempat').value.trim();
  const surat = document.getElementById('f-surat').value.trim();
  const suratmasuk = document.getElementById('f-suratmasuk').value.trim();
  const actPasang = document.getElementById('f-act-pasang').checked;
  const actAcara = document.getElementById('f-act-acara').checked;
  const actBongkar = document.getElementById('f-act-bongkar').checked;
  const status = document.getElementById('f-status').value;

  if(!date || !acara){
    alert('Tanggal dan Kegiatan/Acara wajib diisi.');
    return;
  }

  // Hitung limit tanpa termasuk booking yang lagi diedit
  const countExcludingSelf = bookings.filter(b => b.date === date && b.id !== editingId).length;
  if(countExcludingSelf >= LIMIT_PER_DAY){
    alert('Tanggal ini sudah mencapai batas 3 kegiatan. Peminjaman ditolak otomatis.');
    return;
  }

  // Cek bentrok jam di tanggal yang sama (kecuali booking yang lagi diedit)
  if(time){
    const bentrok = bookings.find(b => b.date === date && b.time === time && b.id !== editingId);
    if(bentrok){
      const konfirmasi1 = confirm(`\u26A0\uFE0F Jam ${time} di tanggal ${fmtDateID(date)} sudah dipakai kegiatan "${bentrok.acara}".\n\nYakin mau tetap simpan jadwal yang bentrok ini?`);
      if(!konfirmasi1) return;

      const konfirmasi2 = confirm(`Konfirmasi sekali lagi: benar-benar yakin ingin menyimpan meskipun jamnya bentrok?\n\nKlik OK untuk tetap lanjut, atau Cancel untuk membatalkan.`);
      if(!konfirmasi2) return;
    }
  }

  const payload = { date, time, pemohon, acara, tempat, surat, suratmasuk, actPasang, actAcara, actBongkar, status };
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;

  try{
    if(editingId){
      await bookingsCol.doc(editingId).update(payload);
    }else{
      await bookingsCol.add(payload);
    }
    resetForm();
    // Tidak perlu panggil renderTable/renderChart/renderDashboard manual di
    // sini -- listener Firestore (onSnapshot) otomatis re-render begitu
    // datanya berubah, dari device mana pun.
  }catch(err){
    console.error(err);
    alert('Gagal menyimpan ke database: ' + err.message);
  }finally{
    btn.disabled = false;
  }
}

function cancelEdit(){
  resetForm();
}

function deleteBooking(id){
  bookingsCol.doc(id).delete().catch(err => {
    console.error(err);
    alert('Gagal menghapus dari database: ' + err.message);
  });
  if(editingId === id) resetForm(); // kalau yang lagi diedit dihapus, keluar dari mode edit
}

// Ganti status langsung dari dropdown di tabel Rekap, tanpa perlu masuk mode edit
function updateBookingStatus(id, newStatus){
  bookingsCol.doc(id).update({ status: newStatus }).catch(err => {
    console.error(err);
    alert('Gagal mengubah status: ' + err.message);
  });
}

function clearSearch(){
  document.getElementById('search-date').value = '';
  document.getElementById('search-text').value = '';
  renderTable();
}

const MONTH_NAMES_FULL_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DAY_NAMES_ID = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

/* ============================================================
   IMPORT DATA HISTORIS DARI EXCEL
   Membaca file Excel format lama "AGENDA SOUND SYSTEM" (judul,
   BULAN <nama> <tahun>, header NO/WAKTU/PEMASANGAN/ACARA/
   PEMBONGKARAN/KEGIATAN/YANG MENGHADIRI/TEMPAT/NO SURAT, lalu
   pita tanggal per kelompok kegiatan) dan memasukkan datanya ke
   bookings, supaya histori tahun-tahun sebelumnya ikut masuk ke
   Rekap Peminjaman & Grafik.
   ============================================================ */
function handleImportHistorisFile(event){
  const file = event.target.files[0];
  event.target.value = ''; // reset supaya file yang sama bisa dipilih lagi nanti
  if(!file) return;

  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const parsed = parseHistorisWorkbook(wb);
      if(parsed.length === 0){
        alert('Tidak ada data yang bisa dikenali dari file ini. Pastikan formatnya sesuai file AGENDA SOUND SYSTEM (ada header NO/WAKTU SESUAI SURAT/PEMASANGAN/ACARA/PEMBONGKARAN/KEGIATAN/YANG MENGHADIRI/TEMPAT/NO SURAT, dan baris tanggal per kelompok kegiatan).');
        return;
      }
      importParsedBookings(parsed);
    }catch(err){
      console.error(err);
      alert('Gagal membaca file: ' + (err.message || err));
    }
  };
  reader.readAsArrayBuffer(file);
}

function normalizeHeaderCell(v){
  return String(v == null ? '' : v).trim().toUpperCase();
}

function isRowBlank(row){
  return row.every(c => String(c == null ? '' : c).trim() === '');
}

// Cari kolom-kolom penting dari 1 baris header berdasarkan TEKS-nya
// (bukan posisi tetap), supaya toleran kalau urutan/posisi kolom
// beda-beda antar bulan di file lama.
function mapHeaderColumns(headerRow){
  const map = {};
  headerRow.forEach((cell, idx) => {
    const t = normalizeHeaderCell(cell);
    if(t === 'WAKTU SESUAI SURAT') map.waktu = idx;
    else if(t === 'STATUS') map.status = idx;
    else if(t === 'PEMASANGAN') map.pasang = idx;
    else if(t === 'ACARA') map.acara = idx;
    else if(t === 'PEMBONGKARAN') map.bongkar = idx;
    else if(t.indexOf('KEGIATAN') !== -1) map.kegiatan = idx;
    else if(t.indexOf('MENGHADIRI') !== -1) map.pemohon = idx;
    else if(t === 'TEMPAT') map.tempat = idx;
    else if(t.indexOf('NO SURAT') !== -1) map.surat = idx;
    else if(t === 'ID') map.id = idx;
  });
  return map;
}

// Normalisasi teks status dari spreadsheet ("selesai", "SELESAI ", dll)
// jadi salah satu dari 3 nilai baku yang dipakai app. Default ke 'Proses'
// kalau kosong/tidak dikenali.
function normalizeStatusCell(v){
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if(s === 'selesai') return 'Selesai';
  if(s === 'batal') return 'Batal';
  if(s === 'proses') return 'Proses';
  return 'Proses';
}

function looksLikeHeaderRow(row){
  const norm = row.map(normalizeHeaderCell);
  return norm.includes('NO') && norm.some(t => t.indexOf('KEGIATAN') !== -1) && norm.some(t => t === 'PEMASANGAN' || t === 'ACARA');
}

// Singkatan bulan yang umum dipakai di file agenda (mis. template baru
// pakai "Sept", "Ags", dst, bukan nama bulan lengkap). Dipetakan manual
// untuk kasus yang tidak sekadar "3 huruf pertama" (Mei tetap "Mei",
// Agustus punya beberapa varian singkatan, dst).
const MONTH_ABBR_ID = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, jun: 5,
  jul: 6, agu: 7, ags: 7, agt: 7, sep: 8, sept: 8,
  okt: 9, nov: 10, des: 11
};

// Cari index bulan (0-11) dari teks nama bulan, toleran terhadap nama
// lengkap ("September"), singkatan umum ("Sept", "Ags"), atau singkatan
// 3-huruf generik lain yang belum ada di daftar manual di atas.
function monthIndexFromName(monthName){
  const s = String(monthName || '').trim().toLowerCase();
  if(!s) return -1;
  let idx = MONTH_NAMES_FULL_ID.findIndex(mn => mn.toLowerCase() === s);
  if(idx !== -1) return idx;
  if(Object.prototype.hasOwnProperty.call(MONTH_ABBR_ID, s)) return MONTH_ABBR_ID[s];
  const s3 = s.slice(0, 3);
  idx = MONTH_NAMES_FULL_ID.findIndex(mn => mn.toLowerCase().slice(0, 3) === s3);
  return idx;
}

// Parse baris pita tanggal, misal "Sabtu ,6 Juni 2026" atau "Selasa ,1 Sept 2026"
// jadi ISO YYYY-MM-DD. Toleran terhadap spasi/koma yang tidak konsisten dan
// nama bulan singkatan. Return null kalau tidak cocok pola sama sekali
// (dianggap bukan pita tanggal).
function parseDayBandLabel(cellValue){
  const s = String(cellValue == null ? '' : cellValue).trim();
  if(!s) return null;
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if(!m) return null;
  const day = parseInt(m[1], 10);
  const year = parseInt(m[3], 10);
  const monthIdx = monthIndexFromName(m[2]);
  if(monthIdx === -1 || !day || !year) return null;
  const mm = String(monthIdx + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// Simbol yang dianggap "centang" di kolom Pemasangan/Acara/Pembongkaran.
// '√' (U+221A, root sign) dipakai di file agenda; ✓/✔/☑ ditambahkan
// sebagai variasi visual yang mungkin dipakai di file lain. Isi sel selain
// simbol-simbol ini (kosong, "-", "x", catatan bebas, dll) TIDAK dianggap
// tercentang, supaya tidak salah kebaca kalau ada isian lain di kolom itu.
const CHECK_MARK_SYMBOLS = ['√', '✓', '✔', '☑'];
function cellHasMark(v){
  const s = String(v == null ? '' : v).trim();
  return CHECK_MARK_SYMBOLS.includes(s);
}

function normalizeWaktuCell(v){
  let s = String(v == null ? '' : v).trim();
  if(s.indexOf(':') === -1 && s.indexOf('.') !== -1){
    s = s.replace('.', ':');
  }
  return s;
}

function parseHistorisWorkbook(wb){
  const results = [];
  wb.SheetNames.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    results.push(...parseHistorisRows(rows));
  });
  return results;
}

// Parser inti: menerima 1 sheet berupa array-of-array baris, dipakai baik
// untuk sheet dari file Excel (via XLSX.utils.sheet_to_json) maupun dari
// data mentah Google Sheets API (values.get -> resp.result.values).
function parseHistorisRows(rows){
  const results = [];
  let colMap = null;
  let currentDate = null;

  for(let i = 0; i < rows.length; i++){
    const row = rows[i] || [];
    if(isRowBlank(row)) continue;

    if(looksLikeHeaderRow(row)){
      colMap = mapHeaderColumns(row);
      continue;
    }

    const iso = parseDayBandLabel(row[0]);
    if(iso){
      currentDate = iso;
      continue;
    }

    if(!currentDate || !colMap) continue;

    const kegiatan = colMap.kegiatan !== undefined ? String(row[colMap.kegiatan] || '').trim() : '';
    if(!kegiatan) continue; // baris kosong/dekorasi di tengah blok, lewati

    results.push({
      date: currentDate,
      time: colMap.waktu !== undefined ? normalizeWaktuCell(row[colMap.waktu]) : '',
      status: colMap.status !== undefined ? normalizeStatusCell(row[colMap.status]) : 'Proses',
      pemohon: colMap.pemohon !== undefined ? String(row[colMap.pemohon] || '').trim() : '',
      acara: kegiatan,
      tempat: colMap.tempat !== undefined ? String(row[colMap.tempat] || '').trim() : '',
      surat: colMap.surat !== undefined ? String(row[colMap.surat] || '').trim() : '',
      suratmasuk: '',
      actPasang: colMap.pasang !== undefined ? cellHasMark(row[colMap.pasang]) : false,
      actAcara: colMap.acara !== undefined ? cellHasMark(row[colMap.acara]) : false,
      actBongkar: colMap.bongkar !== undefined ? cellHasMark(row[colMap.bongkar]) : false
    });
  }
  return results;
}

/* ============================================================
   MODAL PILIHAN SUMBER IMPORT: file Excel atau link Google Sheets
   ============================================================ */
function openImportModal(){
  document.getElementById('import-source-file').checked = true;
  document.getElementById('import-gsheet-link').value = '';
  const statusLine = document.getElementById('import-status-line');
  statusLine.textContent = '';
  statusLine.style.color = 'var(--ink)';
  toggleImportSourceInputs();
  document.getElementById('import-modal-overlay').style.display = 'flex';
}

function closeImportModal(){
  document.getElementById('import-modal-overlay').style.display = 'none';
}

function toggleImportSourceInputs(){
  const isLink = document.getElementById('import-source-link').checked;
  document.getElementById('import-link-input-wrap').style.display = isLink ? '' : 'none';
}

function confirmImport(){
  const isLink = document.getElementById('import-source-link').checked;
  if(isLink){
    importFromGoogleSheetsLink();
  }else{
    closeImportModal();
    document.getElementById('import-historis-file').click();
  }
}

function extractSpreadsheetId(url){
  const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

async function importFromGoogleSheetsLink(){
  const url = document.getElementById('import-gsheet-link').value.trim();
  const statusLine = document.getElementById('import-status-line');
  const spreadsheetId = extractSpreadsheetId(url);

  if(!spreadsheetId){
    statusLine.style.color = 'var(--full)';
    statusLine.textContent = 'Link tidak valid. Pastikan formatnya seperti https://docs.google.com/spreadsheets/d/.../edit';
    return;
  }

  statusLine.style.color = 'var(--ink)';
  statusLine.textContent = 'Menghubungkan ke Google...';

  try{
    await requestGoogleAccess();
    statusLine.textContent = 'Membaca isi spreadsheet...';

    const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const sheetTitles = meta.result.sheets.map(s => s.properties.title);

    let allParsed = [];
    for(const title of sheetTitles){
      const resp = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title.replace(/'/g, "''")}'`
      });
      allParsed = allParsed.concat(parseHistorisRows(resp.result.values || []));
    }

    if(allParsed.length === 0){
      statusLine.style.color = 'var(--full)';
      statusLine.textContent = 'Tidak ada data yang bisa dikenali dari spreadsheet ini. Pastikan formatnya sesuai file AGENDA SOUND SYSTEM.';
      return;
    }

    closeImportModal();
    importParsedBookings(allParsed);
  }catch(err){
    console.error(err);
    statusLine.style.color = 'var(--full)';
    statusLine.textContent = 'Gagal membaca Google Sheets: ' + (err.result?.error?.message || err.message || err);
  }
}


// Data histori tidak divalidasi terhadap limit 3/hari (itu aturan untuk
// input baru, bukan untuk memindahkan catatan lama apa adanya).
// Hanya dicek duplikat terhadap booking yang sudah ada, supaya file yang
// sama bisa diimpor ulang tanpa menggandakan data.
async function importParsedBookings(parsedList){
  let skipped = 0;
  const toAdd = [];
  parsedList.forEach(p => {
    const dup = bookings.find(b =>
      b.date === p.date &&
      (b.time || '') === (p.time || '') &&
      String(b.acara || '').trim().toLowerCase() === p.acara.trim().toLowerCase()
    );
    if(dup){ skipped++; }else{ toAdd.push(p); }
  });

  const CHUNK = 400; // batas aman per batch Firestore (maksimal 500)
  try{
    for(let i = 0; i < toAdd.length; i += CHUNK){
      const batch = db.batch();
      toAdd.slice(i, i + CHUNK).forEach(p => {
        batch.set(bookingsCol.doc(), p);
      });
      await batch.commit();
    }
    alert(`Import selesai.\nBerhasil ditambahkan: ${toAdd.length} kegiatan.\nDilewati (sudah ada/duplikat): ${skipped} kegiatan.`);
  }catch(err){
    console.error(err);
    alert('Gagal mengimpor ke database: ' + err.message);
  }
}

function argb(hex){ return 'FF' + hex; } // ExcelJS pakai ARGB (8 digit), tambahkan alpha penuh

// Font default untuk seluruh export: Arial. Judul & sub-judul (bulan) pakai
// ukuran/berat sendiri, sisanya (header kolom, pita tanggal, isi sel, status,
// centang) seragam Arial 12 regular.
const EXPORT_FONT_NAME = 'Arial';

function styleTitle(){
  return { font: { name: EXPORT_FONT_NAME, bold: true, size: 19 }, alignment: { horizontal: 'center', vertical: 'middle' } };
}
function styleSubtitle(){
  return { font: { name: EXPORT_FONT_NAME, bold: true, size: 13 }, alignment: { horizontal: 'center', vertical: 'middle' } };
}
function styleDayBand(){
  return {
    font: { name: EXPORT_FONT_NAME, bold: false, size: 12, color: { argb: argb('000000') } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('DD7E6B') } }, // Salmon
    alignment: { horizontal: 'left', vertical: 'middle' }
  };
}
function styleHeader(){
  return {
    font: { name: EXPORT_FONT_NAME, bold: false, size: 12, color: { argb: argb('000000') } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('FBBC04') } }, // Gold
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: borderThin()
  };
}
function styleCell(align){
  return {
    font: { name: EXPORT_FONT_NAME, bold: false, size: 12 },
    alignment: { horizontal: align || 'left', vertical: 'middle', wrapText: true },
    border: borderThin()
  };
}
function styleCheck(){
  return {
    font: { name: EXPORT_FONT_NAME, size: 12, bold: false, color: { argb: argb('2E7D32') } }, // hijau buat centang
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: borderThin()
  };
}
function styleStatus(statusValue){
  const map = {
    'Selesai': { fill: '3A6B4A', font: 'FFFFFF' },
    'Proses':  { fill: 'C8862B', font: 'FFFFFF' },
    'Batal':   { fill: 'A5342A', font: 'FFFFFF' }
  };
  const c = map[statusValue] || map['Proses'];
  return {
    font: { name: EXPORT_FONT_NAME, size: 12, bold: false, color: { argb: argb(c.font) } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.fill) } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: borderThin()
  };
}
function borderThin(){
  const b = { style: 'thin', color: { argb: argb('000000') } };
  return { top: b, bottom: b, left: b, right: b };
}

/* ============================================================
   Bangun struktur data agenda (baris, merge, tipe tiap baris).
   Dipakai bareng oleh exportToExcel() dan handleOpenGoogleSheets()
   supaya tata letaknya konsisten di kedua tempat.
   ============================================================ */
function buildAgendaData(bookingSubset, opts){
  opts = opts || {};
  const sourceBookings = bookingSubset || bookings;
  const COLS = 10; // Kolom A sampai J (sesuai template baru, ada tambahan STATUS)
  const headerLabels = ['NO','WAKTU SESUAI SURAT','STATUS','PEMASANGAN','ACARA','PEMBONGKARAN','KEGIATAN /  ACARA','YANG MENGHADIRI','TEMPAT','NO SURAT'];

  // Kelompokkan booking per tanggal
  const byDate = {};
  sourceBookings.forEach(b => {
    if(!byDate[b.date]) byDate[b.date] = [];
    byDate[b.date].push(b);
  });
  const dates = Object.keys(byDate).sort();

 // Cari semua bulan unik yang ada pada data saat ini untuk judul otomatis
  const uniqueMonths = [...new Set(dates.map(d => d.slice(0, 7)))].sort();
  
  let bulanLabel;
  if(opts.forcedYM){
    const [fy, fm] = opts.forcedYM.split('-');
    bulanLabel = `BULAN ${MONTH_NAMES_FULL_ID[parseInt(fm,10)-1].toUpperCase()} ${fy}`;
  } else if(uniqueMonths.length === 1){
    const [y, m] = uniqueMonths[0].split('-');
    bulanLabel = `BULAN ${MONTH_NAMES_FULL_ID[parseInt(m,10)-1].toUpperCase()} ${y}`;
  } else if(uniqueMonths.length > 1){
    const firstYM = uniqueMonths[0];
    const lastYM = uniqueMonths[uniqueMonths.length - 1];
    const [y1, m1] = firstYM.split('-');
    const [y2, m2] = lastYM.split('-');
    
    const name1 = MONTH_NAMES_FULL_ID[parseInt(m1,10)-1].toUpperCase();
    const name2 = MONTH_NAMES_FULL_ID[parseInt(m2,10)-1].toUpperCase();
    
    if(y1 === y2){
      bulanLabel = `BULAN ${name1} - ${name2} ${y1}`;
    } else {
      bulanLabel = `BULAN ${name1} ${y1} - ${name2} ${y2}`;
    }
  } else {
    bulanLabel = 'AGENDA SOUND SYSTEM';
  
  }

  const aoa = [];
  const merges = [];       // {s:{r,c}, e:{r,c}}
  const rowHeights = [];
  const rowTypes = [];     // 'title' | 'subtitle' | 'stat' | 'blank' | 'header' | 'dayband' | 'data'
  const dataRowAligns = []; // per-row array of 'center'/'left' per column (only for 'data' rows)
  // ID booking Firestore per baris (cuma diisi untuk baris 'data'; dipakai
  // sebagai kolom tersembunyi di Google Sheets supaya status yang diedit di
  // sana bisa disinkron balik ke booking yang tepat, bukan cuma dicocokkan
  // dari tanggal/waktu/nama acara yang bisa berubah/mirip).
  const rowIds = [];

  function pushRow(rowArr, type, heightOpts = {}){
    aoa.push(rowArr);
    const idx = aoa.length - 1;
    rowHeights[idx] = heightOpts;
    rowTypes[idx] = type;
    return idx;
  }

  // 1. Baris Judul
  let r = pushRow([opts.title || 'AGENDA SOUND SYSTEM', ...Array(COLS-1).fill('')], 'title', { hpt: 25 });
  merges.push({ s:{r, c:0}, e:{r, c:COLS-1} });

  // 2. Baris Subjudul (Bulan)
  r = pushRow([bulanLabel, ...Array(COLS-1).fill('')], 'subtitle', { hpt: 20 });
  merges.push({ s:{r, c:0}, e:{r, c:COLS-1} });

  // 2b. Ringkasan statistik (khusus laporan bulanan)
  if(opts.showStats){
    const totalKegiatan = sourceBookings.length;
    const totalHari = dates.length;
    const hariPenuh = dates.filter(d => byDate[d].length >= LIMIT_PER_DAY).length;
    const rataRata = totalHari > 0 ? (totalKegiatan / totalHari).toFixed(1) : 0;

    r = pushRow([`Total kegiatan: ${totalKegiatan}   |   Hari terpakai: ${totalHari}   |   Hari penuh (${LIMIT_PER_DAY}/hari): ${hariPenuh}   |   Rata-rata/hari: ${rataRata}`, ...Array(COLS-1).fill('')], 'stat', { hpt: 20 });
    merges.push({ s:{r, c:0}, e:{r, c:COLS-1} });
  }

  // 3. Spasi Kosong Sebelum Mulai Data
  pushRow(Array(COLS).fill(''), 'blank', { hpt: 15 });

  // 4. Baris Header (Warna Gold) - CUMA SEKALI di atas, tidak diulang tiap hari
  const headerRowIdxForId = pushRow(headerLabels.slice(), 'header', { hpt: 35 });
  rowIds[headerRowIdxForId] = 'ID';

  dates.forEach((date) => {
    const items = byDate[date];
    const d = new Date(date + 'T00:00:00');
    // Format: "Sabtu ,6 Juni 2026" (mempertahankan spasi sebelum koma seperti foto)
    const dayLabel = `${DAY_NAMES_ID[d.getDay()]} ,${d.getDate()} ${MONTH_NAMES_FULL_ID[d.getMonth()]} ${d.getFullYear()}`;

    // 5. Pita Nama Hari (Warna Salmon) - langsung nempel, tanpa spasi/header ulang
    let br = pushRow([dayLabel, ...Array(COLS-1).fill('')], 'dayband', { hpt: 22 });
    merges.push({ s:{r:br, c:0}, e:{r:br, c:COLS-1} });

    // 6. Data Per Hari
    items.forEach((b, idx) => {
      const row = [
        idx + 1,
        b.time ? b.time.replace(':', '.') : '',
        b.status || 'Proses',
        b.actPasang !== false ? '✓' : '', // PEMASANGAN (simbol centang asli)
        b.actAcara !== false ? '✓' : '',  // ACARA
        b.actBongkar !== false ? '✓' : '', // PEMBONGKARAN
        b.acara || '',
        b.pemohon || '',
        b.tempat || '',
        b.surat || b.suratmasuk || ''
      ];
      const dr = pushRow(row, 'data', { hpt: 20 });
      dataRowAligns[dr] = row.map((_, c) => (c >= 0 && c <= 5) ? 'center' : 'left');
      rowIds[dr] = b.id || '';
    });
  });

  return { COLS, aoa, merges, rowHeights, rowTypes, dataRowAligns, rowIds, bulanLabel, dates };
}

function styleStat(){
  return {
    font: { name: EXPORT_FONT_NAME, size: 12, bold: false, color: { argb: argb('5A5348') } },
    alignment: { horizontal: 'center', vertical: 'middle' }
  };
}

function applyCellStyle(cell, style){
  if(style.font) cell.font = style.font;
  if(style.alignment) cell.alignment = style.alignment;
  if(style.fill) cell.fill = style.fill;
  if(style.border) cell.border = style.border;
}

async function writeAgendaWorkbook(data, filename, sheetName){
  const { COLS, aoa, merges, rowHeights, rowTypes, dataRowAligns } = data;

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(sheetName || 'Agenda Sound System');

  // Bekukan baris judul/bulan/(stat)/header supaya tetap kelihatan saat
  // scroll ke bawah. Dihitung dari posisi baris 'header' (bukan angka
  // tetap 4), karena laporan bulanan (showStats) punya 1 baris statistik
  // tambahan sebelum header, jadi headernya jatuh di baris 5, bukan 4.
  const headerRowIdx = rowTypes.indexOf('header'); // 0-based
  if(headerRowIdx !== -1){
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRowIdx + 1 }];
  }

  ws.columns = [
    {width: 5},   // A: NO
    {width: 14},  // B: WAKTU SESUAI SURAT
    {width: 12},  // C: STATUS
    {width: 13},  // D: PEMASANGAN
    {width: 9},   // E: ACARA
    {width: 16},  // F: PEMBONGKARAN
    {width: 45},  // G: KEGIATAN / ACARA
    {width: 18},  // H: YANG MENGHADIRI
    {width: 32},  // I: TEMPAT
    {width: 28}   // J: NO SURAT
  ];

  aoa.forEach((rowArr, r) => {
    const row = ws.addRow(rowArr);
    if(rowHeights[r] && rowHeights[r].hpt) row.height = rowHeights[r].hpt;

    const type = rowTypes[r];
    if(type === 'title'){
      applyCellStyle(row.getCell(1), styleTitle());
    }else if(type === 'subtitle'){
      applyCellStyle(row.getCell(1), styleSubtitle());
    }else if(type === 'stat'){
      applyCellStyle(row.getCell(1), styleStat());
    }else if(type === 'header'){
      for(let c = 1; c <= COLS; c++) applyCellStyle(row.getCell(c), styleHeader());
    }else if(type === 'dayband'){
      for(let c = 1; c <= COLS; c++) applyCellStyle(row.getCell(c), styleDayBand());
    }else if(type === 'data'){
      dataRowAligns[r].forEach((align, c0) => {
        const cell = row.getCell(c0 + 1);
        if(c0 === 2){
          applyCellStyle(cell, styleStatus(aoa[r][2]));
          // Dropdown Status asli di Excel (Selesai/Proses/Batal)
          cell.dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['"Selesai,Proses,Batal"']
          };
        }else if(c0 === 3 || c0 === 4 || c0 === 5){
          applyCellStyle(cell, styleCheck());
        }else{
          applyCellStyle(cell, styleCell(align));
        }
      });
    }
  });

  merges.forEach(m => {
    ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let pendingExportType = null; // 'excel' atau 'gsheets', dipakai modal pilihan export

function openExportModal(type){
  pendingExportType = type;
  const searchDate = document.getElementById('search-date').value;
  const scopeDateRadio = document.getElementById('scope-date');
  const scopeDateLabel = document.getElementById('scope-date-label');

  if(searchDate){
    scopeDateRadio.disabled = false;
    scopeDateLabel.textContent = `(${fmtDateID(searchDate)})`;
    scopeDateRadio.checked = true;
  }else{
    scopeDateRadio.disabled = true;
    scopeDateLabel.textContent = '(belum ada tanggal dipilih di pencarian)';
    document.getElementById('scope-all').checked = true;
  }

  document.getElementById('export-range-from').value = '';
  document.getElementById('export-range-to').value = '';
  toggleRangeInputs();

  document.getElementById('export-modal-overlay').style.display = 'flex';
}

function closeExportModal(){
  document.getElementById('export-modal-overlay').style.display = 'none';
}

function toggleRangeInputs(){
  const isRange = document.getElementById('scope-range').checked;
  document.getElementById('range-inputs').style.display = isRange ? '' : 'none';
}

function confirmExport(){
  const scope = document.querySelector('input[name="export-scope"]:checked').value;
  let subset;

  if(scope === 'date'){
    const d = document.getElementById('search-date').value;
    subset = bookings.filter(b => b.date === d);
  }else if(scope === 'range'){
    const from = document.getElementById('export-range-from').value;
    const to = document.getElementById('export-range-to').value;
    if(!from || !to){
      alert('Isi tanggal "dari" dan "sampai" dulu.');
      return;
    }
    if(from > to){
      alert('Tanggal awal harus sebelum atau sama dengan tanggal akhir.');
      return;
    }
    subset = bookings.filter(b => b.date >= from && b.date <= to);
  }else{
    subset = bookings;
  }

  if(subset.length === 0){
    alert('Tidak ada data pada tanggal/rentang yang dipilih.');
    return;
  }

  closeExportModal();

  if(pendingExportType === 'excel'){
    exportToExcel(subset);
  }else if(pendingExportType === 'gsheets'){
    handleOpenGoogleSheets(subset);
  }
}

async function exportToExcel(subset){
  const source = subset || bookings;
  if(source.length === 0){
    alert('Belum ada data untuk di-export.');
    return;
  }
  const data = buildAgendaData(source);
  const today = new Date().toISOString().slice(0,10);
  await writeAgendaWorkbook(data, `agenda-sound-system-${today}.xlsx`, 'Agenda Sound System');
}

async function exportMonthReport(ym){
  const monthBookings = bookings.filter(b => b.date.slice(0,7) === ym);
  if(monthBookings.length === 0){
    alert('Tidak ada data di bulan ini untuk di-export.');
    return;
  }
  const [y, m] = ym.split('-');
  const monthLabel = `${MONTH_NAMES_FULL_ID[parseInt(m,10)-1]} ${y}`;

  const data = buildAgendaData(monthBookings, {
    forcedYM: ym,
    title: 'LAPORAN BULANAN SOUND SYSTEM',
    showStats: true
  });
  const filename = `laporan-bulanan-sound-system-${ym}.xlsx`;
  await writeAgendaWorkbook(data, filename, monthLabel);
}

/* ============================================================
   GOOGLE SHEETS: buat spreadsheet baru di akun Google user
   dan isi + format persis seperti hasil Export ke Excel.
   ============================================================ */
function rgbToGoogleColor(hex){
  const r = parseInt(hex.substring(0,2), 16) / 255;
  const g = parseInt(hex.substring(2,4), 16) / 255;
  const b = parseInt(hex.substring(4,6), 16) / 255;
  return { red: r, green: g, blue: b };
}

function handleOpenGoogleSheets(subset){
  const source = subset || bookings;
  if(source.length === 0){
    alert('Belum ada data untuk dikirim ke Google Sheets.');
    return;
  }
  const btn = document.getElementById('btn-gsheets');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menghubungkan ke Google...';

  requestGoogleAccess()
    .then(() => {
      btn.textContent = originalLabel;
      btn.disabled = false;
      createAndFillGoogleSheet(source).catch(err => {
        console.error(err);
        alert('Gagal membuat Google Sheets: ' + (err.result?.error?.message || err.message || err));
      });
    })
    .catch(err => {
      btn.disabled = false;
      btn.textContent = originalLabel;
      alert(err.message || 'Gagal login ke Google.');
    });
}

async function createAndFillGoogleSheet(subset){
  const btn = document.getElementById('btn-gsheets');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Membuat Google Sheets...';

  try{
    const data = buildAgendaData(subset || bookings);
    const today = new Date().toISOString().slice(0,10);

    // 1. Buat spreadsheet baru
    const createResp = await gapi.client.sheets.spreadsheets.create({
      properties: { title: `Agenda Sound System - ${today}` },
      sheets: [{ properties: { title: 'Agenda Sound System' } }]
    });
    const spreadsheetId = createResp.result.spreadsheetId;
    const sheetId = createResp.result.sheets[0].properties.sheetId;

    // 2. Isi nilai sel (kolom A-J data yang tampil, ditambah kolom K
    // berisi ID booking per baris - dipakai nanti untuk fitur Sync Status,
    // disembunyikan supaya tidak mengganggu tampilan)
    const valuesWithId = data.aoa.map((row, i) => [...row, (data.rowIds && data.rowIds[i]) || '']);
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Agenda Sound System!A1',
      valueInputOption: 'RAW',
      resource: { values: valuesWithId }
    });

    // 3. Format: merge, warna, border, lebar kolom, tinggi baris
    const requests = [];
    const COLS = data.COLS;

    // Lebar kolom (10 kolom: NO, WAKTU, STATUS, PEMASANGAN, ACARA, PEMBONGKARAN, KEGIATAN, YANG MENGHADIRI, TEMPAT, NO SURAT)
    const colWidths = [40,100,90,100,90,110,500,170,300,300];
    colWidths.forEach((w, c) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c+1 },
          properties: { pixelSize: w },
          fields: 'pixelSize'
        }
      });
    });

    // Kolom K (index 10) = ID booking, disembunyikan karena cuma dipakai
    // internal untuk fitur Sync Status dari Google Sheets.
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser'
      }
    });

    // Bekukan baris judul/bulan/(stat)/header, konsisten dengan export Excel
    const headerRowIdxG = data.rowTypes.indexOf('header');
    if(headerRowIdxG !== -1){
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: headerRowIdxG + 1 } },
          fields: 'gridProperties.frozenRowCount'
        }
      });
    }

    // Merge judul, subjudul, dan pita hari
    data.merges.forEach(m => {
      requests.push({
        mergeCells: {
          range: { sheetId, startRowIndex: m.s.r, endRowIndex: m.e.r+1, startColumnIndex: m.s.c, endColumnIndex: m.e.c+1 },
          mergeType: 'MERGE_ALL'
        }
      });
    });

    const gold = rgbToGoogleColor('FBBC04');
    const salmon = rgbToGoogleColor('DD7E6B');
    const statusColors = {
      'Selesai': rgbToGoogleColor('3A6B4A'),
      'Proses': rgbToGoogleColor('C8862B'),
      'Batal': rgbToGoogleColor('A5342A')
    };
    const border = { style: 'SOLID', color: { red:0, green:0, blue:0 } };
    const thinBorders = { top: border, bottom: border, left: border, right: border };


const statusDataRows = [];
    data.rowTypes.forEach((type, r) => {
      if(type === 'data') statusDataRows.push(r);
    });

    if(statusDataRows.length > 0){
      const minRow = Math.min(...statusDataRows);
      const maxRow = Math.max(...statusDataRows);
      requests.push({
        setDataValidation: {
          range: {
            sheetId: sheetId,
            startRowIndex: minRow,
            endRowIndex: maxRow + 1,
            startColumnIndex: 2, // Kolom C (Status)
            endColumnIndex: 3
          },
          rule: {
            condition: {
              type: 'ONE_OF_LIST',
              values: [
                { userEnteredValue: 'Selesai' },
                { userEnteredValue: 'Proses' },
                { userEnteredValue: 'Batal' }
              ]
            },
            showCustomUi: true,
            strict: true
          }
        }
      });

      // Conditional Formatting untuk kolom STATUS: warnanya dihitung ulang
      // otomatis dari ISI TEKS sel setiap kali berubah (bukan dicat sekali
      // waktu export), jadi begitu status diganti misalnya dari "Proses"
      // ke "Batal", warnanya langsung ikut berubah ke merah tanpa perlu
      // export ulang.
      const statusConditionalFormats = [
        { value: 'Selesai', bg: rgbToGoogleColor('3A6B4A') },
        { value: 'Proses',  bg: rgbToGoogleColor('C8862B') },
        { value: 'Batal',   bg: rgbToGoogleColor('A5342A') }
      ];
      statusConditionalFormats.forEach((cfg, i) => {
        requests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId, startRowIndex: minRow, endRowIndex: maxRow + 1, startColumnIndex: 2, endColumnIndex: 3 }],
              booleanRule: {
                condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: cfg.value }] },
                format: {
                  backgroundColor: cfg.bg,
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                }
              }
            },
            index: i
          }
        });
      });
    }

    data.rowTypes.forEach((type, r) => {
      if(type === 'title'){
        requests.push({ repeatCell: {
          range: { sheetId, startRowIndex:r, endRowIndex:r+1, startColumnIndex:0, endColumnIndex:COLS },
          cell: { userEnteredFormat: { textFormat: { bold:true, fontSize:16 }, horizontalAlignment:'CENTER', verticalAlignment:'MIDDLE' } },
          fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)'
        }});
      }else if(type === 'subtitle'){
        requests.push({ repeatCell: {
          range: { sheetId, startRowIndex:r, endRowIndex:r+1, startColumnIndex:0, endColumnIndex:COLS },
          cell: { userEnteredFormat: { textFormat: { bold:true, fontSize:12 }, horizontalAlignment:'CENTER', verticalAlignment:'MIDDLE' } },
          fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)'
        }});
      }else if(type === 'header'){
        requests.push({ repeatCell: {
          range: { sheetId, startRowIndex:r, endRowIndex:r+1, startColumnIndex:0, endColumnIndex:COLS },
          cell: { userEnteredFormat: {
            textFormat: { bold:true, fontSize:10 },
            backgroundColor: gold,
            horizontalAlignment:'CENTER', verticalAlignment:'MIDDLE', wrapStrategy:'WRAP',
            borders: thinBorders
          } },
          fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,borders)'
        }});
      }else if(type === 'dayband'){
        requests.push({ repeatCell: {
          range: { sheetId, startRowIndex:r, endRowIndex:r+1, startColumnIndex:0, endColumnIndex:COLS },
          cell: { userEnteredFormat: {
            textFormat: { bold:true, fontSize:11 },
            backgroundColor: salmon,
            horizontalAlignment:'LEFT', verticalAlignment:'MIDDLE'
          } },
          fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)'
        }});
      }else if(type === 'data'){
        data.dataRowAligns[r].forEach((align, c) => {
          const isCheckCol = (c === 3 || c === 4 || c === 5);
          const isStatusCol = (c === 2);
          const cellFormat = {
            textFormat: isCheckCol
              ? { fontSize:13, bold:true, foregroundColor:{ red:0.18, green:0.49, blue:0.20 } }
              : { fontSize:10 },
            horizontalAlignment: (isCheckCol || isStatusCol || align === 'center') ? 'CENTER' : 'LEFT',
            verticalAlignment:'MIDDLE', wrapStrategy:'WRAP',
            borders: thinBorders
          };
          requests.push({ repeatCell: {
            range: { sheetId, startRowIndex:r, endRowIndex:r+1, startColumnIndex:c, endColumnIndex:c+1 },
            cell: { userEnteredFormat: cellFormat },
            fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,borders)'
          }});
        });
      }
    });

    // Tinggi baris
    data.rowHeights.forEach((h, r) => {
      if(h && h.hpt){
        requests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: r, endIndex: r+1 },
            properties: { pixelSize: Math.round(h.hpt * 1.4) },
            fields: 'pixelSize'
          }
        });
      }
    });

    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests }
    });

    // 4. Buka spreadsheet yang baru dibuat di tab baru
    window.open(createResp.result.spreadsheetUrl, '_blank');

  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/* ============================================================
   SYNC STATUS DARI GOOGLE SHEETS
   Baca ulang spreadsheet hasil export (yang sudah punya kolom ID
   tersembunyi di kolom K), lalu perbarui field status di Firestore
   untuk booking yang statusnya sudah diubah manual di Sheets.
   Data/baris lain (tanggal, kegiatan, dst) tidak disentuh sama sekali,
   dan baris yang ID-nya tidak ditemukan (booking sudah dihapus, atau
   sheet bukan hasil export aplikasi ini) dilewati dengan aman.
   ============================================================ */
function openSyncStatusModal(){
  document.getElementById('sync-gsheet-link').value = '';
  const statusLine = document.getElementById('sync-status-line');
  statusLine.textContent = '';
  statusLine.style.color = 'var(--ink)';
  document.getElementById('sync-status-modal-overlay').style.display = 'flex';
}

function closeSyncStatusModal(){
  document.getElementById('sync-status-modal-overlay').style.display = 'none';
}

function confirmSyncStatus(){
  syncStatusFromGoogleSheets();
}

async function syncStatusFromGoogleSheets(){
  const url = document.getElementById('sync-gsheet-link').value.trim();
  const statusLine = document.getElementById('sync-status-line');
  const spreadsheetId = extractSpreadsheetId(url);

  if(!spreadsheetId){
    statusLine.style.color = 'var(--full)';
    statusLine.textContent = 'Link tidak valid. Pastikan formatnya seperti https://docs.google.com/spreadsheets/d/.../edit';
    return;
  }

  statusLine.style.color = 'var(--ink)';
  statusLine.textContent = 'Menghubungkan ke Google...';

  try{
    await requestGoogleAccess();
    statusLine.textContent = 'Membaca isi spreadsheet...';

    const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const sheetTitles = meta.result.sheets.map(s => s.properties.title);

    let updated = 0, unchanged = 0, unmatched = 0, noId = 0;

    for(const title of sheetTitles){
      const resp = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title.replace(/'/g, "''")}'`
      });
      const parsed = parseHistorisRows(resp.result.values || []);

      for(const item of parsed){
        if(!item.id){ noId++; continue; } // bukan hasil export aplikasi ini / kolom ID kosong
        const b = bookings.find(bk => bk.id === item.id);
        if(!b){ unmatched++; continue; } // booking-nya sudah dihapus dari database
        if((b.status || 'Proses') === item.status){ unchanged++; continue; }
        await bookingsCol.doc(item.id).update({ status: item.status });
        updated++;
      }
    }

    closeSyncStatusModal();

    if(noId === 0 && updated === 0 && unchanged === 0 && unmatched === 0){
      alert('Tidak ada data yang bisa dibaca dari spreadsheet ini.');
      return;
    }
    if(updated === 0 && unchanged === 0 && unmatched === 0){
      alert('Spreadsheet ini sepertinya bukan hasil export dari aplikasi ini (kolom ID tersembunyi tidak ditemukan), jadi tidak ada yang bisa disinkron.');
      return;
    }

    alert(`Sync status selesai.\nDiperbarui: ${updated}\nSudah sama (tidak ada perubahan): ${unchanged}\nTidak ditemukan (mungkin sudah dihapus): ${unmatched}`);
  }catch(err){
    console.error(err);
    statusLine.style.color = 'var(--full)';
    statusLine.textContent = 'Gagal sync: ' + (err.result?.error?.message || err.message || err);
  }
}

let expandedMonths = new Set(); // bulan yang sedang dibuka (format YYYY-MM)

function goToMonthInRekap(ym){
  switchView('rekap');
  expandedMonths.add(ym);
  renderTable();

  // Kasih jeda dikit biar DOM sempat ke-render dulu sebelum scroll
  setTimeout(() => {
    const target = document.getElementById('month-row-' + ym);
    if(target){
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 50);
}

function toggleFullDaysPanel(){
  const panel = document.getElementById('full-days-panel');
  if(!panel) return;
  panel.classList.toggle('open');
}

function closeFullDaysPanel(){
  const panel = document.getElementById('full-days-panel');
  if(!panel) return;
  panel.classList.remove('open');
}

function goToDateInRekap(dateStr){
  switchView('rekap');
  const searchInput = document.getElementById('search-date');
  if(searchInput) searchInput.value = dateStr;
  expandedMonths.add(dateStr.slice(0,7));
  renderTable();
}

function handleSearchDateChange(){
  const searchDate = document.getElementById('search-date').value;
  if(searchDate){
    expandedMonths.add(searchDate.slice(0,7));
  }
  renderTable();
}

let searchTextDebounce = null;
function handleSearchTextChange(){
  clearTimeout(searchTextDebounce);
  searchTextDebounce = setTimeout(() => {
    const q = document.getElementById('search-text').value.trim().toLowerCase();
    if(q){
      // Buka otomatis semua bulan yang hasilnya cocok, biar langsung kelihatan
      bookings.forEach(b => {
        const cocok = (b.acara || '').toLowerCase().includes(q) || (b.tempat || '').toLowerCase().includes(q);
        if(cocok) expandedMonths.add(b.date.slice(0,7));
      });
    }
    renderTable();
  }, 300);
}

function toggleMonth(ym){
  if(expandedMonths.has(ym)){
    expandedMonths.delete(ym);
  }else{
    expandedMonths.add(ym);
  }
  renderTable();
}

function renderTable(){
  const wrap = document.getElementById('table-wrap');
  const searchDate = document.getElementById('search-date').value;
  const searchText = document.getElementById('search-text').value.trim().toLowerCase();

  let filtered = bookings;
  if(searchDate){
    filtered = filtered.filter(b => b.date === searchDate);
  }
  if(searchText){
    filtered = filtered.filter(b =>
      (b.acara || '').toLowerCase().includes(searchText) ||
      (b.tempat || '').toLowerCase().includes(searchText)
    );
  }

  if(bookings.length === 0){
    wrap.innerHTML = '<p class="empty-note">Belum ada data peminjaman.</p>';
    return;
  }
  if((searchDate || searchText) && filtered.length === 0){
    let pesan = 'Tidak ada peminjaman';
    if(searchDate) pesan += ` di tanggal ${fmtDateID(searchDate)}`;
    if(searchText) pesan += `${searchDate ? ' dan' : ' dengan'} kata kunci "${escapeHtml(document.getElementById('search-text').value.trim())}"`;
    wrap.innerHTML = `<p class="empty-note">${pesan}.</p>`;
    return;
  }

  // Kelompokkan: bulan -> tanggal -> item
  const byMonth = {};
  filtered.forEach(b => {
    const ym = b.date.slice(0,7);
    if(!byMonth[ym]) byMonth[ym] = {};
    if(!byMonth[ym][b.date]) byMonth[ym][b.date] = [];
    byMonth[ym][b.date].push(b);
  });
  const months = Object.keys(byMonth).sort().reverse(); // bulan terbaru di atas

  let html = '<div class="rekap-scroll"><table><thead><tr><th>Tanggal / Jumlah</th><th>Waktu</th><th>Status</th><th>Kegiatan</th><th>Yang Menghadiri</th><th>Tempat</th><th>No. e-Surat</th><th>No. Surat Balasan</th><th></th></tr></thead><tbody>';

  months.forEach(ym => {
    const [y, m] = ym.split('-');
    const monthLabel = `${MONTH_NAMES_FULL_ID[parseInt(m,10)-1]} ${y}`;
    const datesInMonth = Object.keys(byMonth[ym]).sort();
    const totalInMonth = datesInMonth.reduce((sum, d) => sum + byMonth[ym][d].length, 0);
    const isOpen = expandedMonths.has(ym);

    html += `<tr class="month-row ${isOpen ? 'month-row-open' : ''}" id="month-row-${ym}" onclick="toggleMonth('${ym}')">
      <td colspan="9">
        <span class="month-toggle-icon">${isOpen ? '\u25BC' : '\u25B6'}</span>
        <span class="month-label">${monthLabel}</span>
        <span class="month-count">${totalInMonth} kegiatan</span>
        <button type="button" class="month-export-btn" onclick="event.stopPropagation(); exportMonthReport('${ym}')">Export Laporan Bulanan</button>
      </td>
    </tr>`;

    if(isOpen){
      datesInMonth.forEach(date => {
        const items = byMonth[ym][date];
        const full = items.length >= LIMIT_PER_DAY;
        html += `<tr><td colspan="9" style="background:#f6f4ee;padding:8px 10px;">
          <span class="datebadge">${fmtDateID(date)}</span>
          <span class="${full ? 'count-full' : 'count-ok'}">${items.length}/${LIMIT_PER_DAY} ${full ? '(PENUH)' : ''}</span>
        </td></tr>`;
        items.forEach(b => {
          const status = b.status || 'Proses';
          html += `<tr>
            <td></td>
            <td>${b.time || '-'}</td>
            <td>
              <select class="status-select status-${status}" onchange="event.stopPropagation(); updateBookingStatus('${b.id}', this.value)" onclick="event.stopPropagation()">
                <option value="Proses" ${status === 'Proses' ? 'selected' : ''}>Proses</option>
                <option value="Selesai" ${status === 'Selesai' ? 'selected' : ''}>Selesai</option>
                <option value="Batal" ${status === 'Batal' ? 'selected' : ''}>Batal</option>
              </select>
            </td>
            <td>${escapeHtml(b.acara)}</td>
            <td>${escapeHtml(b.pemohon) || '-'}</td>
            <td>${escapeHtml(b.tempat) || '-'}</td>
            <td>${escapeHtml(b.suratmasuk) || '-'}</td>
            <td>${escapeHtml(b.surat) || '-'}</td>
            <td>
              <button class="edit-btn" onclick="event.stopPropagation(); startEditBooking('${b.id}')">Edit</button>
              <button class="del" onclick="event.stopPropagation(); deleteBooking('${b.id}')">Hapus</button>
            </td>
          </tr>`;
        });
      });
    }
  });

  html += '</tbody></table></div>';
  wrap.innerHTML = html;
  setupAutoHideScrollbar();
}

// Scrollbar cuma muncul pas lagi discroll, abis itu fade lagi otomatis
function setupAutoHideScrollbar(){
  const scrollEl = document.querySelector('.rekap-scroll');
  if(!scrollEl) return;
  let hideTimer = null;
  scrollEl.addEventListener('scroll', () => {
    scrollEl.classList.add('is-scrolling');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      scrollEl.classList.remove('is-scrolling');
    }, 900);
  });
}

function escapeHtml(str){
  if(!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function setChartMode(mode){
  chartMode = mode;
  document.getElementById('btn-harian').classList.toggle('active', mode === 'harian');
  document.getElementById('btn-bulanan').classList.toggle('active', mode === 'bulanan');
  renderChart();
}

function renderChart(){
  const wrap = document.getElementById('chart-wrap');
  if(bookings.length === 0){
    wrap.innerHTML = '<p class="empty-note">Belum ada data untuk ditampilkan.</p>';
    return;
  }
  if(chartMode === 'bulanan'){
    renderChartBulanan(wrap);
  }else{
    renderChartHarian(wrap);
  }
}

function renderChartHarian(wrap){
  const byDate = {};
  bookings.forEach(b => {
    byDate[b.date] = (byDate[b.date] || 0) + 1;
  });
  const dates = Object.keys(byDate).sort();
  const maxVal = Math.max(LIMIT_PER_DAY, ...Object.values(byDate));
  const maxBarHeight = 150;

  let html = '<div class="chart">';
  dates.forEach(date => {
    const count = byDate[date];
    const full = count >= LIMIT_PER_DAY;
    const h = Math.max(6, Math.round((count / maxVal) * maxBarHeight));
    const d = new Date(date + 'T00:00:00');
    const label = d.toLocaleDateString('id-ID', {day:'numeric', month:'short'});
    html += `<div class="chart-col">
      <div class="chart-value">${count}</div>
      <div class="chart-bar ${full ? 'full' : ''}" style="height:${h}px"></div>
      <div class="chart-label">${label}</div>
    </div>`;
  });
  html += '</div>';
  html += `<div class="legend">
    <span><span class="swatch" style="background:var(--navy)"></span> Tersedia</span>
    <span><span class="swatch" style="background:var(--full)"></span> Sudah penuh (${LIMIT_PER_DAY}/hari)</span>
  </div>`;
  wrap.innerHTML = html;
}

const MONTH_NAMES_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

function renderChartBulanan(wrap){
  const byMonth = {};
  bookings.forEach(b => {
    const ym = b.date.slice(0,7);
    byMonth[ym] = (byMonth[ym] || 0) + 1;
  });
  const months = Object.keys(byMonth).sort();
  const maxVal = Math.max(...Object.values(byMonth));
  const maxBarHeight = 150;

  let html = '<div class="chart">';
  months.forEach(ym => {
    const [y, m] = ym.split('-');
    const count = byMonth[ym];
    const h = Math.max(6, Math.round((count / maxVal) * maxBarHeight));
    const label = `${MONTH_NAMES_ID[parseInt(m,10)-1]}<br>${y}`;
    html += `<div class="chart-col">
      <div class="chart-value">${count}</div>
      <div class="chart-bar" style="height:${h}px"></div>
      <div class="chart-label">${label}</div>
    </div>`;
  });
  html += '</div>';

  const byMonthNumAllYears = {};
  Object.keys(byMonth).forEach(ym => {
    const m = ym.split('-')[1];
    if(!byMonthNumAllYears[m]) byMonthNumAllYears[m] = [];
    byMonthNumAllYears[m].push({year: ym.split('-')[0], count: byMonth[ym]});
  });
  const compareLines = Object.keys(byMonthNumAllYears)
    .filter(m => byMonthNumAllYears[m].length > 1)
    .sort()
    .map(m => {
      const entries = byMonthNumAllYears[m].sort((a,b)=>a.year-b.year)
        .map(e => `${e.year}: ${e.count}`).join(' &middot; ');
      return `<div>${MONTH_NAMES_ID[parseInt(m,10)-1]} &mdash; ${entries}</div>`;
    });
  if(compareLines.length){
    html += `<div class="legend" style="flex-direction:column;gap:4px;margin-top:18px;">${compareLines.join('')}</div>`;
  }

  wrap.innerHTML = html;
}

function setupUpcomingScrollbar(){
  const scrollEl = document.getElementById('dash-upcoming-wrap');
  if(!scrollEl) return;
  let hideTimer = null;
  scrollEl.addEventListener('scroll', () => {
    scrollEl.classList.add('is-scrolling');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      scrollEl.classList.remove('is-scrolling');
    }, 900);
  });
}

document.getElementById('f-date').addEventListener('change', checkDateStatus);
document.getElementById('f-time').addEventListener('change', checkDateStatus);

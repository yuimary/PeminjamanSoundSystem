const LIMIT_PER_DAY = 3;
const STORAGE_KEY = 'sound_system_bookings';
let bookings = [];
let chartMode = 'harian';

/* ============================================================
   LOGIN ADMIN (biasa, bukan Google)
   Catatan: karena ini murni web statis (tanpa server backend),
   username/password ini disimpan di kode JS dan HANYA berfungsi
   sebagai gerbang sederhana, BUKAN keamanan sungguhan (orang yang
   paham bisa lihat lewat "View Source"). Ganti sesuai kebutuhan.
   ============================================================ */
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'sound2026'
};
const LOGIN_SESSION_KEY = 'sound_system_admin_logged_in';

function handleAdminLogin(){
  const user = document.getElementById('f-admin-user').value.trim();
  const pass = document.getElementById('f-admin-pass').value;
  const errEl = document.getElementById('login-error');

  if(user === ADMIN_CREDENTIALS.username && pass === ADMIN_CREDENTIALS.password){
    errEl.textContent = '';
    sessionStorage.setItem(LOGIN_SESSION_KEY, 'true');
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('main-shell').style.display = '';
    switchView('dashboard');
  }else{
    errEl.textContent = 'Username atau password salah.';
  }
}

function checkAdminSession(){
  if(sessionStorage.getItem(LOGIN_SESSION_KEY) === 'true'){
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('main-shell').style.display = '';
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
  checkAdminSession();

  if(typeof gapi !== 'undefined') gapiLoaded();
  if(typeof google !== 'undefined' && google.accounts){
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: '', // diisi ulang saat dipakai
    });
    gisInited = true;
  }
  loadBookings();
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

function loadBookings(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    bookings = raw ? JSON.parse(raw) : [];
  }catch(e){
    console.error('Gagal memuat data', e);
    bookings = [];
  }
  // Paksa checkbox jenis kegiatan kosong saat halaman dimuat,
  // supaya tidak ke-restore otomatis oleh browser (bfcache/form restore)
  const pasangEl = document.getElementById('f-act-pasang');
  const acaraEl = document.getElementById('f-act-acara');
  const bongkarEl = document.getElementById('f-act-bongkar');
  if(pasangEl) pasangEl.checked = false;
  if(acaraEl) acaraEl.checked = false;
  if(bongkarEl) bongkarEl.checked = false;

  renderTable();
  renderChart();
  renderDashboard();
  checkDateStatus();
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
  const belumBongkar = bookings.filter(b => b.date < todayStr && b.actBongkar === false).length;

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
  statsHtml += `<div class="stat-card ${belumBongkar > 0 ? 'stat-red' : 'stat-green'}">
    <div class="stat-icon">${ICON_WRENCH}</div>
    <div class="stat-body">
      <div class="stat-value">${belumBongkar}</div>
      <div class="stat-label">Belum dicentang "Pembongkaran"</div>
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

function saveBookings(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
  }catch(e){
    console.error('Gagal menyimpan', e);
    alert('Gagal menyimpan data. Storage browser mungkin penuh.');
  }
}

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
  document.getElementById('submit-btn').textContent = 'Simpan Peminjaman';
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if(cancelBtn) cancelBtn.style.display = 'none';
  document.querySelector('.panel h2').textContent = 'Catat Peminjaman Baru';
  checkDateStatus();
}

function startEditBooking(id){
  const b = bookings.find(x => x.id === id);
  if(!b) return;
  editingId = id;

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

  document.getElementById('submit-btn').textContent = 'Update Peminjaman';
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if(cancelBtn) cancelBtn.style.display = '';
  document.querySelector('.panel h2').textContent = 'Edit Peminjaman';

  checkDateStatus();
  document.querySelector('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function submitBooking(){
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

  if(editingId){
    // Mode update: cari dan timpa data lama
    const idx = bookings.findIndex(b => b.id === editingId);
    if(idx !== -1){
      bookings[idx] = { ...bookings[idx], date, time, pemohon, acara, tempat, surat, suratmasuk, actPasang, actAcara, actBongkar };
    }
  }else{
    // Mode tambah baru
    bookings.push({
      id: 'bk_' + Date.now(),
      date, time, pemohon, acara, tempat, surat, suratmasuk,
      actPasang, actAcara, actBongkar
    });
  }
  saveBookings();
  resetForm();
  renderTable();
  renderChart();
  renderDashboard();
}

function cancelEdit(){
  resetForm();
}

function deleteBooking(id){
  bookings = bookings.filter(b => b.id !== id);
  saveBookings();
  if(editingId === id) resetForm(); // kalau yang lagi diedit dihapus, keluar dari mode edit
  renderTable();
  renderChart();
  renderDashboard();
  checkDateStatus();
}

function clearSearch(){
  document.getElementById('search-date').value = '';
  renderTable();
}

const MONTH_NAMES_FULL_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DAY_NAMES_ID = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

function styleTitle(){
  return { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center', vertical: 'center' } };
}
function styleSubtitle(){
  return { font: { bold: true, sz: 12 }, alignment: { horizontal: 'center', vertical: 'center' } };
}
function styleDayBand(){
  return {
    font: { bold: true, sz: 11, color: { rgb: '000000' } },
    fill: { fgColor: { rgb: 'EA9999' } }, // Warna Merah Muda / Pink
    alignment: { horizontal: 'left', vertical: 'center' },
    border: borderThin()
  };
}
function styleHeader(){
  return {
    font: { bold: true, sz: 10 },
    fill: { fgColor: { rgb: 'F6B26B' } }, // Warna Oranye
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: borderThin()
  };
}
function styleCell(align){
  return {
    font: { sz: 10 },
    alignment: { horizontal: align || 'left', vertical: 'center', wrapText: true },
    border: borderThin()
  };
}
function styleCheck(){
  return {
    font: { sz: 13, bold: true, color: { rgb: '2E7D32' } }, // hijau tebal buat centang
    alignment: { horizontal: 'center', vertical: 'center' },
    border: borderThin()
  };
}
function borderThin(){
  const b = { style: 'thin', color: { rgb: '000000' } }; // Diubah jadi Hitam Pekat
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
  const COLS = 9; // Kolom A sampai I (Sesuai foto)
  const headerLabels = ['NO','WAKTU SESUAI SURAT','PEMASANGAN','ACARA','PEMBONGKARAN','KEGIATAN / ACARA','YANG MENGHADIRI','TEMPAT','NO SURAT'];

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

  dates.forEach((date, dateIdx) => {
    const items = byDate[date];
    const d = new Date(date + 'T00:00:00');
    // Format: "Sabtu ,6 Juni 2026" (mempertahankan spasi sebelum koma seperti foto)
    const dayLabel = `${DAY_NAMES_ID[d.getDay()]} ,${d.getDate()} ${MONTH_NAMES_FULL_ID[d.getMonth()]} ${d.getFullYear()}`;

    // 4. Baris Header (Warna Oranye - diulang tiap hari)
    pushRow(headerLabels.slice(), 'header', { hpt: 35 });

    // 5. Pita Nama Hari (Warna Pink)
    let br = pushRow([dayLabel, ...Array(COLS-1).fill('')], 'dayband', { hpt: 22 });
    merges.push({ s:{r:br, c:0}, e:{r:br, c:COLS-1} });

    // 6. Data Per Hari
    items.forEach((b, idx) => {
      const row = [
        idx + 1,
        b.time ? b.time.replace(':', '.') : '',
        b.actPasang !== false ? '✓' : '', // PEMASANGAN (simbol centang asli)
        b.actAcara !== false ? '✓' : '',  // ACARA
        b.actBongkar !== false ? '✓' : '', // PEMBONGKARAN
        b.acara || '',
        b.pemohon || '',
        b.tempat || '',
        b.surat || b.suratmasuk || ''
      ];
      const dr = pushRow(row, 'data', { hpt: 20 });
      dataRowAligns[dr] = row.map((_, c) => (c >= 0 && c <= 4) ? 'center' : 'left');
    });

    // 7. Spasi Jeda 2 Baris untuk grup hari berikutnya (seperti di foto)
    if (dateIdx < dates.length - 1) {
      pushRow(Array(COLS).fill(''), 'blank', { hpt: 15 });
      pushRow(Array(COLS).fill(''), 'blank', { hpt: 15 });
    }
  });

  return { COLS, aoa, merges, rowHeights, rowTypes, dataRowAligns, bulanLabel, dates };
}

function styleStat(){
  return {
    font: { sz: 10, italic: true, color: { rgb: '5A5348' } },
    alignment: { horizontal: 'center', vertical: 'center' }
  };
}

function writeAgendaWorkbook(data, filename, sheetName){
  const { COLS, aoa, merges, rowHeights, rowTypes, dataRowAligns } = data;
  const cellStyles = {};
  function setStyle(r, c, style){ cellStyles[`${r},${c}`] = style; }

  rowTypes.forEach((type, r) => {
    if(type === 'title'){
      setStyle(r, 0, styleTitle());
    }else if(type === 'subtitle'){
      setStyle(r, 0, styleSubtitle());
    }else if(type === 'stat'){
      setStyle(r, 0, styleStat());
    }else if(type === 'header'){
      for(let c=0; c<COLS; c++) setStyle(r, c, styleHeader());
    }else if(type === 'dayband'){
      for(let c=0; c<COLS; c++) setStyle(r, c, styleDayBand());
    }else if(type === 'data'){
      dataRowAligns[r].forEach((align, c) => {
        const style = (c === 2 || c === 3 || c === 4) ? styleCheck() : styleCell(align);
        setStyle(r, c, style);
      });
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!rows'] = rowHeights;
  ws['!cols'] = [
    {wch: 4},   // A: NO
    {wch: 11},  // B: WAKTU SESUAI SURAT
    {wch: 13},  // C: PEMASANGAN
    {wch: 9},   // D: ACARA
    {wch: 16},  // E: PEMBONGKARAN
    {wch: 45},  // F: KEGIATAN / ACARA
    {wch: 18},  // G: YANG MENGHADIRI
    {wch: 35},  // H: TEMPAT
    {wch: 28}   // I: NO SURAT
  ];

  Object.keys(cellStyles).forEach(key => {
    const [rr, cc] = key.split(',').map(Number);
    const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
    if(!ws[addr]) ws[addr] = { t: 's', v: '' };
    ws[addr].s = cellStyles[key];
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Agenda Sound System');
  XLSX.writeFile(wb, filename);
}

function exportToExcel(){
  if(bookings.length === 0){
    alert('Belum ada data untuk di-export.');
    return;
  }
  const data = buildAgendaData(bookings);
  const today = new Date().toISOString().slice(0,10);
  writeAgendaWorkbook(data, `agenda-sound-system-${today}.xlsx`, 'Agenda Sound System');
}

function exportMonthReport(ym){
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
  writeAgendaWorkbook(data, filename, monthLabel);
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

function handleOpenGoogleSheets(){
  if(bookings.length === 0){
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
      createAndFillGoogleSheet().catch(err => {
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

async function createAndFillGoogleSheet(){
  const btn = document.getElementById('btn-gsheets');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Membuat Google Sheets...';

  try{
    const data = buildAgendaData();
    const today = new Date().toISOString().slice(0,10);

    // 1. Buat spreadsheet baru
    const createResp = await gapi.client.sheets.spreadsheets.create({
      properties: { title: `Agenda Sound System - ${today}` },
      sheets: [{ properties: { title: 'Agenda Sound System' } }]
    });
    const spreadsheetId = createResp.result.spreadsheetId;
    const sheetId = createResp.result.sheets[0].properties.sheetId;

    // 2. Isi nilai sel
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Agenda Sound System!A1',
      valueInputOption: 'RAW',
      resource: { values: data.aoa }
    });

    // 3. Format: merge, warna, border, lebar kolom, tinggi baris
    const requests = [];
    const COLS = data.COLS;

    // Lebar kolom
    const colWidths = [40,90,100,100,100,500,170,350,350];
    colWidths.forEach((w, c) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c+1 },
          properties: { pixelSize: w },
          fields: 'pixelSize'
        }
      });
    });

    // Merge judul, subjudul, dan pita hari
    data.merges.forEach(m => {
      requests.push({
        mergeCells: {
          range: { sheetId, startRowIndex: m.s.r, endRowIndex: m.e.r+1, startColumnIndex: m.s.c, endColumnIndex: m.e.c+1 },
          mergeType: 'MERGE_ALL'
        }
      });
    });

    const orange = rgbToGoogleColor('F6B26B');
    const pink = rgbToGoogleColor('EA9999');
    const border = { style: 'SOLID', color: { red:0, green:0, blue:0 } };
    const thinBorders = { top: border, bottom: border, left: border, right: border };

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
            backgroundColor: orange,
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
            backgroundColor: pink,
            horizontalAlignment:'LEFT', verticalAlignment:'MIDDLE',
            borders: thinBorders
          } },
          fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,borders)'
        }});
      }else if(type === 'data'){
        data.dataRowAligns[r].forEach((align, c) => {
          const isCheckCol = (c === 2 || c === 3 || c === 4);
          requests.push({ repeatCell: {
            range: { sheetId, startRowIndex:r, endRowIndex:r+1, startColumnIndex:c, endColumnIndex:c+1 },
            cell: { userEnteredFormat: {
              textFormat: isCheckCol
                ? { fontSize:13, bold:true, foregroundColor:{ red:0.18, green:0.49, blue:0.20 } }
                : { fontSize:10 },
              horizontalAlignment: (isCheckCol || align === 'center') ? 'CENTER' : 'LEFT',
              verticalAlignment:'MIDDLE', wrapStrategy:'WRAP',
              borders: thinBorders
            } },
            fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders)'
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
  const filtered = searchDate ? bookings.filter(b => b.date === searchDate) : bookings;

  if(bookings.length === 0){
    wrap.innerHTML = '<p class="empty-note">Belum ada data peminjaman.</p>';
    return;
  }
  if(searchDate && filtered.length === 0){
    wrap.innerHTML = `<p class="empty-note">Tidak ada peminjaman di tanggal ${fmtDateID(searchDate)}.</p>`;
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

  let html = '<div class="rekap-scroll"><table><thead><tr><th>Tanggal / Jumlah</th><th>Waktu</th><th>Kegiatan</th><th>Yang Menghadiri</th><th>Tempat</th><th>No. e-Surat</th><th>No. Surat Balasan</th><th></th></tr></thead><tbody>';

  months.forEach(ym => {
    const [y, m] = ym.split('-');
    const monthLabel = `${MONTH_NAMES_FULL_ID[parseInt(m,10)-1]} ${y}`;
    const datesInMonth = Object.keys(byMonth[ym]).sort();
    const totalInMonth = datesInMonth.reduce((sum, d) => sum + byMonth[ym][d].length, 0);
    const isOpen = expandedMonths.has(ym);

    html += `<tr class="month-row ${isOpen ? 'month-row-open' : ''}" id="month-row-${ym}" onclick="toggleMonth('${ym}')">
      <td colspan="8">
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
        html += `<tr><td colspan="8" style="background:#f6f4ee;padding:8px 10px;">
          <span class="datebadge">${fmtDateID(date)}</span>
          <span class="${full ? 'count-full' : 'count-ok'}">${items.length}/${LIMIT_PER_DAY} ${full ? '(PENUH)' : ''}</span>
        </td></tr>`;
        items.forEach(b => {
          html += `<tr>
            <td></td>
            <td>${b.time || '-'}</td>
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

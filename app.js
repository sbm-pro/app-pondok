// GANTI dengan URL Web App hasil deploy Google Apps Script
const API_URL = "https://script.google.com/macros/s/AKfycbyakJbsq4ZjcaAJbfwRssAg9opKzVpXT3e8MPzKhhU2E_sWyycPmF4EifRrv9hcV4ck/exec";

let currentUser = null;
let currentToken = null;
let currentSantriId = null; // untuk portal wali
let santriListCache = [];
let sesiListCache = [];
let asramaListCache = [];
let sppListCache = [];
let pengaturanCache = null;
let scanMode = "absensi";
let html5QrCode = null;
let loginQrCode = null;

function buatLinkWa(noWa, pesan) {
  const nomor = String(noWa).replace(/[^0-9]/g, "");
  return "https://wa.me/" + nomor + "?text=" + encodeURIComponent(pesan);
}

function showView(id) {
  document.querySelectorAll(".app-shell").forEach(el => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function lastRoleHome() {
  if (!currentUser) return "view-login";
  return (currentUser.role === "Admin" || currentUser.role === "Ustadz") ? "view-admin-santri" : "view-wali";
}

async function apiGet(action, params = {}) {
  const query = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${API_URL}?${query}`);
  return res.json();
}

async function apiPost(action, data = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action, token: currentToken, ...data })
  });
  return res.json();
}

// ---------- LOGIN ----------

function togglePasswordVisibility() {
  const input = document.getElementById("login-password");
  const icon = document.getElementById("toggle-password-icon");
  if (input.type === "password") {
    input.type = "text";
    icon.classList.remove("ti-eye"); icon.classList.add("ti-eye-off");
  } else {
    input.type = "password";
    icon.classList.remove("ti-eye-off"); icon.classList.add("ti-eye");
  }
}

async function lupaSandi() {
  const username = document.getElementById("login-username").value.trim();
  const pengaturan = await apiGet("getPengaturan");
  if (!pengaturan.wa_admin_pondok) {
    alert("Nomor WA admin pondok belum diatur. Hubungi admin pondok secara langsung.");
    return;
  }
  const pesan = "Assalamualaikum, saya lupa password akun portal pondok" +
    (username ? " (username: " + username + ")" : "") + ". Mohon bantuannya untuk reset password.";
  window.open(buatLinkWa(pengaturan.wa_admin_pondok, pesan), "_blank");
}

async function doLogin() {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  let result = await apiPost("login", { username, password, tipe: "staff" });
  if (!result.success) result = await apiPost("login", { username, password, tipe: "wali" });
  if (!result.success) { errorEl.textContent = result.message || "Login gagal"; return; }

  currentUser = result.user;
  currentToken = result.token;
  routeAfterLogin();
}

function openLoginScan() {
  document.getElementById("login-scan-error").textContent = "";
  showView("view-login-scan");
  const readerEl = document.getElementById("qr-reader-login");
  readerEl.innerHTML = "";
  loginQrCode = new Html5Qrcode("qr-reader-login");
  loginQrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    decodedText => { stopLoginScanner(); prosesLoginQr(decodedText.trim()); },
    () => {}
  ).catch(err => {
    document.getElementById("login-scan-error").textContent = "Tidak bisa mengakses kamera: " + err;
  });
}

function stopLoginScanner() {
  if (loginQrCode) { loginQrCode.stop().catch(() => {}); loginQrCode = null; }
}

function backFromLoginScan() {
  stopLoginScanner();
  showView("view-login");
}

async function prosesLoginQr(santriId) {
  const result = await apiPost("loginViaQrSantri", { santri_id: santriId });
  if (!result.success) {
    document.getElementById("login-scan-error").textContent = result.message || "QR tidak dikenali";
    return;
  }
  currentUser = result.user;
  currentToken = result.token;
  currentSantriId = result.user.santri_id_utama;
  showView("view-wali");
  loadRekapWali();
}

function logout() {
  currentUser = null;
  currentToken = null;
  stopScanner();
  showView("view-login");
}

function routeAfterLogin() {
  if (currentUser.role === "Admin" || currentUser.role === "Ustadz") {
    showView("view-admin-santri");
    loadSantriList();
  } else {
    currentSantriId = currentUser.santri_id_utama || null;
    showView("view-wali");
    loadRekapWali();
  }
}

// ---------- PORTAL WALI ----------

async function loadRekapWali() {
  if (!currentSantriId) return;
  const data = await apiGet("getRekapWali", { santri_id: currentSantriId });

  document.getElementById("wali-santri-nama").textContent = data.santri.nama || "-";
  document.getElementById("wali-santri-info").textContent = `${data.santri.kelas || ""} · ${data.santri.kamar || ""}`;
  document.getElementById("wali-saldo").textContent = "Rp " + Number(data.saldo || 0).toLocaleString("id-ID");

  const absensiTerbaru = data.absensi_terbaru || [];
  document.getElementById("wali-absensi-ringkas").textContent = absensiTerbaru.length
    ? `${absensiTerbaru.filter(a => a.status === "Hadir").length}/${absensiTerbaru.length} hadir`
    : "-";

  const aktivitasEl = document.getElementById("wali-aktivitas");
  aktivitasEl.innerHTML = "";
  absensiTerbaru.slice(-5).reverse().forEach(a => {
    aktivitasEl.innerHTML += `<div class="list-row"><span><i class="ti ti-check" style="color:var(--hijau-sukses);"></i> ${a.status} - sesi ${a.sesi_id}</span><span style="color:var(--abu-teks);">${a.tanggal}</span></div>`;
  });

  const hafalanEl = document.getElementById("wali-hafalan-list");
  const iqro = (data.hafalan_iqro || []).slice(-1)[0];
  const quran = (data.hafalan_quran || []).slice(-1)[0];
  hafalanEl.innerHTML = "";
  if (iqro) hafalanEl.innerHTML += `<div class="list-row"><span>Iqro</span><span>Jilid ${iqro.jilid}, hal. ${iqro.halaman}</span></div>`;
  if (quran) hafalanEl.innerHTML += `<div class="list-row"><span>Al-Qur'an</span><span>${quran.surat} ${quran.ayat_mulai}-${quran.ayat_selesai}</span></div>`;
  if (!iqro && !quran) hafalanEl.innerHTML = "Belum ada data.";

  const pelanggaranEl = document.getElementById("wali-pelanggaran-list");
  const pelanggaran = data.pelanggaran_terbaru || [];
  pelanggaranEl.innerHTML = pelanggaran.length
    ? pelanggaran.slice().reverse().map(p =>
        `<div class="list-row"><span><i class="ti ti-alert-triangle" style="color:var(--merah);"></i> ${p.jenis_pelanggaran}</span><span style="color:var(--abu-teks);">${p.tanggal}</span></div>`
      ).join("")
    : "Tidak ada catatan.";
}

async function ajukanIzinPrompt() {
  const jenis = prompt("Jenis izin (Pulang/Sakit/Lainnya):", "Pulang");
  if (!jenis) return;
  const tanggalMulai = prompt("Tanggal mulai (YYYY-MM-DD):");
  if (!tanggalMulai) return;
  const tanggalSelesai = prompt("Tanggal selesai (YYYY-MM-DD):", tanggalMulai);
  const keterangan = prompt("Keterangan tambahan (opsional):", "");

  const result = await apiPost("ajukanPerizinan", {
    data: { santri_id: currentSantriId, jenis, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalSelesai, keterangan }
  });
  if (result.error) { alert(result.error); return; }
  alert("Izin diajukan, menunggu persetujuan pengasuh.");
}

// ---------- KARTU SANTRI ----------

async function muatKartuSantri() {
  const santriId = currentSantriId || (santriListCache[0] && santriListCache[0].santri_id);
  if (!santriId) return;
  const s = await apiGet("getSantriDetail", { santri_id: santriId });
  document.getElementById("kartu-nama").textContent = s.nama || "-";
  document.getElementById("kartu-nis").textContent = "NIS: " + (s.nis || "-");
  document.getElementById("kartu-kelas").textContent = s.kelas || "-";
  document.getElementById("kartu-asrama").textContent = (s.asrama_id || "-") + (s.kamar ? ", kmr " + s.kamar : "");
  document.getElementById("kartu-foto").innerHTML = s.foto_url
    ? `<img src="${s.foto_url}" style="width:100%; height:100%; object-fit:cover; border-radius:8px;" />`
    : `<i class="ti ti-user"></i>`;
  document.getElementById("kartu-qr-img").src = s.qr_code_url || "";
}

function downloadKartuPng() {
  const el = document.getElementById("kartu-cetak-area");
  html2canvas(el, { backgroundColor: "#ffffff", scale: 2 }).then(canvas => {
    const link = document.createElement("a");
    link.download = "kartu-santri.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
}

// ---------- SCANNER (ABSENSI / KANTIN) ----------

function setScanMode(mode) {
  scanMode = mode;
  document.getElementById("chip-mode-absensi").classList.toggle("active", mode === "absensi");
  document.getElementById("chip-mode-kantin").classList.toggle("active", mode === "kantin");
  document.getElementById("scan-opsi-absensi").classList.toggle("hidden", mode !== "absensi");
  document.getElementById("scan-opsi-kantin").classList.toggle("hidden", mode !== "kantin");
}

async function muatSesiUntukScan() {
  sesiListCache = await apiGet("getSesiList");
  const sel = document.getElementById("scan-sesi");
  sel.innerHTML = sesiListCache.map(s => `<option value="${s.sesi_id}">${s.nama_sesi}</option>`).join("");
}

function startScanner() {
  const readerEl = document.getElementById("qr-reader");
  readerEl.innerHTML = "";
  html5QrCode = new Html5Qrcode("qr-reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    decodedText => { prosesSantriId(decodedText, "Scan QR"); },
    () => {}
  ).catch(err => {
    document.getElementById("scan-hasil").classList.remove("hidden");
    document.getElementById("scan-hasil").innerHTML = `<p style="color:var(--merah); font-size:12px;">Tidak bisa mengakses kamera: ${err}</p>`;
  });
}

function stopScanner() {
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }
}

async function prosesSantriId(santriId, metode) {
  if (!santriId) return;
  santriId = santriId.trim();
  const hasilEl = document.getElementById("scan-hasil");
  hasilEl.classList.remove("hidden");

  if (scanMode === "absensi") {
    const sesiId = document.getElementById("scan-sesi").value;
    const result = await apiPost("scanAbsensi", { santri_id: santriId, sesi_id: sesiId, status: "Hadir", metode });
    if (result.error) { hasilEl.innerHTML = `<p style="color:var(--merah);">${result.error}</p>`; return; }
    hasilEl.innerHTML = `<p style="color:var(--hijau-sukses);"><i class="ti ti-check"></i> Absensi tercatat untuk ${santriId}</p>`;
  } else {
    const jumlah = Number(document.getElementById("scan-nominal").value || 0);
    if (!jumlah) { hasilEl.innerHTML = `<p style="color:var(--merah);">Isi nominal jajan dulu.</p>`; return; }
    const result = await apiPost("tabunganTarikJajan", {
      santri_id: santriId, jumlah, dicatat_oleh: currentUser.user_id, metode
    });
    if (result.error) { hasilEl.innerHTML = `<p style="color:var(--merah);">${result.error}</p>`; return; }
    let html = `<p style="color:var(--hijau-sukses);"><i class="ti ti-check"></i> Transaksi Rp ${jumlah.toLocaleString("id-ID")} tercatat. Saldo sekarang: Rp ${Number(result.saldo_setelah).toLocaleString("id-ID")}</p>`;
    if (result.wa_bendahara_santri) {
      html += `<button class="btn wa" style="width:100%; margin-top:8px;" onclick="window.open('${result.wa_bendahara_santri}','_blank')"><i class="ti ti-brand-whatsapp"></i> Saldo habis - WA bendahara santri</button>`;
    }
    hasilEl.innerHTML = html;
  }
}

// ---------- ADMIN: DATA SANTRI ----------

async function loadSantriList() {
  santriListCache = await apiGet("getSantriList");
  sppListCache = await apiGet("getSppList", {});
  pengaturanCache = await apiGet("getPengaturan");
  renderAdminSantriList();
}

function sppTerbaruSantri(santriId) {
  const rows = sppListCache.filter(s => s.santri_id === santriId);
  return rows.length ? rows[rows.length - 1] : null;
}

function renderAdminSantriList() {
  const keyword = document.getElementById("admin-cari-santri").value.toLowerCase();
  const listEl = document.getElementById("admin-santri-list");
  listEl.innerHTML = "";

  santriListCache
    .filter(s => (s.nama || "").toLowerCase().includes(keyword))
    .forEach(s => {
      const spp = sppTerbaruSantri(s.santri_id);
      const sppBelumLunas = spp && spp.status !== "Lunas";
      listEl.innerHTML += `
        <div class="card">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:44px;height:44px;border-radius:10px;background:var(--abu-muda);display:flex;align-items:center;justify-content:center; overflow:hidden;">
              ${s.foto_url ? `<img src="${s.foto_url}" style="width:100%;height:100%;object-fit:cover;" />` : `<i class="ti ti-user" style="font-size:20px;"></i>`}
            </div>
            <div style="flex:1;">
              <p style="font-weight:500; margin:0;">${s.nama}</p>
              <p style="font-size:11px; color:var(--abu-teks); margin:2px 0 0;">${s.kelas || ""} · ${s.kamar || ""}</p>
            </div>
            ${sppBelumLunas ? `<span class="badge belum">SPP belum</span>` : ""}
          </div>
          <div style="display:flex; gap:6px; margin-top:12px;">
            <button class="btn" onclick="bukaFormEditSantri('${s.santri_id}')"><i class="ti ti-edit"></i> Edit</button>
            <button class="btn danger" onclick="hapusSantri('${s.santri_id}')"><i class="ti ti-trash"></i> Hapus</button>
            <button class="btn wa" onclick="kirimWaliWa('${s.santri_id}')"><i class="ti ti-brand-whatsapp"></i> Wali</button>
          </div>
          <button class="btn outline" style="width:100%; margin-top:6px;" onclick="catatPelanggaranPrompt('${s.santri_id}')"><i class="ti ti-alert-triangle"></i> Catat pelanggaran</button>
          ${sppBelumLunas ? `
          <div style="margin-top:8px; background:var(--merah-bg); border-radius:8px; padding:8px 10px; display:flex; align-items:center; gap:8px;">
            <i class="ti ti-alert-circle" style="color:var(--merah); font-size:14px;"></i>
            <p style="font-size:11px; color:var(--merah); margin:0; flex:1;">SPP bulan ${spp.bulan} belum lunas</p>
            <button style="font-size:11px; background:var(--merah); color:#fff; border:none; border-radius:6px; padding:5px 10px; white-space:nowrap; cursor:pointer;" onclick="waBendaharaPondok('${s.santri_id}','${spp.bulan}')">WA bendahara</button>
          </div>` : ""}
        </div>`;
    });
}

let editingSantriId = null;
let fotoBase64Baru = null;

function bukaFormTambahSantri() {
  editingSantriId = null;
  fotoBase64Baru = null;
  document.getElementById("santri-form-title").textContent = "Tambah santri";
  ["form-nama", "form-nis", "form-kelas", "form-asrama", "form-kamar", "form-tempat-lahir", "form-tanggal-lahir", "form-alamat"]
    .forEach(id => document.getElementById(id).value = "");
  document.getElementById("form-level").value = "Iqro";
  document.getElementById("santri-form-foto-preview").innerHTML = `<i class="ti ti-user" style="font-size:36px;"></i>`;
  document.getElementById("santri-form-status").textContent = "";
  showView("view-santri-form");
}

async function bukaFormEditSantri(santriId) {
  editingSantriId = santriId;
  fotoBase64Baru = null;
  document.getElementById("santri-form-title").textContent = "Edit santri";
  const s = await apiGet("getSantriDetail", { santri_id: santriId });

  document.getElementById("form-nama").value = s.nama || "";
  document.getElementById("form-nis").value = s.nis || "";
  document.getElementById("form-kelas").value = s.kelas || "";
  document.getElementById("form-level").value = s.level_hafalan || "Iqro";
  document.getElementById("form-asrama").value = s.asrama_id || "";
  document.getElementById("form-kamar").value = s.kamar || "";
  document.getElementById("form-tempat-lahir").value = s.tempat_lahir || "";
  document.getElementById("form-tanggal-lahir").value = s.tanggal_lahir || "";
  document.getElementById("form-alamat").value = s.alamat || "";

  document.getElementById("santri-form-foto-preview").innerHTML = s.foto_url
    ? `<img src="${s.foto_url}" style="width:100%; height:100%; object-fit:cover;" />`
    : `<i class="ti ti-user" style="font-size:36px;"></i>`;
  document.getElementById("santri-form-status").textContent = "";
  showView("view-santri-form");
}

function previewFotoSantri(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    fotoBase64Baru = reader.result;
    document.getElementById("santri-form-foto-preview").innerHTML = `<img src="${fotoBase64Baru}" style="width:100%; height:100%; object-fit:cover;" />`;
  };
  reader.readAsDataURL(file);
}

async function simpanSantriForm() {
  const data = {
    nama: document.getElementById("form-nama").value.trim(),
    nis: document.getElementById("form-nis").value.trim(),
    kelas: document.getElementById("form-kelas").value.trim(),
    level_hafalan: document.getElementById("form-level").value,
    asrama_id: document.getElementById("form-asrama").value.trim(),
    kamar: document.getElementById("form-kamar").value.trim(),
    tempat_lahir: document.getElementById("form-tempat-lahir").value.trim(),
    tanggal_lahir: document.getElementById("form-tanggal-lahir").value,
    alamat: document.getElementById("form-alamat").value.trim()
  };
  if (!data.nama) { alert("Nama wajib diisi."); return; }

  const statusEl = document.getElementById("santri-form-status");
  statusEl.style.color = "var(--abu-teks)";
  statusEl.textContent = "Menyimpan...";

  let result;
  if (editingSantriId) {
    result = await apiPost("editSantri", { santri_id: editingSantriId, updates: data, foto_base64: fotoBase64Baru });
  } else {
    data.status = "Aktif";
    result = await apiPost("addSantri", { data, foto_base64: fotoBase64Baru });
  }

  if (result.error) { statusEl.style.color = "var(--merah)"; statusEl.textContent = result.error; return; }
  statusEl.style.color = "var(--hijau-sukses)";
  statusEl.textContent = "Tersimpan.";
  loadSantriList();
  setTimeout(() => showView("view-admin-santri"), 500);
}

async function hapusSantri(santriId) {
  if (!confirm("Yakin hapus data santri ini?")) return;
  const result = await apiPost("deleteSantri", { santri_id: santriId });
  if (result.error) { alert(result.error); return; }
  loadSantriList();
}

async function kirimWaliWa(santriId) {
  const waliId = prompt("Masukkan ID wali santri ini:");
  if (!waliId) return;
  const resetPassword = confirm("Buat password baru untuk wali ini? (OK = ya, Cancel = pakai yang lama)");
  const result = await apiPost("kirimWaKeWali", {
    wali_id: waliId,
    app_link: window.location.origin,
    password_baru: resetPassword ? null : "TETAP" // catatan: backend hanya generate baru jika password_baru kosong
  });
  if (result.error) { alert(result.error); return; }
  if (result.wa_link) window.open(result.wa_link, "_blank");
}

async function catatPelanggaranPrompt(santriId) {
  const jenis = prompt("Jenis pelanggaran:");
  if (!jenis) return;
  const keterangan = prompt("Keterangan tambahan (opsional):", "") || "";
  const result = await apiPost("catatPelanggaran", {
    santri_id: santriId,
    jenis_pelanggaran: jenis,
    keterangan,
    dicatat_oleh: currentUser.user_id
  });
  if (result.error) { alert(result.error); return; }
  if (result.wa_wali) {
    if (confirm("Pelanggaran tercatat. Kirim info ke WA wali sekarang?")) {
      window.open(result.wa_wali, "_blank");
    }
  } else {
    alert("Pelanggaran tercatat. (Belum ada data wali yang terhubung ke santri ini, WA tidak terkirim.)");
  }
}

// ---------- ADMIN: REKAP & EXPORT ----------

let rekapKategoriAktif = "semua";

document.addEventListener("click", e => {
  if (e.target.closest && e.target.closest("#rekap-kategori-chips .chip")) {
    const chip = e.target.closest(".chip");
    document.querySelectorAll("#rekap-kategori-chips .chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    rekapKategoriAktif = chip.dataset.val;
  }
});

function ambilFilterRekap() {
  return {
    kategori: rekapKategoriAktif,
    santri_id: document.getElementById("rekap-santri").value,
    dari: document.getElementById("rekap-dari").value,
    sampai: document.getElementById("rekap-sampai").value
  };
}

async function muatRekap() {
  const filter = ambilFilterRekap();
  const data = await apiGet("getRekapAdmin", filter);
  const hasilEl = document.getElementById("rekap-hasil");
  hasilEl.classList.remove("hidden");
  hasilEl.innerHTML = `<pre style="font-size:11px; white-space:pre-wrap; margin:0;">${JSON.stringify(data, null, 2)}</pre>`;

  // isi dropdown santri kalau belum
  const selSantri = document.getElementById("rekap-santri");
  if (selSantri.options.length <= 1) {
    if (santriListCache.length === 0) santriListCache = await apiGet("getSantriList");
    santriListCache.forEach(s => selSantri.innerHTML += `<option value="${s.santri_id}">${s.nama}</option>`);
  }
}

async function exportRekap(tipe) {
  const filter = ambilFilterRekap();
  const action = tipe === "pdf" ? "generateRekapPdf" : "generateRekapExcel";
  const result = await apiPost(action, filter);
  if (result.error) { alert(result.error); return; }
  window.open(result.url, "_blank");
}

// ---------- ADMIN: PERIZINAN ----------

async function muatPerizinan() {
  const rows = await apiGet("getPerizinanList", {});
  const listEl = document.getElementById("perizinan-list");
  listEl.innerHTML = "";
  rows.forEach(r => {
    const badgeClass = r.status === "Disetujui" ? "disetujui" : r.status === "Ditolak" ? "ditolak" : "menunggu";
    listEl.innerHTML += `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <p style="margin:0; font-weight:500;">${r.santri_id} - ${r.jenis}</p>
          <span class="badge ${badgeClass}">${r.status}</span>
        </div>
        <p style="font-size:12px; color:var(--abu-teks); margin:4px 0 0;">${r.tanggal_mulai} s/d ${r.tanggal_selesai}</p>
        ${r.status === "Menunggu" ? `
        <div style="display:flex; gap:6px; margin-top:10px;">
          <button class="btn primary" style="flex:1;" onclick="setujuiPerizinan('${r.izin_id}')">Setujui</button>
          <button class="btn danger" style="flex:1;" onclick="tolakPerizinanAksi('${r.izin_id}')">Tolak</button>
        </div>` : ""}
      </div>`;
  });
}

async function setujuiPerizinan(izinId) {
  await apiPost("approvePerizinan", { izin_id: izinId, disetujui_oleh: currentUser.user_id });
  muatPerizinan();
}
async function tolakPerizinanAksi(izinId) {
  await apiPost("tolakPerizinan", { izin_id: izinId, disetujui_oleh: currentUser.user_id });
  muatPerizinan();
}

// ---------- ADMIN: SESI KEGIATAN ----------

async function muatSesiList() {
  sesiListCache = await apiGet("getSesiList");
  const el = document.getElementById("sesi-list");
  el.innerHTML = "";
  sesiListCache.forEach(s => {
    el.innerHTML += `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div><p style="margin:0; font-weight:500;">${s.nama_sesi}</p>
          <p style="font-size:11px; color:var(--abu-teks); margin:2px 0 0;">Mulai ${s.jam_mulai} · batas ${s.batas_waktu_menit} menit</p></div>
          <button class="btn danger" onclick="hapusSesi('${s.sesi_id}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
  });
}

async function tambahSesiPrompt() {
  const nama = prompt("Nama sesi (contoh: Sholat Subuh):");
  if (!nama) return;
  const jam = prompt("Jam mulai (HH:MM):", "04:30") || "";
  const batas = prompt("Batas waktu sebelum otomatis Alpa (menit):", "30") || "30";
  await apiPost("addSesi", { data: { nama_sesi: nama, jam_mulai: jam, batas_waktu_menit: Number(batas) } });
  muatSesiList();
}

async function hapusSesi(sesiId) {
  if (!confirm("Hapus sesi ini?")) return;
  await apiPost("deleteSesi", { sesi_id: sesiId });
  muatSesiList();
}

// ---------- ADMIN: ASRAMA ----------

async function muatAsramaList() {
  asramaListCache = await apiGet("getAsramaList");
  const el = document.getElementById("asrama-list");
  el.innerHTML = "";
  asramaListCache.forEach(a => {
    el.innerHTML += `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div><p style="margin:0; font-weight:500;">${a.nama_asrama}</p>
          <p style="font-size:11px; color:var(--abu-teks); margin:2px 0 0;">Kapasitas: ${a.kapasitas}</p></div>
          <button class="btn danger" onclick="hapusAsrama('${a.asrama_id}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
  });
}

async function tambahAsramaPrompt() {
  const nama = prompt("Nama asrama:");
  if (!nama) return;
  const kapasitas = prompt("Kapasitas (jumlah santri):", "20") || "20";
  await apiPost("addAsrama", { data: { nama_asrama: nama, kapasitas: Number(kapasitas) } });
  muatAsramaList();
}

async function hapusAsrama(asramaId) {
  if (!confirm("Hapus asrama ini?")) return;
  await apiPost("deleteAsrama", { asrama_id: asramaId });
  muatAsramaList();
}

// ---------- ADMIN: KONTAK WA ----------

async function muatKontakWa() {
  pengaturanCache = await apiGet("getPengaturan");
  document.getElementById("wa-admin-pondok").value = pengaturanCache.wa_admin_pondok || "";
  document.getElementById("wa-bendahara-pondok").value = pengaturanCache.wa_bendahara_pondok || "";
  document.getElementById("wa-bendahara-santri").value = pengaturanCache.wa_bendahara_santri || "";
}

async function simpanKontakWa() {
  const data = {
    wa_admin_pondok: document.getElementById("wa-admin-pondok").value.trim(),
    wa_bendahara_pondok: document.getElementById("wa-bendahara-pondok").value.trim(),
    wa_bendahara_santri: document.getElementById("wa-bendahara-santri").value.trim()
  };
  const result = await apiPost("updatePengaturan", { data });
  const statusEl = document.getElementById("kontak-wa-status");
  if (result.error) {
    statusEl.style.color = "var(--merah)";
    statusEl.textContent = result.error;
    return;
  }
  pengaturanCache = data;
  statusEl.style.color = "var(--hijau-sukses)";
  statusEl.textContent = "Tersimpan.";
}

function waBendaharaPondok(santriId, bulan) {
  if (!pengaturanCache || !pengaturanCache.wa_bendahara_pondok) {
    alert("Nomor WA bendahara pondok belum diatur. Atur dulu di Pengaturan > Kontak WA.");
    return;
  }
  const pesan = "Assalamualaikum, ingin menanyakan pembayaran SPP bulan " + bulan +
    " untuk santri dengan ID " + santriId + ".";
  window.open(buatLinkWa(pengaturanCache.wa_bendahara_pondok, pesan), "_blank");
}

// Mulai di halaman login
showView("view-login");

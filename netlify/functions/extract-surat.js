// Netlify Function: extract-surat
//
// Menerima PDF surat (base64) dari browser, mengirimkannya ke Google Gemini
// API (GRATIS - tidak perlu billing, cukup API key dari Google AI Studio)
// untuk dibaca, lalu mengembalikan data terstruktur (tanggal, waktu, acara,
// dst) sebagai JSON. API key disimpan sebagai environment variable di
// Netlify (GEMINI_API_KEY) sehingga tidak pernah terlihat oleh
// browser/pengguna.
//
// Cara dapat API key gratis: buka https://aistudio.google.com/apikey,
// login pakai akun Google, klik "Create API key". Tidak perlu kartu kredit.
//
// Endpoint otomatis tersedia di: /.netlify/functions/extract-surat

const GEMINI_MODEL = 'gemini-3.6-flash'; // model gratis, cukup pintar untuk baca surat

const SYSTEM_PROMPT = `Kamu adalah asisten admin Diskominfo yang bertugas membaca surat masuk terkait permohonan peminjaman sound system, lalu mengekstrak informasi pentingnya. Surat bisa datang dari instansi, warga, sekolah, atau pihak lain, dengan format dan tata letak yang BERBEDA-BEDA - baca isinya secara menyeluruh, jangan berasumsi dari posisi/layout tertentu saja.

Kembalikan HANYA sebuah objek JSON (tanpa teks lain, tanpa markdown code fence, tanpa penjelasan) dengan struktur PERSIS seperti ini:

{
  "tanggal": "YYYY-MM-DD atau null",
  "waktu": "HH:MM dalam format 24 jam, atau null",
  "acara": "nama kegiatan/acara, atau null",
  "pemohon": "nama orang/pihak yang mengajukan atau yang akan hadir mewakili, atau null",
  "tempat": "lokasi kegiatan, atau null",
  "nomor_surat": "nomor surat resmi (jika ada), atau null"
}

Aturan penting:
- Kalau suatu informasi tidak ditemukan atau kamu tidak yakin, isi dengan null. JANGAN mengarang atau menebak-nebak data.
- "tanggal" adalah tanggal PELAKSANAAN KEGIATAN (bukan tanggal surat dibuat/dikirim), kecuali surat tidak menyebutkan tanggal kegiatan sama sekali.
- "waktu" adalah jam mulai kegiatan atau jam pemasangan sound system, kalau disebutkan.
- Balas HANYA dengan objek JSON tersebut, tidak ada teks lain sebelum atau sesudahnya.`;

exports.handler = async function (event) {
  // CORS dasar (biar aman dipanggil dari origin situs sendiri)
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let pdfBase64;
  try {
    const body = JSON.parse(event.body || '{}');
    pdfBase64 = body.pdfBase64;
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body request tidak valid.' }) };
  }

  if (!pdfBase64) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'File PDF tidak ditemukan di request.' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'GEMINI_API_KEY belum diset di Environment Variables Netlify. Lihat panduan setup.' })
    };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const geminiResp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
              { text: 'Ekstrak data dari surat ini sesuai instruksi di system prompt. Balas hanya dengan JSON.' }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0
        }
      })
    });

    const data = await geminiResp.json();

    if (!geminiResp.ok) {
      const msg = (data && data.error && data.error.message) || 'Gagal menghubungi Gemini API.';
      return { statusCode: geminiResp.status, headers, body: JSON.stringify({ error: msg }) };
    }

    const rawText =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text) ||
      '{}';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let extracted;
    try {
      extracted = JSON.parse(cleaned);
    } catch (e) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Hasil ekstraksi tidak berupa JSON yang valid. Coba lagi atau isi manual.' })
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data: extracted }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Terjadi kesalahan tak terduga.' }) };
  }
};

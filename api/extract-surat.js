// Vercel Serverless Function: /api/extract-surat
//
// Menerima PDF surat (base64) dari browser, mengirimkannya ke Google Gemini
// API untuk dibaca, lalu mengembalikan data terstruktur (tanggal, waktu,
// acara, dst) sebagai JSON. API key disimpan sebagai Environment Variable
// di Vercel (GEMINI_API_KEY), sehingga tidak pernah terlihat oleh
// browser/pengguna.
//
// Cara dapat API key gratis: buka https://aistudio.google.com/apikey,
// login pakai akun Google, klik "Create API key". Tidak perlu kartu kredit.
//
// Endpoint otomatis tersedia di: /api/extract-surat
// (nama file ini menentukan URL-nya, karena berada di folder /api)

const GEMINI_MODEL = 'gemini-3.8-flash'; // model terbaru Google (gemini-2.5-flash sudah pensiun untuk pengguna baru)

const SYSTEM_PROMPT = `Kamu adalah asisten admin Diskominfo yang bertugas membaca surat masuk terkait permohonan peminjaman sound system, lalu mengekstrak informasi pentingnya. Surat bisa datang dari instansi, warga, sekolah, atau pihak lain, dengan format dan tata letak yang BERBEDA-BEDA - baca isinya secara menyeluruh, jangan berasumsi dari posisi/layout tertentu saja.

Kembalikan HANYA sebuah objek JSON (tanpa teks lain, tanpa markdown code fence, tanpa penjelasan) dengan struktur PERSIS seperti ini:

{
  "tanggal": "YYYY-MM-DD atau null",
  "waktu": "HH:MM dalam format 24 jam, atau null",
  "acara": "nama kegiatan/acara, atau null",
  "tempat": "lokasi kegiatan, atau null",
  "nomor_surat": "nomor surat resmi (jika ada), atau null"
}

Aturan penting:
- Kalau suatu informasi tidak ditemukan atau kamu tidak yakin, isi dengan null. JANGAN mengarang atau menebak-nebak data.
- "tanggal" adalah tanggal PELAKSANAAN KEGIATAN (bukan tanggal surat dibuat/dikirim), kecuali surat tidak menyebutkan tanggal kegiatan sama sekali.
- "waktu" adalah jam mulai kegiatan atau jam pemasangan sound system, kalau disebutkan.
- Balas HANYA dengan objek JSON tersebut, tidak ada teks lain sebelum atau sesudahnya.`;

module.exports = async function handler(req, res) {
  // CORS dasar
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const pdfBase64 = req.body && req.body.pdfBase64;
  if (!pdfBase64) {
    res.status(400).json({ error: 'File PDF tidak ditemukan di request.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'GEMINI_API_KEY belum diset di Environment Variables Vercel. Lihat panduan setup.'
    });
    return;
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
      res.status(geminiResp.status).json({ error: msg });
      return;
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
      res.status(502).json({ error: 'Hasil ekstraksi tidak berupa JSON yang valid. Coba lagi atau isi manual.' });
      return;
    }

    res.status(200).json({ ok: true, data: extracted });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Terjadi kesalahan tak terduga.' });
  }
};

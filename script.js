// ============================
// Variabel Global
// ============================

// Variabel debounce untuk input terjemahan
let debounceTimer;

// Variabel global untuk database IndexedDB
let db;

// ============================
// Fungsi Modal & Tampilan Editor
// ============================
function toggleGlossaryModal() {
  const modal = document.getElementById("glossaryModal");
  // Jika modal belum tampil, tampilkan; sebaliknya, sembunyikan
  modal.style.display = (modal.style.display === "block") ? "none" : "block";
}

function toggleGlossaryEditor() {
  const editor = document.getElementById('glossaryEditor');
  const preview = document.getElementById('glossaryPreview');

  if (editor.style.display === 'none' || editor.style.display === '') {
    editor.style.display = 'block';
    preview.style.display = 'block';
    renderGlossaryList();
  } else {
    editor.style.display = 'none';
    preview.style.display = 'none';
  }
}

// ============================
// IndexedDB Helper Functions
// ============================
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("TranslatorDB", 1);
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains("appStore")) {
        database.createObjectStore("appStore", { keyPath: "key" });
      }
    };
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("appStore", "readonly");
    const store = tx.objectStore("appStore");
    const request = store.get(key);
    request.onsuccess = () => {
      resolve(request.result ? request.result.value : null);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

function idbSet(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("appStore", "readwrite");
    const store = tx.objectStore("appStore");
    const request = store.put({ key, value });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbRemove(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("appStore", "readwrite");
    const store = tx.objectStore("appStore");
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

const MAX_CHARS = 4500;
let glossary = {};
let translationHistory = [];

async function resetGlossary() {
  if (await customConfirm("Yakin ingin menghapus semua entri glosarium?")) {
    glossary = {};
    try {
      await idbSet("glossary", glossary);
      showToast("Semua entri glosarium telah dihapus!");
      renderGlossaryList();
    } catch (err) {
      console.error(err);
      showToast("Gagal mereset glosarium!", true);
    }
  }
}


function renderGlossaryList() {
  const preview = document.getElementById('glossaryPreview');
  const glossaryText = document.getElementById('glossaryText');
  
  // Perbarui teks di editor
  glossaryText.value = Object.entries(glossary)
    .map(([key, value]) => `${key} = ${value}`)
    .join('\n');

  // Tampilkan preview entri glosarium
  if (Object.keys(glossary).length === 0) {
    preview.innerHTML = '<p>Belum ada entri glosarium.</p>';
  } else {
    preview.innerHTML = `
      <div class="glossary-header">
        <h4>Daftar Glosarium (${Object.keys(glossary).length} entri):</h4>
        <button class="glossary-reset" title="Reset Glosarium" onclick="resetGlossary()">🔄</button>
      </div>
      <ul class="glossary-list">
        ${Object.entries(glossary).map(([key, val]) => `
          <li class="history-item">
            <span class="truncate">${key} ⮕ ${val}</span>
            <span>
              <button class="glossary-action" onclick="editGlossaryEntry('${key.replace(/'/g, "\\'")}')">✎</button>
              <button class="glossary-action" onclick="deleteGlossaryEntry('${key.replace(/'/g, "\\'")}')">🗑</button>
            </span>
          </li>
        `).join('')}
      </ul>
    `;
  }
}

async function editGlossaryEntry(key) {
  // Ambil nilai glosarium saat ini untuk key yang diberikan
  const currentVal = glossary[key];
  // Gunakan custom modal untuk mendapatkan nilai baru
  const newVal = await customEditGlossary(key, currentVal);
  
  if (newVal === null) return; // Jika pengguna menekan "Batal", jangan lakukan apa-apa
  if (newVal.trim() === "") {
    showToast('Nilai terjemahan tidak boleh kosong!', true);
    return;
  }
  
  // Perbarui entri glosarium dan simpan ke IndexedDB
  glossary[key] = newVal.trim();
  try {
    await idbSet("glossary", glossary);
    showToast(`Entri "${key}" telah diperbarui!`);
    renderGlossaryList();
  } catch (err) {
    console.error(err);
    showToast('Gagal memperbarui entri glosarium!', true);
  }
}


async function deleteGlossaryEntry(key) {
  if (await customConfirm(`Hapus entri glosarium untuk "${key}"?`)) {
    delete glossary[key];
    try {
      await idbSet("glossary", glossary);
      showToast(`Entri "${key}" telah dihapus!`);
      renderGlossaryList();
    } catch (err) {
      console.error(err);
    }
  }
}


// Parsing teks glosarium dari editor atau file
function parseGlossary(text) {
  const glossaryObj = {};
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.includes("="));
  lines.forEach(line => {
    const [key, value] = line.split("=").map(s => s.trim());
    if (key && value) glossaryObj[key] = value;
  });
  return glossaryObj;
}

async function saveGlossary() {
  const newGlossary = parseGlossary(document.getElementById('glossaryText').value);
  glossary = { ...newGlossary };
  try {
    await idbSet("glossary", glossary);
    showToast('Glosarium berhasil disimpan!');
    renderGlossaryList();
  } catch (err) {
    console.error(err);
  }
}

/* ============================
   Fungsi Terjemahan
============================ */
async function translateText() {
  const startTime = performance.now();
  showProgress(true);

  try {
    const text = document.getElementById("inputText").value;
    if (!text.trim()) {
      // Jika tidak ada teks, bersihkan output tanpa memunculkan toast
      document.getElementById("outputText").value = "";
      showProgress(false);
      return;
    }

    const sourceLang = document.getElementById("sourceLang").value;
    const targetLang = document.getElementById("targetLang").value;
    const batches = splitTextIntoBatches(text, MAX_CHARS);
    const totalBatches = batches.length;
    const translatedParts = [];

    // Terjemahkan tiap bagian dengan pembaruan progress
    for (let i = 0; i < batches.length; i++) {
      translatedParts.push(await translatePart(batches[i], sourceLang, targetLang));
      updateProgress(((i + 1) / totalBatches) * 100);
    }

    let translatedText = translatedParts.join("\n\n");
    translatedText = applyReplacements(translatedText);
    translatedText = removeExtraSpacesAroundHyphen(translatedText);

    document.getElementById("outputText").value = translatedText;
    await saveToHistory(text, translatedText);
    showToast(`Terjemahan selesai dalam ${((performance.now() - startTime) / 1000).toFixed(1)} detik`);
  } catch (error) {
    console.error(error);
    showToast('Gagal menerjemahkan!', true);
  } finally {
    showProgress(false);
  }
}

function splitTextIntoBatches(text, maxLen) {
  // Pisahkan teks berdasarkan paragraf (dipisahkan oleh "\n\n")
  const paragraphs = text.split("\n\n").map(p => p.trim()).filter(p => p !== "");
  const batches = [];
  let currentBatch = "";

  for (let p of paragraphs) {
    // Jika penambahan paragraf masih dalam batas
    if ((currentBatch.length + p.length) < maxLen) {
      currentBatch += (currentBatch ? "\n\n" : "") + p;
    } else {
      // Jika currentBatch sudah ada isinya, push dan mulai batch baru
      if (currentBatch) batches.push(currentBatch);
      currentBatch = p;
    }
  }
  if (currentBatch) batches.push(currentBatch);
  return batches;
}

async function translatePart(text, sl, tl) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const response = await fetch(url);
    const result = await response.json();
    return result[0].map(item => item[0]).join("");
  } catch (error) {
    console.error("Terjadi kesalahan:", error);
    return text;
  }
}

// Hapus spasi ekstra di sekitar tanda hubung (jika diperlukan)
function removeExtraSpacesAroundHyphen(text) {
  return text.replace(/\s*-\s*/g, '-');
}

// Fungsi penggantian tambahan setelah terjemahan
function applyReplacements(text) {
  // Gabungkan entri glosarium dengan smart & case sensitive replacements
  const replacements = {
    ...glossary,
    ...getSmartReplacements(),
    ...getCaseSensitiveReplacements()
  };

  Object.entries(replacements).forEach(([key, value]) => {
    // Jika key hanya terdiri dari huruf dan angka, gunakan boundary regex
    const pattern = /^[A-Za-z0-9]+$/.test(key)
      ? `\\b${escapeRegExp(key)}\\b`
      : escapeRegExp(key);
    const regex = new RegExp(pattern, 'gi');
    text = text.replace(regex, match =>
      /[A-Z]/.test(match[0]) ? capitalize(value) : value.toLowerCase()
    );
  });
  return text;
}

function getSmartReplacements() {
  return {
    'Gggdhhh': 'bzshdbd'
  };
}

function getCaseSensitiveReplacements() {
  return {
    'Iahshs': 'hahsha'
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================
// Fungsi Tampilan & Utilitas
// ============================
function clearInput() {
  document.getElementById("inputText").value = "";
  updateCounter();
}

function clearOutput() {
  document.getElementById("outputText").value = "";
}

async function copyText() {
  const outputText = document.getElementById("outputText");
  try {
    await navigator.clipboard.writeText(outputText.value);
    showToast('Teks berhasil disalin!');
  } catch (error) {
    console.error("Gagal menyalin teks:", error);
    showToast('Gagal menyalin teks!', true);
  }
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.backgroundColor = isError ? '#e74c3c' : '#3498db';
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 3000);
}

function showProgress(show) {
  const progressBar = document.querySelector('.progress-bar');
  progressBar.style.display = show ? 'block' : 'none';
  if (!show) document.getElementById('progress').style.width = '0%';
}

function updateProgress(percentage) {
  document.getElementById('progress').style.width = `${percentage}%`;
}

async function saveToHistory(original, translated) {
  const entry = {
    original,
    translated,
    timestamp: new Date().toISOString()
  };

  // Tambahkan history terbaru di awal
  translationHistory.unshift(entry);
  if (translationHistory.length > 50) translationHistory.pop();

  try {
    await idbSet("translationHistory", translationHistory);
    displayHistory();
  } catch (err) {
    console.error(err);
  }
}

function displayHistory() {
  const historyList = document.getElementById('historyList');
  // Gunakan indeks asli untuk memastikan pemuatan history yang tepat
  historyList.innerHTML = translationHistory
    .slice(0, 10)
    .map((entry, idx) => `
      <div class="history-item" data-index="${idx}" onclick="loadHistory(${idx})">
        <small>${new Date(entry.timestamp).toLocaleString()}</small>
        <div class="truncate">${entry.original.substring(0, 50)}...</div>
      </div>
    `).join('');
}

function loadHistory(displayIndex) {
  // Pastikan indeks yang diambil sesuai dengan tampilan history
  const entry = translationHistory[displayIndex];
  if (!entry) return;
  document.getElementById('inputText').value = entry.original;
  document.getElementById('outputText').value = entry.translated;
  updateCounter();
}

async function clearHistory() {
  if (await customConfirm('Hapus semua riwayat?')) {
    translationHistory = [];
    try {
      await idbRemove("translationHistory");
      displayHistory();
    } catch (err) {
      console.error(err);
    }
  }
}


function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function updateCounter() {
  const text = document.getElementById('inputText').value;
  document.getElementById('charCounter').textContent = `${text.length} karakter`;
}

// ============================
// Setup Event & Inisialisasi
// ============================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Buka IndexedDB dan ambil data glosarium serta history
    db = await openDatabase();
    glossary = (await idbGet("glossary")) || {};
    translationHistory = (await idbGet("translationHistory")) || [];
    displayHistory();

    // Set nilai default bahasa
    document.getElementById('sourceLang').value = 'auto';
    document.getElementById('targetLang').value = 'id';

    // Event untuk memuat file glosarium
    document.getElementById('glossaryFile').addEventListener('change', loadGlossary);

    // Jika elemen preview glosarium diklik (di luar tombol), toggle editor glosarium
    const glossaryPreview = document.getElementById('glossaryPreview');
    if (glossaryPreview) {
      glossaryPreview.addEventListener('click', function(e) {
        if (e.target === this) {
          toggleGlossaryEditor();
        }
      });
    }

    // Event input dengan debounce untuk terjemahan otomatis
    const inputText = document.getElementById("inputText");
    inputText.addEventListener("input", function() {
      updateCounter();
      autoResize(this);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(translateText, 500);
    });

    // **Inisialisasi tema berdasarkan preferensi pengguna dari localStorage**
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
      themeToggle.textContent = '🌞'; 
    } else {
      document.body.classList.remove('dark-theme');
      themeToggle.textContent = '🌓';
    }

    // Event untuk mengubah tema dan menyimpannya di localStorage
    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      themeToggle.textContent = isDark ? '🌞' : '🌓';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });

  } catch (err) {
    console.error("Error in initialization:", err);
  }
});

// ============================
// Fungsi untuk memuat glosarium dari file
// ============================
function loadGlossary() {
  const fileInput = document.getElementById("glossaryFile");
  if (fileInput.files.length === 0) return;

  const reader = new FileReader();
  reader.onload = async function(event) {
    const newGlossary = parseGlossary(event.target.result);
    // Gabungkan entri baru dengan yang sudah ada
    glossary = { ...glossary, ...newGlossary };
    try {
      await idbSet("glossary", glossary);
      showToast('Glosarium berhasil diperbarui!');
      renderGlossaryList();
    } catch (err) {
      console.error(err);
    }
    
    fileInput.value = "";
  };
  reader.readAsText(fileInput.files[0]);
}

function customConfirm(message) {
  return new Promise((resolve) => {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');

    confirmMessage.textContent = message;
    confirmModal.style.display = 'flex'; 

    // Bersihkan event handler sebelumnya
    confirmYes.onclick = () => {
      confirmModal.style.display = 'none';
      resolve(true);
    };
    confirmNo.onclick = () => {
      confirmModal.style.display = 'none';
      resolve(false);
    };
  });
}

function customEditGlossary(key, currentVal) {
  return new Promise((resolve) => {
    const editModal = document.getElementById("editGlossaryModal");
    const messageEl = document.getElementById("editGlossaryMessage");
    const inputEl = document.getElementById("editGlossaryInput");
    const saveBtn = document.getElementById("editGlossarySave");
    const cancelBtn = document.getElementById("editGlossaryCancel");

    messageEl.textContent = `Edit terjemahan untuk "${key}":`;
    inputEl.value = currentVal;
    editModal.style.display = "flex"; 

    saveBtn.onclick = () => {
      editModal.style.display = "none";
      resolve(inputEl.value);
    };
    cancelBtn.onclick = () => {
      editModal.style.display = "none";
      resolve(null);
    };
  });
}

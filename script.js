import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteField,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// --- FIREBASE ---
const app = initializeApp(firebaseConfig);
// Local cache keeps the app usable offline and syncs when back online
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// --- STATE MANAGEMENT ---
// Data lives in one doc per month: months/{YYYY-MM},
// holding an `entries` map of { [timestamp]: { type } }.
// Few docs = few reads, which keeps the app well inside the free tier.
let exercises = [];
let deleteTargetId = null;

// --- CORE LOGIC ---
function getFormattedDate(time = Date.now()) {
  // Returns format: "Sun, May 10"
  return new Date(time).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
document.getElementById("currentDate").textContent = getFormattedDate();

function monthRef(id) {
  // UTC month, so an entry maps to the same doc in any timezone
  const month = new Date(id).toISOString().slice(0, 7);
  return doc(db, "months", month);
}

function logExercise(type) {
  const id = Date.now();
  setDoc(monthRef(id), { entries: { [id]: { type } } }, { merge: true }).catch(
    showError,
  );
}

function deleteExercise(id) {
  deleteTargetId = id;
  document.getElementById("delete-modal").classList.add("show");
}

function confirmDelete() {
  if (deleteTargetId) {
    updateDoc(monthRef(deleteTargetId), {
      [`entries.${deleteTargetId}`]: deleteField(),
    }).catch(showError);
    closeDeleteModal();
  }
}

function closeDeleteModal() {
  document.getElementById("delete-modal").classList.remove("show");
  deleteTargetId = null;
}

// Hide delete buttons when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest(".log-div") && !e.target.closest(".modal")) {
    document.querySelectorAll(".delete-btn.visible").forEach((btn) => {
      btn.classList.remove("visible");
    });
  }
});

function showError(err) {
  alert("Something went wrong: " + err.message);
}

// --- SYNC ---
function listen() {
  onSnapshot(
    collection(db, "months"),
    (snapshot) => {
      exercises = snapshot.docs
        .flatMap((d) => Object.entries(d.data().entries || {}))
        .map(([id, entry]) => ({ id: Number(id), type: entry.type }))
        .sort((a, b) => a.id - b.id);
      renderTimeline();
    },
    showError,
  );
}

// Writes a list of entries (from a backup file or old local data).
// Safe to repeat: entries are keyed by timestamp, so nothing duplicates.
function uploadEntries(list) {
  const batch = writeBatch(db);
  const months = {};
  list
    .filter(
      (e) => Number.isFinite(e.id) && ["pushup", "pullup"].includes(e.type),
    )
    .forEach((e) => {
      const ref = monthRef(e.id);
      months[ref.id] ??= { ref, entries: {} };
      months[ref.id].entries[e.id] = { type: e.type };
    });
  Object.values(months).forEach(({ ref, entries }) =>
    batch.set(ref, { entries }, { merge: true }),
  );
  return batch.commit();
}

// One-time move of data saved in this browser before the cloud version
async function migrateLocalData() {
  const local = JSON.parse(localStorage.getItem("exercises")) || [];
  if (!local.length) return;
  await uploadEntries(local);
  localStorage.setItem("exercises-backup", JSON.stringify(local));
  localStorage.removeItem("exercises");
  alert(`Moved ${local.length} entries from this browser to the cloud.`);
}

// --- UI & RENDER LOGIC ---
function switchView(viewId, btnElement) {
  // Hide all views
  document
    .querySelectorAll(".view")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(viewId).classList.add("active");

  // Update nav styling
  document
    .querySelectorAll(".nav-btn")
    .forEach((el) => el.classList.remove("active"));
  btnElement.classList.add("active");

  // Render/Scroll logic for Timeline
  if (viewId === "timeline") {
    renderTimeline();
  }
}

function renderTimeline() {
  const container = document.getElementById("timeline");
  container.innerHTML = "";

  exercises.forEach((entry) => {
    // Insert Date
    const dateDiv = document.createElement("div");
    dateDiv.className = "date-divider";
    dateDiv.innerText = getFormattedDate(entry.id);

    // Insert Exercise Bubble
    const logDiv = document.createElement("div");
    logDiv.className = "log-div";
    const bubble = document.createElement("div");
    bubble.className = "exercise-bubble";
    bubble.textContent = entry.type;
    logDiv.classList.add(entry.type === "pushup" ? "pushup" : "pullup");

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "DELETE";
    deleteBtn.dataset.id = entry.id;

    // Long-press shows the delete button
    let pressTimer;

    logDiv.addEventListener("mousedown", () => {
      pressTimer = setTimeout(() => {
        deleteBtn.classList.add("visible");
      }, 500);
    });
    logDiv.addEventListener("mouseup", () => clearTimeout(pressTimer));
    logDiv.addEventListener("mouseleave", () => clearTimeout(pressTimer));

    logDiv.addEventListener("touchstart", () => {
      pressTimer = setTimeout(() => {
        deleteBtn.classList.add("visible");
      }, 500);
    });

    logDiv.addEventListener("touchend", () => {
      clearTimeout(pressTimer);
    });

    // Direct click handler for delete button
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteExercise(entry.id);
    });

    logDiv.appendChild(bubble);
    logDiv.appendChild(dateDiv);
    logDiv.appendChild(deleteBtn);
    container.appendChild(logDiv);
  });

  // Scroll to extreme bottom (like opening a WhatsApp chat)
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 10);
}

// --- SETTINGS (THEME, EXPORT, IMPORT) ---
function initTheme() {
  const toggle = document.getElementById("theme-toggle");
  const savedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
    document.documentElement.setAttribute("data-theme", "dark");
    toggle.checked = true;
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    toggle.checked = false;
  }
}

function toggleTheme() {
  const isDark = document.getElementById("theme-toggle").checked;
  const theme = isDark ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

function exportData() {
  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(exercises));
  const anchor = document.createElement("a");
  anchor.setAttribute("href", dataStr);
  anchor.setAttribute("download", "workout_backup.json");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

// Merges a backup file into the cloud data (existing entries are kept)
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        await uploadEntries(imported);
        alert("Data successfully imported!");
      } else {
        alert("Invalid file format.");
      }
    } catch (err) {
      alert("Import failed: " + err.message);
    }
    event.target.value = ""; // Reset input
  };
  reader.readAsText(file);
}

// --- EVENTS ---
document
  .querySelectorAll(".log-btn")
  .forEach((btn) =>
    btn.addEventListener("click", () => logExercise(btn.dataset.type)),
  );
document
  .querySelectorAll(".nav-btn")
  .forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.view, btn)),
  );
document.getElementById("theme-toggle").addEventListener("change", toggleTheme);
document.getElementById("export-btn").addEventListener("click", exportData);
document
  .getElementById("import-btn")
  .addEventListener("click", () =>
    document.getElementById("import-file").click(),
  );
document.getElementById("import-file").addEventListener("change", importData);
document
  .querySelector(".modal-btn.cancel")
  .addEventListener("click", closeDeleteModal);
document
  .querySelector(".modal-btn.delete")
  .addEventListener("click", confirmDelete);

// --- INIT APP ON LOAD ---
initTheme();
listen();
migrateLocalData().catch(showError);

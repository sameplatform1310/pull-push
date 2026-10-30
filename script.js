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

// --- STATE ---
// Data lives in one doc per month: months/{YYYY-MM},
// holding an `entries` map of { [timestamp]: { type } }.
// Few docs = few reads, which keeps the app well inside the free tier.
const NAMES = { pushup: "Pushup", pullup: "Pullup" };
let exercises = [];
let syncMeta = { fromCache: true, hasPendingWrites: false };
let editTarget = null;
let scrollToEnd = true;

const $ = (selector) => document.querySelector(selector);
const timeline = $("#timeline");
const editDialog = $("#edit-dialog");
const editForm = $("#edit-form");
const deleteBtn = $("#delete-entry");

// --- DATES ---
const pad = (n) => String(n).padStart(2, "0");

// Calendar days between a timestamp and today (0 = today)
function daysAgo(time) {
  const midnight = (t) => new Date(t).setHours(0, 0, 0, 0);
  return Math.round((midnight(Date.now()) - midnight(time)) / 864e5);
}

function dayLabel(time) {
  const days = daysAgo(time);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(time);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: thisYear ? undefined : "numeric",
  });
}

function lastLabel(time) {
  const days = daysAgo(time);
  if (days <= 0) return "Today";
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function timeLabel(time) {
  return new Date(time).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- DATA ---
function monthRef(id) {
  // UTC month, so an entry maps to the same doc in any timezone
  return doc(db, "months", new Date(id).toISOString().slice(0, 7));
}

function logExercise(type) {
  const id = Date.now();
  scrollToEnd = true;
  setDoc(monthRef(id), { entries: { [id]: { type } } }, { merge: true }).catch(
    showError,
  );
}

// A new date/time changes the entry's key (and maybe its month doc),
// so the old key is removed and the new one written in one batch
function saveEntry(oldId, id, type) {
  const batch = writeBatch(db);
  if (id !== oldId) {
    batch.update(monthRef(oldId), { [`entries.${oldId}`]: deleteField() });
  }
  batch.set(monthRef(id), { entries: { [id]: { type } } }, { merge: true });
  batch.commit().catch(showError);
}

function deleteEntry(id) {
  updateDoc(monthRef(id), { [`entries.${id}`]: deleteField() }).catch(
    showError,
  );
}

// Writes a list of entries (from a backup file or old local data).
// Safe to repeat: entries are keyed by timestamp, so nothing duplicates.
async function uploadEntries(list) {
  const valid = list.filter((e) => Number.isFinite(e.id) && NAMES[e.type]);
  const batch = writeBatch(db);
  const months = {};
  valid.forEach((e) => {
    const ref = monthRef(e.id);
    months[ref.id] ??= { ref, entries: {} };
    months[ref.id].entries[e.id] = { type: e.type };
  });
  Object.values(months).forEach(({ ref, entries }) =>
    batch.set(ref, { entries }, { merge: true }),
  );
  await batch.commit();
  return valid.length;
}

// One-time move of data saved in this browser before the cloud version
async function migrateLocalData() {
  const local = JSON.parse(localStorage.getItem("exercises")) || [];
  if (!local.length) return;
  const count = await uploadEntries(local);
  localStorage.setItem("exercises-backup", JSON.stringify(local));
  localStorage.removeItem("exercises");
  toast(`Moved ${count} entries from this browser to the cloud`);
}

function listen() {
  onSnapshot(
    collection(db, "months"),
    { includeMetadataChanges: true },
    (snapshot) => {
      syncMeta = snapshot.metadata;
      // The database is open, so skip anything that isn't a real entry
      exercises = snapshot.docs
        .flatMap((d) => Object.entries(d.data().entries || {}))
        .map(([id, entry]) => ({ id: Number(id), type: entry?.type }))
        .filter((e) => Number.isFinite(e.id) && NAMES[e.type])
        .sort((a, b) => a.id - b.id);
      render();
    },
    showError,
  );
}

// --- RENDER ---
function render() {
  renderToday();
  renderTimeline();
  renderButtons();
  renderStats();
  renderSync();
}

function renderTimeline() {
  const nearEnd =
    timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 80;
  timeline.replaceChildren();

  if (!exercises.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = syncMeta.fromCache
      ? "Loading…"
      : "Nothing logged yet. Tap a button below to start.";
    timeline.append(empty);
    return;
  }

  let day = null;
  let list;
  exercises.forEach((entry) => {
    // Start a new group whenever the day changes
    const label = dayLabel(entry.id);
    if (label !== day) {
      day = label;
      const heading = document.createElement("h2");
      heading.className = "day";
      heading.textContent = label;
      list = document.createElement("div");
      list.className = "day-list";
      timeline.append(heading, list);
    }

    const row = document.createElement("button");
    row.className = `entry ${entry.type}`;
    const name = document.createElement("span");
    name.textContent = NAMES[entry.type];
    const time = document.createElement("time");
    time.textContent = timeLabel(entry.id);
    row.append(name, time);
    row.addEventListener("click", () => openEditor(entry));
    list.append(row);
  });

  // Stay pinned to the newest entry (like a chat), unless scrolled up
  if (nearEnd || scrollToEnd) timeline.scrollTop = timeline.scrollHeight;
  scrollToEnd = false;
}

function renderToday() {
  // Returns format: "Sun, May 10"
  $("#today").textContent = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function renderButtons() {
  document.querySelectorAll(".log-btn").forEach((btn) => {
    const last = exercises.findLast((e) => e.type === btn.dataset.type);
    btn.querySelector(".log-btn-last").textContent = last
      ? lastLabel(last.id)
      : "Not logged yet";
  });
}

function renderStats() {
  const count = (type) => exercises.filter((e) => e.type === type).length;
  $("#stat-pushup").textContent = count("pushup");
  $("#stat-pullup").textContent = count("pullup");
  $("#stat-since").textContent = exercises.length
    ? new Date(exercises[0].id).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "–";
}

function renderSync() {
  const pending = syncMeta.hasPendingWrites || syncMeta.fromCache;
  $("#sync-status").textContent = !navigator.onLine
    ? "Offline"
    : pending
      ? "Syncing…"
      : "";
}

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function showError(err) {
  toast("Something went wrong: " + err.message);
}

// --- EDIT DIALOG ---
function openEditor(entry) {
  editTarget = entry;
  const date = new Date(entry.id);
  editForm.elements.type.value = entry.type;
  editForm.elements.date.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  editForm.elements.time.value = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  delete deleteBtn.dataset.armed;
  deleteBtn.textContent = "Delete";
  editDialog.showModal();
}

function submitEditor() {
  const { type, date, time } = Object.fromEntries(new FormData(editForm));
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  // Keep the original seconds/ms so the new key won't clash with another entry
  const old = new Date(editTarget.id);
  const id = new Date(
    year,
    month - 1,
    day,
    hours,
    minutes,
    old.getSeconds(),
    old.getMilliseconds(),
  ).getTime();
  saveEntry(editTarget.id, id, type);
}

// First tap arms the button, second tap deletes
function deleteFromEditor() {
  if (!deleteBtn.dataset.armed) {
    deleteBtn.dataset.armed = "true";
    deleteBtn.textContent = "Confirm delete";
    return;
  }
  deleteEntry(editTarget.id);
  editDialog.close();
}

// --- VIEWS ---
function showView() {
  const view = location.hash === "#settings" ? "settings" : "log";
  document.body.dataset.view = view;
  if (view === "log") timeline.scrollTop = timeline.scrollHeight;
}

function openSettings() {
  // A history entry lets the phone's back button return to the log
  history.pushState({ view: "settings" }, "", "#settings");
  showView();
}

function closeSettings() {
  if (history.state?.view === "settings") return history.back();
  history.replaceState(null, "", location.pathname);
  showView();
}

// --- SETTINGS (THEME, EXPORT, IMPORT) ---
function applyTheme(choice) {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.themeChoice === choice);
  });
}

function setTheme(choice) {
  localStorage.setItem("theme", choice);
  applyTheme(choice);
}

function exportData() {
  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(exercises));
  const anchor = document.createElement("a");
  anchor.setAttribute("href", dataStr);
  anchor.setAttribute(
    "download",
    `pushpull-${new Date().toISOString().slice(0, 10)}.json`,
  );
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
        const count = await uploadEntries(imported);
        toast(`Imported ${count} entries`);
      } else {
        toast("That file isn't a PushPull backup");
      }
    } catch (err) {
      toast("Import failed: " + err.message);
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
  .querySelectorAll("[data-theme-choice]")
  .forEach((btn) =>
    btn.addEventListener("click", () => setTheme(btn.dataset.themeChoice)),
  );
$("#settings-btn").addEventListener("click", openSettings);
$("#back-btn").addEventListener("click", closeSettings);
window.addEventListener("popstate", showView);
$("#export-btn").addEventListener("click", exportData);
$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", importData);
editForm.addEventListener("submit", submitEditor);
deleteBtn.addEventListener("click", deleteFromEditor);
$("#cancel-edit").addEventListener("click", () => editDialog.close());
// Tapping the dim backdrop closes the dialog
editDialog.addEventListener("click", (e) => {
  if (e.target === editDialog) editDialog.close();
});
window.addEventListener("online", renderSync);
window.addEventListener("offline", renderSync);
// Phones keep tabs open for days, so refresh "Today"/"2 days ago" on return
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});

// --- INIT APP ON LOAD ---
applyTheme(localStorage.getItem("theme") || "system");
renderToday();
showView();
listen();
migrateLocalData().catch(showError);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

// --- STATE MANAGEMENT ---
let exercises = JSON.parse(localStorage.getItem("exercises")) || [];
let lastLoggedId = null;
let toastTimeout;
let deleteTargetId = null;

// --- CORE LOGIC ---
function getFormattedDate() {
  // Returns format: "Sun, May 10"
  const date = new Date();
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function logExercise(type) {
  const entry = {
    id: Date.now(),
    type: type,
    dateStr: getFormattedDate(),
  };
  exercises.push(entry);
  lastLoggedId = entry.id;
  saveData();

  // Show Undo Toast
  const toast = document.getElementById("undo-toast");
  document.getElementById("toast-msg").innerText = `Added ${type}`;
  toast.classList.add("show");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
    lastLoggedId = null; // Clear undo window
  }, 4000);
}

function deleteExercise(id) {
  deleteTargetId = id;
  document.getElementById("delete-modal").classList.add("show");
}

function confirmDelete() {
  if (deleteTargetId) {
    exercises = exercises.filter((e) => e.id !== deleteTargetId);
    saveData();
    renderTimeline();
    closeDeleteModal();
  }
}

function closeDeleteModal() {
  document.getElementById("delete-modal").classList.remove("show");
  deleteTargetId = null;
}

// Hide delete buttons when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest(".exercise-bubble") && !e.target.closest(".modal")) {
    document.querySelectorAll(".delete-btn.visible").forEach(btn => {
      btn.classList.remove("visible");
    });
  }
});

function undoLastLog() {
  if (lastLoggedId) {
    exercises = exercises.filter((e) => e.id !== lastLoggedId);
    saveData();
    lastLoggedId = null;
    document.getElementById("undo-toast").classList.remove("show");
  }
}

function saveData() {
  localStorage.setItem("exercises", JSON.stringify(exercises));
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

  if (exercises.length === 0) {
    container.innerHTML = `<div class="empty-state">No exercises logged yet.<br>Go to Home and push a button!</div>`;
    return;
  }

  let currentDate = null;

  exercises.forEach((entry) => {
    // Insert Date Divider if day changed
    if (entry.dateStr !== currentDate) {
      const dateDiv = document.createElement("div");
      dateDiv.className = "date-divider";
      dateDiv.innerText = entry.dateStr;
      container.appendChild(dateDiv);
      currentDate = entry.dateStr;
    }

    // Insert Exercise Bubble
    const bubble = document.createElement("div");
    bubble.className = "exercise-bubble";
    
    const typeSpan = document.createElement("span");
    typeSpan.className = "type";
    typeSpan.textContent = entry.type;
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✖";
    deleteBtn.dataset.id = entry.id;
    
    bubble.appendChild(typeSpan);
    bubble.appendChild(deleteBtn);

    // Add click/long-press handler
    let pressTimer;
    let isLongPress = false;
    
    bubble.addEventListener("mousedown", () => {
      pressTimer = setTimeout(() => {
        deleteBtn.classList.add("visible");
      }, 500);
    });
    bubble.addEventListener("mouseup", () => clearTimeout(pressTimer));
    bubble.addEventListener("mouseleave", () => clearTimeout(pressTimer));

    bubble.addEventListener("click", (e) => {
      if (e.target === typeSpan) {
        deleteBtn.classList.add("visible");
      }
    });

    bubble.addEventListener("touchstart", () => {
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        deleteBtn.classList.add("visible");
      }, 500);
    });
    
    bubble.addEventListener("touchend", () => {
      clearTimeout(pressTimer);
    });
    
    // Direct click handler for delete button
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteExercise(entry.id);
    });

    container.appendChild(bubble);
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

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        exercises = imported;
        saveData();
        alert("Data successfully imported!");
        event.target.value = ""; // Reset input
      } else {
        alert("Invalid file format.");
      }
    } catch (err) {
      alert("Error parsing JSON file.");
    }
  };
  reader.readAsText(file);
}

// --- INIT APP ON LOAD ---
initTheme();

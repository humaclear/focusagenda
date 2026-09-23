(() => {
  "use strict";

  const config = window.FOCUS_CONFIG || {};
  const statuses = ["Pendiente", "Confirmada", "Reprogramada", "Rechazada", "Completada", "Cancelada"];
  const slots = Array.isArray(config.slots) && config.slots.length ? config.slots : ["09:00", "12:00", "15:00", "17:00"];
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get("demo") === "1" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const loginOverlay = document.querySelector("#loginOverlay");
  const loginForm = document.querySelector("#loginForm");
  const tokenInput = document.querySelector("#adminToken");
  const tableContainer = document.querySelector("#tableContainer");
  const statusFilter = document.querySelector("#statusFilter");
  const searchFilter = document.querySelector("#searchFilter");
  const toast = document.querySelector("#toast");
  const editModal = document.querySelector("#editBookingModal");
  const editForm = document.querySelector("#editBookingForm");
  const editTime = document.querySelector("#editTime");
  let token = sessionStorage.getItem("focusAdminToken") || "";
  let bookings = [];

  populateEditSlots();
  bindEvents();
  if (token) authenticate();

  function populateEditSlots() {
    editTime.replaceChildren(...slots.map((time) => {
      const option = document.createElement("option");
      option.value = time;
      option.textContent = formatTime(time);
      return option;
    }));
  }

  function bindEvents() {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      token = tokenInput.value.trim();
      authenticate();
    });
    document.querySelector("#refreshButton").addEventListener("click", loadBookings);
    document.querySelector("#logoutButton").addEventListener("click", logout);
    statusFilter.addEventListener("change", render);
    searchFilter.addEventListener("input", render);
    editForm.addEventListener("submit", saveBooking);
    document.querySelector("#closeEditBooking").addEventListener("click", closeEditModal);
    document.querySelector("#cancelEditBooking").addEventListener("click", closeEditModal);
    editModal.addEventListener("click", (event) => {
      if (event.target === editModal) closeEditModal();
    });
  }

  async function authenticate() {
    document.querySelector("#loginError").textContent = "";
    try {
      if (isDemo && token === "") token = "demo";
      await loadBookings(true);
      sessionStorage.setItem("focusAdminToken", token);
      loginOverlay.classList.add("hidden");
    } catch (error) {
      document.querySelector("#loginError").textContent = error.message || "No fue posible iniciar sesión.";
      loginOverlay.classList.remove("hidden");
    }
  }

  async function loadBookings(isLogin = false) {
    document.querySelector("#refreshButton").disabled = true;
    try {
      if (isDemo) {
        await wait(300);
        bookings = demoBookings();
      } else {
        const response = await fetch("/api/admin", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Acceso no autorizado.");
        bookings = result.bookings || [];
      }
      document.querySelector("#lastUpdated").textContent = `Actualizado ${new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
      render();
      if (!isLogin) showToast("Agenda actualizada.");
    } finally {
      document.querySelector("#refreshButton").disabled = false;
    }
  }

  function render() {
    const query = searchFilter.value.trim().toLowerCase();
    const status = statusFilter.value;
    const filtered = bookings.filter((booking) => {
      const searchable = `${booking.id} ${booking.client} ${booking.contactName} ${booking.recordingType}`.toLowerCase();
      return (!query || searchable.includes(query)) && (!status || booking.status === status);
    });
    updateMetrics(filtered);
    if (!filtered.length) {
      tableContainer.innerHTML = '<div class="empty-state">No hay solicitudes que coincidan con los filtros.</div>';
      return;
    }

    tableContainer.innerHTML = `
      <table class="booking-table">
        <thead><tr><th>Folio / cliente</th><th>Fecha</th><th>Producción</th><th>Contacto</th><th>Estatus</th><th>Acciones</th></tr></thead>
        <tbody>${filtered.map(rowTemplate).join("")}</tbody>
      </table>
    `;
    tableContainer.querySelectorAll("[data-status]").forEach((select) => select.addEventListener("change", () => updateStatus(select.dataset.status, select.value, select)));
    tableContainer.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEditModal(button.dataset.edit)));
    tableContainer.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => copySummary(button.dataset.copy)));
  }

  function rowTemplate(booking) {
    const statusClass = `status-${normalize(booking.status)}`;
    return `
      <tr>
        <td><strong>${escapeHtml(booking.client)}</strong><small>${escapeHtml(booking.id)}</small></td>
        <td><strong>${escapeHtml(formatDate(booking.date))}</strong><small>${escapeHtml(formatTime(booking.time))} · ${escapeHtml(booking.duration)}</small></td>
        <td><strong>${escapeHtml(booking.recordingType)}</strong><small>${escapeHtml(booking.modality)}</small></td>
        <td><strong>${escapeHtml(booking.contactName)}</strong><small>${escapeHtml(booking.phone)} · ${escapeHtml(booking.email)}</small></td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(booking.status)}</span></td>
        <td>
          <select class="table-action" data-status="${escapeHtml(booking.id)}" aria-label="Cambiar estatus de ${escapeHtml(booking.id)}">
            ${statuses.map((status) => `<option ${status === booking.status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
          <button class="table-action" data-edit="${escapeHtml(booking.id)}" type="button">Modificar</button>
          <button class="table-action" data-copy="${escapeHtml(booking.id)}" type="button">Copiar</button>
        </td>
      </tr>`;
  }

  function openEditModal(id) {
    const booking = bookings.find((item) => item.id === id);
    if (!booking) return;
    document.querySelector("#editBookingId").value = booking.id;
    document.querySelector("#editBookingTitle").textContent = `${booking.client} · ${booking.id}`;
    document.querySelector("#editDate").value = booking.date;
    if (!slots.includes(booking.time) && booking.time) {
      const option = document.createElement("option");
      option.value = booking.time;
      option.textContent = `${formatTime(booking.time)} (actual)`;
      editTime.append(option);
    }
    editTime.value = booking.time;
    const durationSelect = document.querySelector("#editDuration");
    durationSelect.value = ["2 horas", "3 horas", "Más de 3 horas (requiere autorización)"].includes(booking.duration)
      ? booking.duration
      : "Más de 3 horas (requiere autorización)";
    document.querySelector("#editStatus").value = booking.status;
    document.querySelector("#editAdminNote").value = booking.adminNote || "";
    editModal.showModal();
  }

  function closeEditModal() {
    editModal.close();
    populateEditSlots();
  }

  async function saveBooking(event) {
    event.preventDefault();
    const saveButton = document.querySelector("#saveEditBooking");
    const payload = {
      id: document.querySelector("#editBookingId").value,
      date: document.querySelector("#editDate").value,
      time: editTime.value,
      duration: document.querySelector("#editDuration").value,
      status: document.querySelector("#editStatus").value,
      adminNote: document.querySelector("#editAdminNote").value.trim()
    };
    saveButton.disabled = true;
    saveButton.querySelector("span").textContent = "Guardando…";
    try {
      let updated = payload;
      if (!isDemo) {
        const response = await fetch("/api/admin", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "No fue posible guardar los cambios.");
        updated = result.booking || payload;
      } else {
        await wait(350);
      }
      const booking = bookings.find((item) => item.id === payload.id);
      if (booking) Object.assign(booking, payload, updated);
      closeEditModal();
      render();
      showToast(`${payload.id}: cambios guardados y cliente actualizado.`);
    } catch (error) {
      showToast(error.message || "No fue posible guardar los cambios.", true);
    } finally {
      saveButton.disabled = false;
      saveButton.querySelector("span").textContent = "Guardar cambios";
    }
  }

  async function updateStatus(id, status, select) {
    const booking = bookings.find((item) => item.id === id);
    const original = booking?.status;
    select.disabled = true;
    try {
      let updated = { id, status };
      if (!isDemo) {
        const response = await fetch("/api/admin", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ id, status })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "No fue posible actualizar el estatus.");
        updated = result.booking || updated;
      } else {
        await wait(250);
      }
      if (booking) Object.assign(booking, updated);
      render();
      showToast(`${id}: ${status}`);
    } catch (error) {
      select.value = original;
      showToast(error.message, true);
    } finally {
      select.disabled = false;
    }
  }

  async function copySummary(id) {
    const booking = bookings.find((item) => item.id === id);
    if (!booking) return;
    const text = [
      `Grabación ${booking.id}`,
      `Cliente: ${booking.client}`,
      `Fecha: ${formatDate(booking.date)} a las ${formatTime(booking.time)}`,
      `Tipo: ${booking.recordingType}`,
      `Duración: ${booking.duration}`,
      `Estatus: ${booking.status}`,
      booking.adminNote ? `Mensaje: ${booking.adminNote}` : "",
      `Contacto: ${booking.contactName} · ${booking.phone}`
    ].filter(Boolean).join("\n");
    await navigator.clipboard.writeText(text);
    showToast("Resumen copiado.");
  }

  function updateMetrics(filtered) {
    document.querySelector("#metricPending").textContent = String(bookings.filter((item) => item.status === "Pendiente").length);
    document.querySelector("#metricConfirmed").textContent = String(bookings.filter((item) => item.status === "Confirmada" && parseDate(item.date) >= startOfToday()).length);
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
    document.querySelector("#metricWeek").textContent = String(bookings.filter((item) => { const date = parseDate(item.date); return date >= startOfToday() && date <= weekEnd; }).length);
    document.querySelector("#metricTotal").textContent = String(filtered.length);
  }

  function logout() {
    sessionStorage.removeItem("focusAdminToken");
    token = "";
    bookings = [];
    tokenInput.value = "";
    loginOverlay.classList.remove("hidden");
  }

  function demoBookings() {
    const clients = ["Marca Demo 1", "Marca Demo 2", "Marca Demo 3", "Marca Demo 4"];
    const demoStatuses = ["Pendiente", "Confirmada", "Confirmada", "Reprogramada"];
    return clients.map((client, index) => {
      const date = new Date(); date.setDate(date.getDate() + 6 + index * 2);
      return {
        id: `FM-DEMO-10${index + 1}`,
        client,
        contactName: `Contacto ${index + 1}`,
        phone: "55 0000 0000",
        email: "cliente@ejemplo.com",
        date: date.toISOString().slice(0, 10),
        time: slots[index % slots.length],
        duration: index === 2 ? "3 horas" : "2 horas",
        recordingType: ["Contenido para Reels / TikTok", "Testimoniales / entrevistas", "Producto o demostración", "Contenido institucional"][index],
        modality: "En instalaciones del cliente",
        status: demoStatuses[index],
        adminNote: index === 1 ? "Horario autorizado por el equipo de Focus Media." : ""
      };
    });
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 3500);
  }

  function parseDate(value) { const [y, m, d] = String(value).split("-").map(Number); return new Date(y, m - 1, d, 12); }
  function startOfToday() { const date = new Date(); date.setHours(0, 0, 0, 0); return date; }
  function formatDate(value) { const date = parseDate(value); return Number.isNaN(date.getTime()) ? "Fecha por definir" : new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(date); }
  function formatTime(value) { const [h, m] = String(value).split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "p. m." : "a. m."}` : "Horario por definir"; }
  function normalize(value) { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
})();

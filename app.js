(() => {
  "use strict";

  const config = window.FOCUS_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get("demo") === "1" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const minLeadDays = Number(config.minLeadDays || 5);
  const maxAdvanceDays = Number(config.maxAdvanceDays || 90);
  const timezone = config.timezone || "America/Mexico_City";
  const baseSlots = config.slots || ["09:00", "12:00", "15:00", "17:00"];
  const availableWeekdays = Array.isArray(config.availableWeekdays) ? config.availableWeekdays : [0, 1, 2, 3, 4, 5, 6];

  const form = document.querySelector("#bookingForm");
  const clientInput = document.querySelector("#client");
  const calendarGrid = document.querySelector("#calendarGrid");
  const calendarMonth = document.querySelector("#calendarMonth");
  const prevMonth = document.querySelector("#prevMonth");
  const nextMonth = document.querySelector("#nextMonth");
  const dateInput = document.querySelector("#date");
  const timeInput = document.querySelector("#time");
  const slotGrid = document.querySelector("#slotGrid");
  const selectedDateLabel = document.querySelector("#selectedDateLabel");
  const submitButton = document.querySelector("#submitButton");
  const modal = document.querySelector("#confirmationModal");
  const toast = document.querySelector("#toast");

  const today = getTodayInZone();
  const minDate = addDays(today, minLeadDays);
  const maxDate = addDays(today, maxAdvanceDays);
  let visibleMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1, 12);
  let selectedDate = null;
  let selectedTime = "";
  let shouldResetAfterModal = false;
  let monthAvailability = new Map();
  let monthRequestId = 0;

  initialize();

  function initialize() {
    setDefaultValues();
    bindEvents();
    renderCalendar();
    updateSummary();
    document.querySelector("#currentYear").textContent = String(today.getFullYear());
    document.querySelector("#heroNextDate").textContent = formatLongDate(nextAvailableDay(minDate), { weekday: "long", day: "numeric", month: "long" });

    if (isDemo) {
      setTimeout(() => showToast("Vista previa activa: las solicitudes se simulan hasta configurar la conexión."), 600);
    }
  }

  function setDefaultValues() {
    document.querySelector("#duration").value = config.defaultDuration || "2 horas";
  }

  function bindEvents() {
    form.addEventListener("input", (event) => {
      if (event.target.matches("input, select, textarea")) clearFieldError(event.target);
      if (event.target.id === "objective") document.querySelector("#objectiveCount").textContent = String(event.target.value.length);
      updateSummary();
    });

    form.addEventListener("change", (event) => {
      updateSummary();
      if (event.target.id === "duration" && selectedDate) {
        selectedTime = "";
        timeInput.value = "";
        loadSlots(dateInput.value);
      }
    });
    form.addEventListener("submit", submitBooking);
    prevMonth.addEventListener("click", () => moveMonth(-1));
    nextMonth.addEventListener("click", () => moveMonth(1));
    document.querySelector("#closeConfirmation").addEventListener("click", () => {
      modal.close();
      if (shouldResetAfterModal) resetForm();
    });
    document.querySelector("#headerContact").addEventListener("click", contactTeam);
    document.querySelector("#rulesContact").addEventListener("click", contactTeam);
  }

  function renderCalendar(refreshAvailability = true) {
    calendarGrid.replaceChildren();
    calendarMonth.textContent = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(visibleMonth);

    const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1, 12);
    const lastDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0, 12);
    const mondayIndex = (firstDay.getDay() + 6) % 7;

    for (let i = 0; i < mondayIndex; i += 1) {
      const spacer = document.createElement("span");
      spacer.className = "calendar-spacer";
      spacer.setAttribute("aria-hidden", "true");
      calendarGrid.append(spacer);
    }

    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day, 12);
      const iso = dateToIso(date);
      const isUnavailableDay = !availableWeekdays.includes(date.getDay());
      const overview = monthAvailability.get(iso);
      const isInRange = date >= minDate && date <= maxDate;
      const showOverview = overview && isInRange && !isUnavailableDay;
      const isFull = Boolean(showOverview && overview.available === 0);
      const disabled = !isInRange || isUnavailableDay || isFull;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";
      button.textContent = String(day);
      button.dataset.date = iso;
      button.disabled = disabled;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", formatLongDate(date));
      if (isUnavailableDay) button.classList.add("is-weekend");
      if (showOverview && overview.available > 0 && overview.available < overview.total) button.classList.add("is-partial");
      if (showOverview && overview.available === overview.total) button.classList.add("is-open");
      if (isFull) {
        button.classList.add("is-full");
        button.setAttribute("aria-label", `${formatLongDate(date)}. Sin horarios disponibles.`);
      } else if (showOverview) {
        button.setAttribute("aria-label", `${formatLongDate(date)}. ${overview.available} de ${overview.total} horarios disponibles.`);
      }
      if (sameDate(date, today)) button.classList.add("is-today");
      if (selectedDate && sameDate(date, selectedDate)) button.classList.add("is-selected");
      if (!disabled) button.addEventListener("click", () => chooseDate(date));
      calendarGrid.append(button);
    }

    const minMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1, 12);
    const maxMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1, 12);
    prevMonth.disabled = visibleMonth <= minMonth;
    nextMonth.disabled = visibleMonth >= maxMonth;
    if (refreshAvailability) loadMonthOverview();
  }

  async function loadMonthOverview() {
    const requestId = ++monthRequestId;
    const month = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`;
    try {
      let days;
      if (isDemo) {
        await wait(220);
        const lastDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0, 12).getDate();
        days = {};
        for (let day = 1; day <= lastDay; day += 1) {
          const iso = `${month}-${String(day).padStart(2, "0")}`;
          const available = day % 9 === 0 ? 0 : day % 4 === 0 ? 2 : baseSlots.length;
          days[iso] = { available, total: baseSlots.length };
        }
      } else {
        const response = await fetch(`/api/availability?month=${encodeURIComponent(month)}`, { headers: { Accept: "application/json" } });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "No pudimos consultar el mes.");
        days = result.days || {};
      }
      if (requestId !== monthRequestId) return;
      for (const [date, overview] of Object.entries(days)) monthAvailability.set(date, overview);
      renderCalendar(false);
    } catch (error) {
      if (requestId === monthRequestId) console.warn("No se pudo cargar la disponibilidad mensual:", error.message);
    }
  }

  function moveMonth(offset) {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1, 12);
    renderCalendar(true);
  }

  async function chooseDate(date) {
    selectedDate = new Date(date);
    selectedTime = "";
    dateInput.value = dateToIso(selectedDate);
    timeInput.value = "";
    selectedDateLabel.textContent = formatLongDate(selectedDate);
    clearFieldError(dateInput);
    renderCalendar(false);
    updateSummary();
    await loadSlots(dateInput.value);
  }

  async function loadSlots(date) {
    slotGrid.innerHTML = '<p class="slot-loader">Consultando disponibilidad…</p>';
    let slots;
    try {
      if (isDemo) {
        await wait(350);
        const day = new Date(`${date}T12:00:00`).getDate();
        const duration = document.querySelector("#duration").value;
        slots = baseSlots.map((time, index) => ({ time, available: day % 9 !== 0 && (day + index) % 5 !== 0 && !(duration.includes("Más de 3") && time === "17:00") }));
      } else {
        const duration = document.querySelector("#duration").value || "2 horas";
        const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}&duration=${encodeURIComponent(duration)}`, { headers: { Accept: "application/json" } });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "No pudimos consultar los horarios.");
        slots = result.slots;
      }
      renderSlots(slots);
    } catch (error) {
      slotGrid.innerHTML = '<p class="slot-placeholder">No fue posible consultar horarios. Intenta de nuevo o contacta al equipo.</p>';
      showToast(error.message || "Error al consultar disponibilidad.", true);
    }
  }

  function renderSlots(slots) {
    slotGrid.replaceChildren();
    if (!Array.isArray(slots) || !slots.some((slot) => slot.available)) {
      slotGrid.innerHTML = '<p class="slot-placeholder">No hay horarios disponibles para este día. Elige otra fecha.</p>';
      return;
    }

    for (const slot of slots) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot-button";
      button.textContent = formatTime(slot.time);
      button.disabled = !slot.available;
      if (slot.available) {
        button.addEventListener("click", () => {
          selectedTime = slot.time;
          timeInput.value = slot.time;
          slotGrid.querySelectorAll(".slot-button").forEach((item) => item.classList.remove("is-selected"));
          button.classList.add("is-selected");
          clearFieldError(timeInput);
          updateSummary();
        });
      }
      slotGrid.append(button);
    }
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (!validateForm()) {
      const firstInvalid = form.querySelector('[aria-invalid="true"], .calendar-error:not(:empty), #timeError:not(:empty), #rulesError:not(:empty)');
      firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("Revisa los campos marcados antes de enviar.", true);
      return;
    }

    const payload = buildPayload();
    setSubmitting(true);
    try {
      let result;
      if (isDemo) {
        await wait(750);
        result = { ok: true, booking: { id: `FM-${dateInput.value.replaceAll("-", "").slice(2)}-${String(Math.floor(Math.random() * 900) + 100)}`, accessToken: "DEMO-" + Math.random().toString(36).slice(2, 14).toUpperCase() } };
      } else {
        const response = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload)
        });
        result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "No fue posible registrar la solicitud.");
      }
      showConfirmation(result.booking?.id || result.id || "REGISTRADA", result.booking?.accessToken || result.accessToken || "", payload);
      shouldResetAfterModal = true;
    } catch (error) {
      showToast(error.message || "Ocurrió un error. Intenta nuevamente.", true);
    } finally {
      setSubmitting(false);
    }
  }

  function buildPayload() {
    const data = new FormData(form);
    return {
      client: String(data.get("client") || "").trim(),
      contactName: String(data.get("contactName") || "").trim(),
      phone: String(data.get("phone") || "").replace(/\D/g, ""),
      email: String(data.get("email") || "").trim().toLowerCase(),
      date: String(data.get("date") || ""),
      time: String(data.get("time") || ""),
      recordingType: String(data.get("recordingType") || ""),
      duration: String(data.get("duration") || ""),
      modality: String(data.get("modality") || ""),
      participants: String(data.get("participants") || ""),
      location: String(data.get("location") || "").trim(),
      objective: String(data.get("objective") || "").trim(),
      briefLink: String(data.get("briefLink") || "").trim(),
      specialRequirements: String(data.get("specialRequirements") || "").trim(),
      acceptRules: data.get("acceptRules") === "on",
      website: String(data.get("website") || "")
    };
  }

  function validateForm() {
    let valid = true;
    const requiredIds = ["client", "contactName", "phone", "email", "recordingType", "duration", "modality", "participants", "objective"];
    for (const id of requiredIds) {
      const field = document.querySelector(`#${id}`);
      if (!field.value.trim()) valid = setFieldError(field, "Este campo es obligatorio.") && valid;
    }

    if (document.querySelector("#phone").value.replace(/\D/g, "").length !== 10) valid = setFieldError(document.querySelector("#phone"), "Escribe un número de 10 dígitos.") && valid;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.querySelector("#email").value)) valid = setFieldError(document.querySelector("#email"), "Escribe un correo válido.") && valid;
    if (document.querySelector("#objective").value.trim().length < 15) valid = setFieldError(document.querySelector("#objective"), "Agrega un poco más de detalle (mínimo 15 caracteres).") && valid;

    const briefLink = document.querySelector("#briefLink");
    if (briefLink.value && !isValidUrl(briefLink.value)) valid = setFieldError(briefLink, "Escribe un enlace válido que comience con http:// o https://") && valid;

    if (!dateInput.value) {
      document.querySelector("#dateError").textContent = "Selecciona una fecha disponible.";
      valid = false;
    }
    if (!timeInput.value) {
      document.querySelector("#timeError").textContent = "Selecciona un horario.";
      valid = false;
    }
    if (!document.querySelector("#acceptRules").checked) {
      document.querySelector("#rulesError").textContent = "Debes aceptar las reglas para continuar.";
      valid = false;
    }
    return valid;
  }

  function setFieldError(field, message) {
    field.setAttribute("aria-invalid", "true");
    const wrapper = field.closest(".field");
    const error = wrapper?.querySelector(".field-error");
    if (error) error.textContent = message;
    return false;
  }

  function clearFieldError(field) {
    field?.removeAttribute("aria-invalid");
    const wrapper = field?.closest?.(".field");
    const error = wrapper?.querySelector(".field-error");
    if (error) error.textContent = "";
    if (field === dateInput) document.querySelector("#dateError").textContent = "";
    if (field === timeInput) document.querySelector("#timeError").textContent = "";
    if (field?.id === "acceptRules") document.querySelector("#rulesError").textContent = "";
  }

  function updateSummary() {
    setText("#summaryClient", clientInput.value.trim() || "Sin seleccionar");
    setText("#summaryDate", selectedDate ? formatLongDate(selectedDate) : "Sin seleccionar");
    setText("#summaryTime", selectedTime ? `${formatTime(selectedTime)} · Hora CDMX` : "Sin seleccionar");
    setText("#summaryDuration", document.querySelector("#duration").value || "Sin seleccionar");
    setText("#summaryModality", document.querySelector("#modality").value || "Sin seleccionar");
  }

  function showConfirmation(id, accessToken, payload) {
    document.querySelector("#confirmationId").textContent = id;
    document.querySelector("#confirmationToken").textContent = accessToken || "Revisa tu correo";
    const details = document.querySelector("#confirmationDetails");
    details.innerHTML = `
      <div><small>Empresa</small><strong>${escapeHtml(payload.client)}</strong></div>
      <div><small>Estatus</small><strong>Pendiente</strong></div>
      <div><small>Fecha</small><strong>${escapeHtml(formatLongDate(parseIsoDate(payload.date)))}</strong></div>
      <div><small>Horario</small><strong>${escapeHtml(formatTime(payload.time))}</strong></div>
    `;
    const statusLink = document.querySelector("#confirmationStatusLink");
    const query = new URLSearchParams({ id });
    if (accessToken) query.set("token", accessToken);
    statusLink.href = `/estatus?${query.toString()}`;
    modal.showModal();
  }

  function resetForm() {
    form.reset();
    selectedDate = null;
    selectedTime = "";
    dateInput.value = "";
    timeInput.value = "";
    visibleMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1, 12);
    selectedDateLabel.textContent = "Selecciona una fecha";
    slotGrid.innerHTML = '<p class="slot-placeholder">Elige un día para consultar los horarios.</p>';
    form.querySelectorAll("[aria-invalid]").forEach((field) => field.removeAttribute("aria-invalid"));
    form.querySelectorAll(".field-error").forEach((error) => { error.textContent = ""; });
    document.querySelector("#objectiveCount").textContent = "0";
    setDefaultValues();
    renderCalendar();
    updateSummary();
    shouldResetAfterModal = false;
  }

  function setSubmitting(active) {
    submitButton.disabled = active;
    submitButton.querySelector("span").textContent = active ? "Registrando solicitud…" : "Enviar solicitud";
  }

  function contactTeam() {
    const message = encodeURIComponent("Hola, equipo de Focus Media. Necesito apoyo con una grabación y tengo un requerimiento especial.");
    if (config.whatsappNumber) {
      window.open(`https://wa.me/${String(config.whatsappNumber).replace(/\D/g, "")}?text=${message}`, "_blank", "noopener");
    } else if (config.contactEmail) {
      window.location.href = `mailto:${config.contactEmail}?subject=Requerimiento especial de grabación&body=${message}`;
    } else {
      showToast("Configura el WhatsApp o correo del equipo en config.js.", true);
    }
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 4300);
  }

  function getTodayInZone() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    return new Date(values.year, values.month - 1, values.day, 12);
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function nextAvailableDay(date) {
    const copy = new Date(date);
    while (!availableWeekdays.includes(copy.getDay())) copy.setDate(copy.getDate() + 1);
    return copy;
  }

  function parseIsoDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function dateToIso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatLongDate(date, options = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) {
    const value = new Intl.DateTimeFormat("es-MX", options).format(date);
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function formatTime(value) {
    const [hours, minutes] = String(value).split(":").map(Number);
    const suffix = hours >= 12 ? "p. m." : "a. m.";
    const twelveHour = hours % 12 || 12;
    return `${twelveHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
  }

  function sameDate(a, b) { return dateToIso(a) === dateToIso(b); }
  function setText(selector, value) { document.querySelector(selector).textContent = value; }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function isValidUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol); } catch { return false; } }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
})();

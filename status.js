(() => {
  "use strict";

  const config = window.FOCUS_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get("demo") === "1" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const form = document.querySelector("#statusForm");
  const idInput = document.querySelector("#statusId");
  const tokenInput = document.querySelector("#statusToken");
  const submit = document.querySelector("#statusSubmit");
  const result = document.querySelector("#statusResult");
  const toast = document.querySelector("#toast");

  idInput.value = params.get("id") || "";
  tokenInput.value = params.get("token") || "";
  form.addEventListener("submit", lookupStatus);
  document.querySelector("#statusContact").addEventListener("click", contactTeam);

  if (idInput.value && tokenInput.value) lookupStatus(new Event("submit"));

  async function lookupStatus(event) {
    event.preventDefault();
    clearErrors();
    const id = idInput.value.trim().toUpperCase();
    const token = tokenInput.value.trim().toUpperCase();
    if (!id || !token) {
      if (!id) setError(idInput, "Escribe el folio.");
      if (!token) setError(tokenInput, "Escribe la clave privada.");
      return;
    }

    setLoading(true);
    const slowNotice = setTimeout(() => showToast("Google está tardando un poco; seguimos consultando tu solicitud."), 8000);
    try {
      let booking;
      if (isDemo) {
        await wait(450);
        const date = new Date(); date.setDate(date.getDate() + 8);
        booking = {
          id, client: "Cliente de demostración", status: "Confirmada",
          date: date.toISOString().slice(0, 10), time: "15:00", duration: "3 horas",
          recordingType: "Contenido para Reels / TikTok", modality: "En instalaciones del cliente",
          adminNote: "La fecha y el horario fueron autorizados por el equipo.", updatedAt: new Date().toISOString()
        };
      } else {
        const query = new URLSearchParams({ id, token });
        const response = await fetch(`/api/status?${query.toString()}`, { headers: { Accept: "application/json" } });
        const payload = await readJson(response);
        if (!response.ok || !payload.ok) throw new Error(payload.error || "No encontramos la solicitud.");
        booking = payload.booking;
      }
      renderBooking(booking);
      const updatedUrl = new URL(window.location.href);
      updatedUrl.searchParams.set("id", id);
      updatedUrl.searchParams.set("token", token);
      history.replaceState({}, "", updatedUrl);
    } catch (error) {
      result.classList.add("hidden");
      showToast(error.message || "No fue posible consultar la solicitud.", true);
    } finally {
      clearTimeout(slowNotice);
      setLoading(false);
    }
  }

  function renderBooking(booking) {
    setText("#resultId", booking.id);
    setText("#resultClient", booking.client);
    setText("#resultDate", formatDate(booking.date));
    setText("#resultTime", `${formatTime(booking.time)} · Hora CDMX`);
    setText("#resultDuration", booking.duration);
    setText("#resultType", booking.recordingType);
    setText("#resultModality", booking.modality);
    setText("#resultUpdated", formatDateTime(booking.updatedAt));

    const pill = document.querySelector("#resultStatus");
    pill.textContent = booking.status;
    pill.className = `status-pill status-${normalize(booking.status)}`;

    const note = document.querySelector("#resultNote");
    if (booking.adminNote) {
      note.textContent = booking.adminNote;
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }

    const activeCount = {
      Pendiente: 2,
      Reprogramada: 2,
      Confirmada: 3,
      Completada: 4,
      Rechazada: 1,
      Cancelada: 1
    }[booking.status] || 1;
    document.querySelectorAll(".timeline-step").forEach((step, index) => step.classList.toggle("is-active", index < activeCount));
    result.classList.remove("hidden");
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function contactTeam() {
    const text = encodeURIComponent(`Hola, equipo de Focus Media. Necesito apoyo con la solicitud ${idInput.value.trim() || "de grabación"}.`);
    if (config.whatsappNumber) window.open(`https://wa.me/${String(config.whatsappNumber).replace(/\D/g, "")}?text=${text}`, "_blank", "noopener");
    else if (config.contactEmail) window.location.href = `mailto:${config.contactEmail}?subject=Seguimiento de grabación&body=${text}`;
  }

  function setLoading(active) {
    submit.disabled = active;
    submit.querySelector("span").textContent = active ? "Consultando…" : "Consultar";
  }
  function setError(input, message) { input.setAttribute("aria-invalid", "true"); input.closest(".field").querySelector(".field-error").textContent = message; }
  function clearErrors() { form.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid")); form.querySelectorAll(".field-error").forEach((item) => { item.textContent = ""; }); }
  function setText(selector, value) { document.querySelector(selector).textContent = value || "—"; }
  function formatDate(value) { const [y, m, d] = String(value).split("-").map(Number); return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d, 12)); }
  function formatDateTime(value) { if (!value) return "—"; return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
  function formatTime(value) { const [h, m] = String(value).split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "p. m." : "a. m."}`; }
  function normalize(value) { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  async function readJson(response) {
    const text = await response.text();
    try { return JSON.parse(text); } catch { throw new Error("La agenda respondió de forma incompleta. Actualiza la página e intenta nuevamente."); }
  }
  function showToast(message, error = false) { toast.textContent = message; toast.classList.toggle("is-error", error); toast.classList.add("is-visible"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 4200); }
})();

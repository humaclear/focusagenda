const crypto = require("node:crypto");

const TIMEZONE = "America/Mexico_City";
const DEFAULT_SLOTS = ["09:00", "12:00", "15:00", "17:00"];
const ALLOWED_DURATIONS = ["2 horas", "3 horas", "Más de 3 horas (requiere autorización)"];

function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!res.getHeader || !res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store");
  res.status(status).json(payload);
}

function methodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  send(res, 405, { ok: false, error: "Método no permitido." });
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function clean(value, max = 250) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function getSlots() {
  const raw = clean(process.env.BOOKING_SLOTS || "", 300);
  const values = raw ? raw.split(",").map((value) => value.trim()) : DEFAULT_SLOTS;
  return values.filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function getAllowedWeekdays() {
  const raw = clean(process.env.BOOKING_WEEKDAYS || "0,1,2,3,4,5,6", 50);
  const values = raw.split(",").map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  return values.length ? [...new Set(values)] : [0, 1, 2, 3, 4, 5, 6];
}

function getTodayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isoToDayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const [year, month, day] = value.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
  return Math.floor(stamp / 86400000);
}

function isAllowedWeekday(value) {
  const [year, month, day] = value.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return getAllowedWeekdays().includes(weekday);
}

function validateDate(value) {
  const day = isoToDayNumber(value);
  if (!Number.isFinite(day)) return "La fecha no es válida.";
  const today = isoToDayNumber(getTodayIso());
  const minLead = Number(process.env.MIN_LEAD_DAYS || 5);
  const maxAdvance = Number(process.env.MAX_ADVANCE_DAYS || 90);
  if (day < today + minLead) return `La grabación debe solicitarse con al menos ${minLead} días de anticipación.`;
  if (day > today + maxAdvance) return `La fecha no puede superar ${maxAdvance} días de anticipación.`;
  if (!isAllowedWeekday(value)) return "Ese día no está habilitado para solicitudes en línea.";
  return "";
}

function validateAdminDate(value) {
  return Number.isFinite(isoToDayNumber(value)) ? "" : "La fecha no es válida.";
}

function validateMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) return "El mes no es válido.";
  const [year, month] = value.split("-").map(Number);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return "El mes no es válido.";
  return "";
}

function validateOrigin(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  const origin = req.headers.origin;
  if (!configured || !origin) return true;
  try { return new URL(configured).origin === new URL(origin).origin; } catch { return false; }
}

function validateBooking(input) {
  const booking = {
    client: clean(input.client, 80),
    contactName: clean(input.contactName, 80),
    phone: clean(input.phone, 20).replace(/\D/g, ""),
    email: clean(input.email, 120).toLowerCase(),
    date: clean(input.date, 10),
    time: clean(input.time, 5),
    recordingType: clean(input.recordingType, 100),
    duration: clean(input.duration, 40),
    modality: clean(input.modality, 80),
    participants: clean(input.participants, 30),
    location: clean(input.location, 180),
    objective: clean(input.objective, 900),
    briefLink: clean(input.briefLink, 500),
    specialRequirements: clean(input.specialRequirements, 600),
    acceptRules: input.acceptRules === true,
    website: clean(input.website, 200)
  };

  if (booking.website) return { error: "No fue posible procesar la solicitud." };
  const required = ["client", "contactName", "phone", "email", "date", "time", "recordingType", "duration", "modality", "participants", "objective"];
  if (required.some((key) => !booking[key])) return { error: "Completa todos los campos obligatorios." };
  if (booking.phone.length !== 10) return { error: "El WhatsApp debe tener 10 dígitos." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) return { error: "El correo no es válido." };
  if (booking.objective.length < 15) return { error: "Agrega más información sobre el objetivo de la grabación." };
  if (booking.briefLink) {
    try { const url = new URL(booking.briefLink); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); } catch { return { error: "El enlace de planeación no es válido." }; }
  }
  const dateError = validateDate(booking.date);
  if (dateError) return { error: dateError };
  if (!getSlots().includes(booking.time)) return { error: "El horario seleccionado no está disponible." };
  if (!ALLOWED_DURATIONS.includes(booking.duration)) return { error: "La duración seleccionada no es válida." };
  const [hours, minutes] = booking.time.split(":").map(Number);
  const durationMinutes = booking.duration === "2 horas" ? 120 : booking.duration === "3 horas" ? 180 : 240;
  if (hours * 60 + minutes + durationMinutes > 20 * 60) return { error: "La sesión debe terminar a más tardar a las 8:00 p. m." };
  if (!booking.acceptRules) return { error: "Debes aceptar las reglas de agenda." };
  return { booking };
}

function verifyAdmin(req) {
  const expected = process.env.ADMIN_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  return crypto.timingSafeEqual(expectedHash, suppliedHash);
}

function requireIntegration() {
  if (!process.env.FOCUS_SCRIPT_URL || !process.env.FOCUS_API_SECRET) {
    const error = new Error("La agenda aún no está conectada. Revisa las variables de entorno en Vercel.");
    error.status = 503;
    throw error;
  }
}

async function callScript(action, { method = "GET", query = {}, body = {} } = {}) {
  requireIntegration();
  const timeoutMs = getIntegrationTimeoutMs();
  const maxAttempts = method === "GET" ? 2 : 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let url = String(process.env.FOCUS_SCRIPT_URL || "").trim();
    const options = { method, signal: controller.signal, redirect: "follow", headers: { Accept: "application/json" } };

    if (method === "GET") {
      const search = new URLSearchParams({ action, apiSecret: process.env.FOCUS_API_SECRET, ...query });
      url += `${url.includes("?") ? "&" : "?"}${search.toString()}`;
    } else {
      options.headers["Content-Type"] = "text/plain;charset=utf-8";
      options.body = JSON.stringify({ action, apiSecret: process.env.FOCUS_API_SECRET, ...body });
    }

    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch {
        const invalidError = new Error("Google respondió con una página no válida. Verifica que Apps Script esté publicado para cualquier usuario y que FOCUS_SCRIPT_URL termine en /exec.");
        invalidError.status = 502;
        invalidError.retryable = false;
        throw invalidError;
      }
      if (!response.ok || !result.ok) {
        const responseError = new Error(result.error || "No fue posible completar la operación.");
        responseError.status = response.status >= 400 ? response.status : 502;
        responseError.retryable = false;
        throw responseError;
      }
      return result;
    } catch (error) {
      lastError = error;
      const retryable = error.name === "AbortError" || error.retryable !== false && !error.status;
      if (!retryable || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError && lastError.name === "AbortError") {
    const timeoutError = new Error("Google tardó demasiado en responder. La solicitud no se perdió; espera unos segundos e intenta de nuevo.");
    timeoutError.status = 504;
    throw timeoutError;
  }
  throw lastError;
}

function getIntegrationTimeoutMs() {
  const configured = Number(process.env.FOCUS_TIMEOUT_MS || 20000);
  if (!Number.isFinite(configured)) return 20000;
  return Math.min(25000, Math.max(5000, Math.round(configured)));
}

module.exports = {
  callScript,
  clean,
  getAllowedWeekdays,
  getBody,
  getSlots,
  methodNotAllowed,
  send,
  validateAdminDate,
  validateBooking,
  validateDate,
  validateMonth,
  validateOrigin,
  verifyAdmin
};

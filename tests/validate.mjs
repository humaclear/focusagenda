import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const require = createRequire(import.meta.url);
const shared = require(path.join(root, "lib", "server.js"));
const bookingsHandler = require(path.join(root, "api", "bookings.js"));
const availabilityHandler = require(path.join(root, "api", "availability.js"));
const adminHandler = require(path.join(root, "api", "admin.js"));
const statusHandler = require(path.join(root, "api", "status.js"));
const healthHandler = require(path.join(root, "api", "health.js"));

const requiredFiles = [
  "index.html", "estatus.html", "admin.html", "styles.css", "app.js", "status.js", "admin.js", "config.js",
  "vercel.json", ".env.example", "api/bookings.js", "api/availability.js", "api/status.js",
  "api/admin.js", "api/health.js", "google-apps-script/Code.gs", "assets/focus-media-logo.png"
];

for (const file of requiredFiles) assert.ok(fs.existsSync(path.join(root, file)), `Falta ${file}`);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const statusHtml = fs.readFileSync(path.join(root, "estatus.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
assert.match(html, /id="bookingForm"/);
assert.match(html, /id="calendarGrid"/);
assert.match(html, /id="acceptRules"/);
assert.match(html, /id="confirmationToken"/);
assert.match(html, /pendiente de confirmación/i);
assert.match(html, /<input id="client"[^>]+name="client"/);
assert.doesNotMatch(html, /Suela Fresca|Fisioterapia a tu alcance|Santosha|Camil Beauty/i);
assert.match(statusHtml, /id="statusForm"/);
assert.match(adminHtml, /id="editBookingModal"/);
assert.match(adminHtml, />Rechazada</);
assert.equal(vercelConfig.cleanUrls, true);
assert.equal(vercelConfig.rewrites, undefined, "Con cleanUrls no se deben reescribir archivos .html");
assert.equal(vercelConfig.functions["api/*.js"].maxDuration, 60);

function assertUniqueIds(source, label) {
  const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, `${label} contiene IDs duplicados`);
}

function assertSelectorsExist(scriptName, source) {
  const script = fs.readFileSync(path.join(root, scriptName), "utf8");
  const selectors = [...script.matchAll(/querySelector\("#([A-Za-z][\w-]*)"\)/g)].map((match) => match[1]);
  for (const id of selectors) assert.match(source, new RegExp(`id="${id}"`), `${scriptName} referencia #${id}, pero no existe`);
}

assertUniqueIds(html, "index.html");
assertUniqueIds(statusHtml, "estatus.html");
assertUniqueIds(adminHtml, "admin.html");
assertSelectorsExist("app.js", html);
assertSelectorsExist("status.js", statusHtml);
assertSelectorsExist("admin.js", adminHtml);

process.env.MIN_LEAD_DAYS = "5";
process.env.MAX_ADVANCE_DAYS = "90";
process.env.BOOKING_SLOTS = "09:00,12:00,15:00,17:00";
process.env.BOOKING_WEEKDAYS = "0,1,2,3,4,5,6";

const todayParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit"
}).formatToParts(new Date());
const todayMap = Object.fromEntries(todayParts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
const today = new Date(Date.UTC(todayMap.year, todayMap.month - 1, todayMap.day));

function iso(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() + days); return copy; }

const validDate = addDays(today, 5);
const validBooking = {
  client: "Cliente prueba",
  contactName: "Contacto prueba",
  phone: "5512345678",
  email: "cliente@example.com",
  date: iso(validDate),
  time: "09:00",
  recordingType: "Contenido para Reels / TikTok",
  duration: "2 horas",
  modality: "En estudio",
  participants: "1",
  location: "Por definir",
  objective: "Grabar contenido de prueba con un objetivo definido.",
  briefLink: "https://drive.google.com/example",
  specialRequirements: "",
  acceptRules: true,
  website: ""
};

assert.ok(shared.validateBooking(validBooking).booking, "Una solicitud válida debe aceptarse");
assert.match(shared.validateBooking({ ...validBooking, date: iso(addDays(today, 1)) }).error, /al menos 5 días/i);
assert.match(shared.validateBooking({ ...validBooking, phone: "123" }).error, /10 dígitos/i);
assert.match(shared.validateBooking({ ...validBooking, time: "09:17" }).error, /horario/i);
assert.match(shared.validateBooking({ ...validBooking, duration: "Jornada completa" }).error, /duración/i);
assert.match(shared.validateBooking({ ...validBooking, time: "17:00", duration: "Más de 3 horas (requiere autorización)" }).error, /8:00 p\. m\./i);
assert.match(shared.validateBooking({ ...validBooking, briefLink: "javascript:alert(1)" }).error, /enlace/i);
assert.match(shared.validateBooking({ ...validBooking, website: "spam" }).error, /procesar/i);
assert.deepEqual(shared.getSlots(), ["09:00", "12:00", "15:00", "17:00"]);
assert.deepEqual(shared.getAllowedWeekdays(), [0, 1, 2, 3, 4, 5, 6]);
assert.equal(shared.validateMonth("2026-09"), "");
assert.match(shared.validateMonth("2026-13"), /mes/i);
assert.equal(shared.validateAdminDate("2026-09-22"), "");

function responseMock() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

let response = responseMock();
await availabilityHandler({ method: "GET", query: { date: iso(addDays(today, 1)) }, headers: {} }, response);
assert.equal(response.statusCode, 400);

response = responseMock();
await availabilityHandler({ method: "GET", query: { month: "2026-99" }, headers: {} }, response);
assert.equal(response.statusCode, 400);

response = responseMock();
await bookingsHandler({ method: "POST", body: { ...validBooking, phone: "1" }, headers: {} }, response);
assert.equal(response.statusCode, 400);

delete process.env.FOCUS_SCRIPT_URL;
delete process.env.FOCUS_API_SECRET;
response = responseMock();
await bookingsHandler({ method: "POST", body: validBooking, headers: {} }, response);
assert.equal(response.statusCode, 503);

response = responseMock();
await statusHandler({ method: "GET", query: { id: "", token: "" }, headers: {} }, response);
assert.equal(response.statusCode, 400);

response = responseMock();
await adminHandler({ method: "GET", headers: {}, query: {} }, response);
assert.equal(response.statusCode, 401);

process.env.FOCUS_SCRIPT_URL = "https://example.test/apps-script";
process.env.FOCUS_API_SECRET = "integration-secret";
process.env.ADMIN_TOKEN = "admin-secret";
let lastFetch = null;
global.fetch = async (url, options) => {
  lastFetch = { url: String(url), options };
  const request = options?.body ? JSON.parse(options.body) : null;
  let payload = { ok: true };
  if (String(url).includes("action=monthAvailability")) payload.days = { "2026-09-30": { available: 2, total: 4 } };
  if (String(url).includes("action=getBookingStatus")) payload.booking = { id: "FM-TEST", client: "Cliente", status: "Pendiente" };
  if (String(url).includes("action=health")) payload.spreadsheet = true;
  if (request?.action === "updateBooking") payload.booking = { ...request, id: request.id, status: request.status };
  return { ok: true, status: 200, async text() { return JSON.stringify(payload); } };
};

response = responseMock();
await availabilityHandler({ method: "GET", query: { month: "2026-09" }, headers: {} }, response);
assert.equal(response.statusCode, 200);
assert.equal(response.payload.days["2026-09-30"].available, 2);
assert.match(lastFetch.url, /action=monthAvailability/);

response = responseMock();
await statusHandler({ method: "GET", query: { id: "fm-test", token: "private-token" }, headers: {} }, response);
assert.equal(response.statusCode, 200);
assert.equal(response.payload.booking.id, "FM-TEST");
assert.match(lastFetch.url, /action=getBookingStatus/);

response = responseMock();
await healthHandler({ method: "GET", query: {}, headers: {} }, response);
assert.equal(response.statusCode, 200);
assert.equal(response.payload.connected, true);
assert.equal(response.payload.spreadsheet, true);

response = responseMock();
await adminHandler({
  method: "PATCH",
  headers: { authorization: "Bearer admin-secret" },
  body: { id: "FM-TEST", status: "Rechazada", date: iso(validDate), time: "12:00", duration: "3 horas", adminNote: "Propón otra fecha." }
}, response);
assert.equal(response.statusCode, 200);
const adminRequest = JSON.parse(lastFetch.options.body);
assert.equal(adminRequest.action, "updateBooking");
assert.equal(adminRequest.status, "Rechazada");
assert.equal(adminRequest.adminNote, "Propón otra fecha.");

console.log("✓ Estructura, agenda, seguimiento y validaciones verificadas");

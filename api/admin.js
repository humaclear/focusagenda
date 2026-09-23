const { callScript, clean, getBody, getSlots, methodNotAllowed, send, validateAdminDate, verifyAdmin } = require("../lib/server");

const ALLOWED_STATUSES = ["Pendiente", "Confirmada", "Reprogramada", "Rechazada", "Completada", "Cancelada"];
const ALLOWED_DURATIONS = ["2 horas", "3 horas", "Más de 3 horas (requiere autorización)"];

module.exports = async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) return methodNotAllowed(res, ["GET", "PATCH"]);
  if (!verifyAdmin(req)) return send(res, 401, { ok: false, error: "Clave de acceso incorrecta." });

  try {
    if (req.method === "GET") {
      const result = await callScript("listBookings");
      return send(res, 200, { ok: true, bookings: result.bookings || [] });
    }

    const body = getBody(req);
    const id = clean(body.id, 50);
    const status = clean(body.status, 30);
    if (!id || !ALLOWED_STATUSES.includes(status)) return send(res, 400, { ok: false, error: "Folio o estatus no válido." });
    const update = { id, status };
    const hasSchedule = body.date !== undefined || body.time !== undefined || body.duration !== undefined;
    if (hasSchedule) {
      update.date = clean(body.date, 10);
      update.time = clean(body.time, 5);
      update.duration = clean(body.duration, 50);
      const dateError = validateAdminDate(update.date);
      if (dateError) return send(res, 400, { ok: false, error: dateError });
      if (!getSlots().includes(update.time)) return send(res, 400, { ok: false, error: "El horario no es válido." });
      if (!ALLOWED_DURATIONS.includes(update.duration)) return send(res, 400, { ok: false, error: "La duración no es válida." });
      const [hours, minutes] = update.time.split(":").map(Number);
      const durationMinutes = update.duration === "2 horas" ? 120 : update.duration === "3 horas" ? 180 : 240;
      if (hours * 60 + minutes + durationMinutes > 20 * 60) return send(res, 400, { ok: false, error: "La sesión debe terminar a más tardar a las 8:00 p. m." });
    }
    if (body.adminNote !== undefined) update.adminNote = clean(body.adminNote, 500);
    const result = await callScript("updateBooking", { method: "POST", body: update });
    return send(res, 200, { ok: true, booking: result.booking });
  } catch (error) {
    return send(res, error.status || 500, { ok: false, error: error.message || "No fue posible completar la operación." });
  }
};

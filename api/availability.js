const { callScript, clean, getSlots, methodNotAllowed, send, validateDate, validateMonth, validateOrigin } = require("../lib/server");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  if (!validateOrigin(req)) return send(res, 403, { ok: false, error: "Origen no autorizado." });

  try {
    const month = clean(req.query.month, 7);
    if (month) {
      const monthError = validateMonth(month);
      if (monthError) return send(res, 400, { ok: false, error: monthError });
      const result = await callScript("monthAvailability", { query: { month, slots: getSlots().join(",") } });
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=120");
      return send(res, 200, { ok: true, month, days: result.days || {} });
    }

    const date = clean(req.query.date, 10);
    const duration = clean(req.query.duration || "2 horas", 50);
    const dateError = validateDate(date);
    if (dateError) return send(res, 400, { ok: false, error: dateError });
    const result = await callScript("availability", { query: { date, duration, slots: getSlots().join(",") } });
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, stale-while-revalidate=30");
    return send(res, 200, { ok: true, date, slots: result.slots || [] });
  } catch (error) {
    return send(res, error.status || 500, { ok: false, error: error.message || "No fue posible consultar la disponibilidad." });
  }
};

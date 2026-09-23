const { callScript, getBody, methodNotAllowed, send, validateBooking, validateOrigin } = require("../lib/server");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  if (!validateOrigin(req)) return send(res, 403, { ok: false, error: "Origen no autorizado." });

  const validated = validateBooking(getBody(req));
  if (validated.error) return send(res, 400, { ok: false, error: validated.error });

  try {
    const result = await callScript("createBooking", { method: "POST", body: { booking: validated.booking } });
    return send(res, 201, { ok: true, booking: result.booking });
  } catch (error) {
    return send(res, error.status || 500, { ok: false, error: error.message || "No fue posible registrar la solicitud." });
  }
};

const { callScript, clean, methodNotAllowed, send, validateOrigin } = require("../lib/server");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  if (!validateOrigin(req)) return send(res, 403, { ok: false, error: "Origen no autorizado." });

  const id = clean(req.query.id, 50).toUpperCase();
  const token = clean(req.query.token, 200);
  if (!id || !token) return send(res, 400, { ok: false, error: "Escribe el folio y la clave de seguimiento." });

  try {
    const result = await callScript("getBookingStatus", { query: { id, token } });
    return send(res, 200, { ok: true, booking: result.booking });
  } catch (error) {
    const integrationFailure = [502, 503, 504].includes(error.status);
    const status = integrationFailure ? error.status : 404;
    return send(res, status, {
      ok: false,
      error: integrationFailure ? error.message : "No encontramos una solicitud con esos datos."
    });
  }
};

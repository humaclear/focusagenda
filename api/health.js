const { callScript, methodNotAllowed, send } = require("../lib/server");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const startedAt = Date.now();

  try {
    const result = await callScript("health");
    return send(res, 200, {
      ok: true,
      configured: true,
      connected: true,
      spreadsheet: result.spreadsheet === true,
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    return send(res, error.status || 500, {
      ok: false,
      configured: !String(error.message || "").includes("aún no está conectada"),
      connected: false,
      error: error.message || "No fue posible comprobar la conexión.",
      latencyMs: Date.now() - startedAt
    });
  }
};

/**
 * Backend de agenda para Focus Media.
 *
 * 1. Vincula este código a una hoja de cálculo.
 * 2. Ejecuta setupFocusMediaAgenda una vez.
 * 3. Configura las Propiedades del script descritas en README.md.
 * 4. Implementa como aplicación web ejecutada por el propietario.
 */

const SHEET_NAME = "Solicitudes";
const TIMEZONE = "America/Mexico_City";
const CLOSING_MINUTES = 20 * 60;
const DEFAULT_SLOTS = ["09:00", "12:00", "15:00", "17:00"];
const DURATIONS = ["2 horas", "3 horas", "Más de 3 horas (requiere autorización)"];
const HEADERS = [
  "Folio", "Creada", "Cliente", "Contacto", "WhatsApp", "Correo",
  "Fecha", "Hora", "Tipo de grabación", "Duración", "Modalidad",
  "Participantes", "Locación", "Objetivo", "Link brief",
  "Requerimientos especiales", "Estatus", "Evento Calendar ID",
  "Última actualización", "Reglas aceptadas", "Token consulta",
  "Nota administrativa"
];
const STATUSES = ["Pendiente", "Confirmada", "Reprogramada", "Rechazada", "Completada", "Cancelada"];
const BLOCKING_STATUSES = ["Pendiente", "Confirmada", "Reprogramada"];

function doGet(e) {
  try {
    authorize_(e && e.parameter && e.parameter.apiSecret);
    const params = (e && e.parameter) || {};
    const action = String(params.action || "");
    if (action === "availability") return json_(getAvailability_(params));
    if (action === "monthAvailability") return json_(getMonthAvailability_(params));
    if (action === "health") return json_(health_());
    if (action === "listBookings") return json_({ ok: true, bookings: listBookings_() });
    if (action === "getBookingStatus") return json_(getBookingStatus_(params.id, params.token));
    return json_({ ok: false, error: "Acción no válida." });
  } catch (error) {
    return json_({ ok: false, error: publicError_(error) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    authorize_(payload.apiSecret);
    if (payload.action === "createBooking") return json_(createBooking_(payload.booking || {}));
    if (payload.action === "updateBooking") return json_(updateBooking_(payload));
    if (payload.action === "updateStatus") return json_(updateBooking_({ id: payload.id, status: payload.status }));
    return json_({ ok: false, error: "Acción no válida." });
  } catch (error) {
    return json_({ ok: false, error: publicError_(error) });
  }
}

function setupFocusMediaAgenda() {
  const sheet = getSheet_();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setBackground("#17131C")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  const widths = [150, 155, 190, 170, 120, 210, 110, 80, 220, 190, 190, 110, 230, 300, 240, 300, 125, 210, 155, 120, 250, 300];
  widths.forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });

  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange("Q2:Q").setDataValidation(statusRule);
  sheet.getRange("B:B").setNumberFormat("dd-mmm-yyyy hh:mm");
  sheet.getRange("S:S").setNumberFormat("dd-mmm-yyyy hh:mm");
  sheet.getRange("A:V").setVerticalAlignment("top");

  const statusRange = sheet.getRange("Q2:Q");
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Pendiente").setBackground("#FFF2CF").setFontColor("#835700").setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Confirmada").setBackground("#E8F8F0").setFontColor("#087443").setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Reprogramada").setBackground("#EEE7FF").setFontColor("#5924A5").setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Rechazada").setBackground("#FDECEE").setFontColor("#A6202E").setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Cancelada").setBackground("#FDECEE").setFontColor("#A6202E").setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Completada").setBackground("#E9F3FF").setFontColor("#185F9E").setRanges([statusRange]).build()
  ]);

  const props = PropertiesService.getScriptProperties();
  const current = props.getProperties();
  const defaults = {};
  if (!current.API_SECRET) defaults.API_SECRET = "REEMPLAZA-CON-UN-SECRETO-LARGO";
  if (!current.TEAM_EMAIL) defaults.TEAM_EMAIL = "f0cus.medi4.00@gmail.com";
  if (!current.CALENDAR_ID) defaults.CALENDAR_ID = "primary";
  if (!current.MIN_LEAD_DAYS) defaults.MIN_LEAD_DAYS = "5";
  if (!current.MAX_ADVANCE_DAYS) defaults.MAX_ADVANCE_DAYS = "90";
  if (!current.BOOKING_WEEKDAYS) defaults.BOOKING_WEEKDAYS = "0,1,2,3,4,5,6";
  if (!current.BOOKING_SLOTS) defaults.BOOKING_SLOTS = DEFAULT_SLOTS.join(",");
  if (!current.PUBLIC_PORTAL_URL) defaults.PUBLIC_PORTAL_URL = "https://agenda.focusmedia.mx";
  if (Object.keys(defaults).length) props.setProperties(defaults, false);

  sheet.getParent().toast("La hoja quedó preparada. Continúa con las Propiedades del script.", "Focus Media", 8);
}

function createBooking_(raw) {
  const booking = validateBooking_(raw);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_();
    const rows = getDataRows_(sheet);
    if (!isSlotAvailableFromRows_(rows, booking, "")) throw new Error("Ese horario acaba de ocuparse. Selecciona otra opción.");

    const id = createFolio_(booking.date);
    const accessToken = createToken_();
    const tokenHash = hashToken_(accessToken);
    const now = new Date();
    let calendarEventId = "";
    try { calendarEventId = createCalendarEvent_(id, booking); } catch (calendarError) { console.error(calendarError); }

    sheet.appendRow([
      id, now, booking.client, booking.contactName, booking.phone, booking.email,
      booking.date, booking.time, booking.recordingType, booking.duration,
      booking.modality, booking.participants, booking.location, booking.objective,
      booking.briefLink, booking.specialRequirements, "Pendiente", calendarEventId,
      now, "Sí", tokenHash, ""
    ]);
    sheet.getRange(sheet.getLastRow(), 1, 1, HEADERS.length).setWrap(true);

    try { notifyNewBooking_(id, booking, accessToken); } catch (mailError) { console.error(mailError); }
    return { ok: true, booking: { id: id, status: "Pendiente", accessToken: accessToken } };
  } finally {
    lock.releaseLock();
  }
}

function getAvailability_(params) {
  const date = String(params.date || "");
  const duration = String(params.duration || "2 horas");
  validateDate_(date);
  validateDuration_(duration);
  const slots = parseSlots_(params.slots);
  const rows = getDataRows_(getSheet_());
  return {
    ok: true,
    date: date,
    slots: slots.map(function (time) {
      return { time: time, available: isSlotAvailableFromRows_(rows, { date: date, time: time, duration: duration }, "") };
    })
  };
}

function getMonthAvailability_(params) {
  const month = String(params.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("El mes no es válido.");
  const parts = month.split("-").map(Number);
  if (parts[1] < 1 || parts[1] > 12) throw new Error("El mes no es válido.");

  const props = PropertiesService.getScriptProperties();
  const slots = parseSlots_(params.slots);
  const allowedDays = getAllowedDays_();
  const minLead = Number(props.getProperty("MIN_LEAD_DAYS") || 5);
  const maxAdvance = Number(props.getProperty("MAX_ADVANCE_DAYS") || 90);
  const today = parseDate_(Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd"));
  const rows = getDataRows_(getSheet_());
  const days = {};
  const daysInMonth = new Date(parts[0], parts[1], 0, 12).getDate();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(parts[0], parts[1] - 1, day, 12);
    const iso = formatDate_(date);
    const diff = Math.floor((date.getTime() - today.getTime()) / 86400000);
    let available = 0;
    if (diff >= minLead && diff <= maxAdvance && allowedDays.indexOf(date.getDay()) !== -1) {
      available = slots.filter(function (time) {
        return isSlotAvailableFromRows_(rows, { date: iso, time: time, duration: "2 horas" }, "");
      }).length;
    }
    days[iso] = { available: available, total: slots.length };
  }
  return { ok: true, month: month, days: days };
}

function getBookingStatus_(id, token) {
  id = String(id || "").trim().toUpperCase();
  token = String(token || "").trim().toUpperCase();
  if (!id || !token) throw new Error("No encontramos una solicitud con esos datos.");
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) throw new Error("No encontramos una solicitud con esos datos.");
  const booking = rowToBooking_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
  if (!booking.tokenHash || booking.tokenHash !== hashToken_(token)) throw new Error("No encontramos una solicitud con esos datos.");
  return { ok: true, booking: publicBooking_(booking) };
}

function health_() {
  const sheet = getSheet_();
  return {
    ok: true,
    spreadsheet: Boolean(sheet),
    requests: Math.max(0, sheet.getLastRow() - 1),
    checkedAt: new Date().toISOString()
  };
}

function listBookings_() {
  const sheet = getSheet_();
  const values = getDataRows_(sheet);
  return values.map(rowToBooking_).filter(function (booking) { return booking.id; }).map(adminBooking_).sort(function (a, b) {
    return (a.date + "T" + a.time).localeCompare(b.date + "T" + b.time);
  });
}

function updateBooking_(payload) {
  const id = String(payload.id || "").trim().toUpperCase();
  const status = String(payload.status || "").trim();
  if (!id || STATUSES.indexOf(status) === -1) throw new Error("Folio o estatus no válido.");

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_();
    const row = findRowById_(sheet, id);
    if (!row) throw new Error("No encontramos la solicitud indicada.");
    const current = rowToBooking_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
    const candidate = {
      date: payload.date == null ? current.date : clean_(payload.date, 10),
      time: payload.time == null ? current.time : clean_(payload.time, 5),
      duration: payload.duration == null ? current.duration : clean_(payload.duration, 50)
    };
    validateAdminDate_(candidate.date);
    validateTime_(candidate.time);
    validateDuration_(candidate.duration);

    const rows = getDataRows_(sheet);
    if (BLOCKING_STATUSES.indexOf(status) !== -1 && !isSlotAvailableFromRows_(rows, candidate, id)) {
      throw new Error("El horario se traslapa con otra grabación o supera las 8:00 p. m.");
    }

    sheet.getRange(row, 7).setValue(candidate.date);
    sheet.getRange(row, 8).setValue(candidate.time);
    sheet.getRange(row, 10).setValue(candidate.duration);
    sheet.getRange(row, 17).setValue(status);
    sheet.getRange(row, 19).setValue(new Date());
    if (payload.adminNote != null) sheet.getRange(row, 22).setValue(clean_(payload.adminNote, 500));

    const booking = rowToBooking_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
    try { updateCalendarEvent_(booking); } catch (calendarError) { console.error(calendarError); }
    try { notifyStatusChange_(booking); } catch (mailError) { console.error(mailError); }
    return { ok: true, booking: adminBooking_(booking) };
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("No se encontró la hoja de cálculo vinculada.");
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  const currentHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (currentHeaders.join("|") !== HEADERS.join("|")) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  return sheet;
}

function getDataRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
}

function isSlotAvailableFromRows_(rows, candidate, excludeId) {
  const candidateStart = minutes_(candidate.time);
  const candidateEnd = candidateStart + durationMinutes_(candidate.duration);
  if (!Number.isFinite(candidateStart) || candidateEnd > CLOSING_MINUTES) return false;
  return !rows.some(function (row) {
    const id = String(row[0] || "");
    const date = normalizeDateCell_(row[6]);
    const status = String(row[16] || "");
    if ((excludeId && id === excludeId) || date !== candidate.date || BLOCKING_STATUSES.indexOf(status) === -1) return false;
    const start = minutes_(normalizeTimeCell_(row[7]));
    const end = start + durationMinutes_(String(row[9] || "2 horas"));
    return candidateStart < end && candidateEnd > start;
  });
}

function validateBooking_(raw) {
  const booking = {
    client: clean_(raw.client, 80), contactName: clean_(raw.contactName, 80),
    phone: clean_(raw.phone, 20).replace(/\D/g, ""), email: clean_(raw.email, 120).toLowerCase(),
    date: clean_(raw.date, 10), time: clean_(raw.time, 5), recordingType: clean_(raw.recordingType, 100),
    duration: clean_(raw.duration, 50), modality: clean_(raw.modality, 80), participants: clean_(raw.participants, 30),
    location: clean_(raw.location, 180), objective: clean_(raw.objective, 900), briefLink: clean_(raw.briefLink, 500),
    specialRequirements: clean_(raw.specialRequirements, 600), acceptRules: raw.acceptRules === true
  };
  const required = ["client", "contactName", "phone", "email", "date", "time", "recordingType", "duration", "modality", "participants", "objective"];
  if (required.some(function (key) { return !booking[key]; })) throw new Error("Completa todos los campos obligatorios.");
  if (booking.phone.length !== 10) throw new Error("El WhatsApp debe tener 10 dígitos.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) throw new Error("El correo no es válido.");
  if (booking.objective.length < 15) throw new Error("Agrega más información sobre el objetivo de la grabación.");
  if (booking.briefLink && !/^https?:\/\//i.test(booking.briefLink)) throw new Error("El enlace de planeación no es válido.");
  if (!booking.acceptRules) throw new Error("Debes aceptar las reglas de agenda.");
  validateDate_(booking.date);
  validateTime_(booking.time);
  validateDuration_(booking.duration);
  if (minutes_(booking.time) + durationMinutes_(booking.duration) > CLOSING_MINUTES) throw new Error("La sesión debe terminar a más tardar a las 8:00 p. m.");
  return booking;
}

function validateDate_(value) {
  validateAdminDate_(value);
  const selected = parseDate_(value);
  const today = parseDate_(Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd"));
  const diff = Math.floor((selected.getTime() - today.getTime()) / 86400000);
  const props = PropertiesService.getScriptProperties();
  const minLead = Number(props.getProperty("MIN_LEAD_DAYS") || 5);
  const maxAdvance = Number(props.getProperty("MAX_ADVANCE_DAYS") || 90);
  if (diff < minLead) throw new Error("La grabación debe solicitarse con al menos " + minLead + " días de anticipación.");
  if (diff > maxAdvance) throw new Error("La fecha supera el máximo de anticipación permitido.");
  if (getAllowedDays_().indexOf(selected.getDay()) === -1) throw new Error("Ese día no está habilitado para solicitudes en línea.");
}

function validateAdminDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("La fecha no es válida.");
  const selected = parseDate_(value);
  if (isNaN(selected.getTime()) || formatDate_(selected) !== value) throw new Error("La fecha no es válida.");
}

function validateTime_(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value) || getConfiguredSlots_().indexOf(value) === -1) throw new Error("El horario no es válido.");
}

function validateDuration_(value) {
  if (DURATIONS.indexOf(value) === -1) throw new Error("La duración no es válida.");
}

function getAllowedDays_() {
  return String(PropertiesService.getScriptProperties().getProperty("BOOKING_WEEKDAYS") || "0,1,2,3,4,5,6")
    .split(",").map(Number).filter(function (day) { return day >= 0 && day <= 6; });
}

function getConfiguredSlots_() {
  return parseSlots_(PropertiesService.getScriptProperties().getProperty("BOOKING_SLOTS") || DEFAULT_SLOTS.join(","));
}

function parseSlots_(value) {
  const source = String(value || DEFAULT_SLOTS.join(","));
  const slots = source.split(",").map(function (item) { return item.trim(); }).filter(function (item) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(item); });
  return slots.length ? slots : DEFAULT_SLOTS.slice();
}

function createCalendarEvent_(id, booking) {
  const calendar = getCalendar_();
  if (!calendar) return "";
  const start = combineDateTime_(booking.date, booking.time);
  const end = new Date(start.getTime() + durationMinutes_(booking.duration) * 60000);
  const event = calendar.createEvent("[PENDIENTE] Grabación — " + booking.client, start, end, {
    description: bookingDescription_(id, Object.assign({}, booking, { status: "Pendiente" })),
    location: booking.location || booking.modality
  });
  event.setColor(CalendarApp.EventColor.MAUVE);
  return event.getId();
}

function updateCalendarEvent_(booking) {
  if (!booking.calendarEventId) return;
  const calendar = getCalendar_();
  if (!calendar) return;
  const event = calendar.getEventById(booking.calendarEventId);
  if (!event) return;
  const start = combineDateTime_(booking.date, booking.time);
  const end = new Date(start.getTime() + durationMinutes_(booking.duration) * 60000);
  event.setTime(start, end);
  event.setTitle("[" + booking.status.toUpperCase() + "] Grabación — " + booking.client);
  event.setDescription(bookingDescription_(booking.id, booking));
  event.setLocation(booking.location || booking.modality);
  if (booking.status === "Confirmada") event.setColor(CalendarApp.EventColor.GREEN);
  else if (booking.status === "Cancelada" || booking.status === "Rechazada") event.setColor(CalendarApp.EventColor.RED);
  else if (booking.status === "Completada") event.setColor(CalendarApp.EventColor.BLUE);
  else event.setColor(CalendarApp.EventColor.MAUVE);
}

function getCalendar_() {
  const id = PropertiesService.getScriptProperties().getProperty("CALENDAR_ID") || "primary";
  return id === "primary" ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
}

function notifyNewBooking_(id, booking, accessToken) {
  const props = PropertiesService.getScriptProperties();
  const teamEmail = props.getProperty("TEAM_EMAIL") || "f0cus.medi4.00@gmail.com";
  const trackingUrl = statusUrl_(id, accessToken);
  const trackingButton = '<p style="margin:22px 0 0"><a href="' + escapeHtml_(trackingUrl) + '" style="display:inline-block;background:#17131c;color:#fff;text-decoration:none;border-radius:12px;padding:13px 18px;font-weight:bold">Consultar mi solicitud</a></p>';
  const htmlClient = emailLayout_(
    "Solicitud recibida",
    "Hola " + escapeHtml_(booking.contactName) + ", registramos tu solicitud para <strong>" + escapeHtml_(booking.client) + "</strong>. La fecha todavía está pendiente de confirmación por el equipo.",
    bookingSummaryHtml_(id, booking, "Pendiente") + trackingButton
  );
  MailApp.sendEmail({ to: booking.email, subject: "Recibimos tu solicitud de grabación · " + id, htmlBody: htmlClient, name: "Focus Media" });

  if (teamEmail) {
    MailApp.sendEmail({
      to: teamEmail,
      subject: "Nueva solicitud de grabación · " + booking.client + " · " + id,
      htmlBody: emailLayout_("Nueva solicitud", "Hay una nueva grabación por revisar en el panel interno.", bookingSummaryHtml_(id, booking, "Pendiente")),
      name: "Agenda Focus Media",
      replyTo: booking.email
    });
  }
}

function notifyStatusChange_(booking) {
  const messageByStatus = {
    "Confirmada": "Tu fecha y horario fueron confirmados por el equipo.",
    "Reprogramada": "Tu solicitud fue reprogramada. Revisa los nuevos datos a continuación.",
    "Rechazada": "No fue posible autorizar esta solicitud. Puedes contactar al equipo para revisar alternativas.",
    "Completada": "La sesión fue marcada como completada. Gracias por trabajar con Focus Media.",
    "Cancelada": "La solicitud fue cancelada. Si necesitas una nueva fecha, puedes enviar otra solicitud.",
    "Pendiente": "La solicitud volvió a revisión y permanece pendiente de confirmación."
  };
  const note = booking.adminNote ? '<div style="background:#f1eafe;border-left:4px solid #7c3aed;border-radius:8px;padding:14px;margin-top:18px"><strong>Mensaje del equipo:</strong><br>' + escapeHtml_(booking.adminNote) + '</div>' : "";
  MailApp.sendEmail({
    to: booking.email,
    subject: "Actualización de tu grabación · " + booking.id,
    htmlBody: emailLayout_("Estatus: " + booking.status, messageByStatus[booking.status] || "Tu solicitud fue actualizada.", bookingSummaryHtml_(booking.id, booking, booking.status) + note + '<p style="font-size:13px;color:#696a73;margin-top:18px">Puedes consultar los cambios con el enlace privado enviado en tu correo de recepción.</p>'),
    name: "Focus Media"
  });
}

function bookingSummaryHtml_(id, booking, status) {
  return '<div style="background:#f5f5f7;border-radius:16px;padding:18px;margin-top:20px">' +
    '<p style="margin:0 0 8px"><strong>Folio:</strong> ' + escapeHtml_(id) + '</p>' +
    '<p style="margin:0 0 8px"><strong>Fecha:</strong> ' + escapeHtml_(booking.date) + ' · ' + escapeHtml_(booking.time) + '</p>' +
    '<p style="margin:0 0 8px"><strong>Duración:</strong> ' + escapeHtml_(booking.duration) + '</p>' +
    '<p style="margin:0 0 8px"><strong>Producción:</strong> ' + escapeHtml_(booking.recordingType) + '</p>' +
    '<p style="margin:0"><strong>Estatus:</strong> ' + escapeHtml_(status) + '</p></div>';
}

function emailLayout_(title, body, detail) {
  return '<div style="font-family:Arial,sans-serif;background:#f2f2f5;padding:28px;color:#17131c">' +
    '<div style="max-width:580px;margin:auto;background:#fff;border-radius:22px;padding:30px">' +
    '<p style="font-size:12px;letter-spacing:2px;font-weight:bold;color:#6d28d9">FOCUS MEDIA</p>' +
    '<h1 style="font-size:28px;line-height:1.1;margin:12px 0">' + escapeHtml_(title) + '</h1>' +
    '<p style="font-size:15px;line-height:1.65;color:#60616b">' + body + '</p>' + detail +
    '<p style="font-size:12px;color:#8a8b94;margin-top:24px">La fecha solo queda reservada cuando Focus Media la confirma expresamente.</p>' +
    '</div></div>';
}

function bookingDescription_(id, booking) {
  return [
    "Folio: " + id,
    "Estatus: " + (booking.status || "Pendiente"),
    "Cliente: " + booking.client,
    "Contacto: " + booking.contactName,
    "WhatsApp: " + booking.phone,
    "Correo: " + booking.email,
    "Tipo: " + booking.recordingType,
    "Duración: " + booking.duration,
    "Modalidad: " + booking.modality,
    "Participantes: " + booking.participants,
    "Objetivo: " + booking.objective,
    "Brief: " + (booking.briefLink || "Sin enlace"),
    "Especiales: " + (booking.specialRequirements || "Ninguno indicado"),
    "Nota del equipo: " + (booking.adminNote || "Sin nota")
  ].join("\n");
}

function rowToBooking_(row) {
  return {
    id: String(row[0] || ""), createdAt: normalizeDateTimeCell_(row[1]), client: String(row[2] || ""),
    contactName: String(row[3] || ""), phone: String(row[4] || ""), email: String(row[5] || ""),
    date: normalizeDateCell_(row[6]), time: normalizeTimeCell_(row[7]), recordingType: String(row[8] || ""),
    duration: String(row[9] || ""), modality: String(row[10] || ""), participants: String(row[11] || ""),
    location: String(row[12] || ""), objective: String(row[13] || ""), briefLink: String(row[14] || ""),
    specialRequirements: String(row[15] || ""), status: String(row[16] || "Pendiente"),
    calendarEventId: String(row[17] || ""), updatedAt: normalizeDateTimeCell_(row[18]),
    tokenHash: String(row[20] || ""), adminNote: String(row[21] || "")
  };
}

function adminBooking_(booking) {
  return {
    id: booking.id, createdAt: booking.createdAt, client: booking.client, contactName: booking.contactName,
    phone: booking.phone, email: booking.email, date: booking.date, time: booking.time,
    recordingType: booking.recordingType, duration: booking.duration, modality: booking.modality,
    participants: booking.participants, location: booking.location, objective: booking.objective,
    briefLink: booking.briefLink, specialRequirements: booking.specialRequirements,
    status: booking.status, updatedAt: booking.updatedAt, adminNote: booking.adminNote
  };
}

function publicBooking_(booking) {
  return {
    id: booking.id, client: booking.client, status: booking.status, date: booking.date,
    time: booking.time, duration: booking.duration, recordingType: booking.recordingType,
    modality: booking.modality, updatedAt: booking.updatedAt, adminNote: booking.adminNote
  };
}

function findRowById_(sheet, id) {
  if (sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < values.length; i += 1) if (values[i][0] === id) return i + 2;
  return 0;
}

function authorize_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty("API_SECRET");
  if (!expected || expected === "REEMPLAZA-CON-UN-SECRETO-LARGO") throw new Error("La integración no está configurada.");
  if (String(provided || "") !== expected) throw new Error("Acceso no autorizado.");
}

function createFolio_(date) {
  const stamp = String(date).replace(/-/g, "").slice(2);
  const random = Utilities.getUuid().replace(/-/g, "").slice(0, 5).toUpperCase();
  return "FM-" + stamp + "-" + random;
}

function createToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").slice(0, 32).toUpperCase();
}

function hashToken_(token) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest);
}

function statusUrl_(id, token) {
  const base = (PropertiesService.getScriptProperties().getProperty("PUBLIC_PORTAL_URL") || "https://agenda.focusmedia.mx").replace(/\/$/, "");
  return base + "/estatus?id=" + encodeURIComponent(id) + "&token=" + encodeURIComponent(token);
}

function parseDate_(value) { const parts = value.split("-").map(Number); return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0); }
function formatDate_(date) { return Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd"); }
function combineDateTime_(date, time) { const d = date.split("-").map(Number); const t = time.split(":").map(Number); return new Date(d[0], d[1] - 1, d[2], t[0], t[1], 0, 0); }
function minutes_(time) { const parts = String(time).split(":").map(Number); return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] * 60 + parts[1] : NaN; }
function durationMinutes_(value) { if (/Más de 3/i.test(value)) return 240; if (/^3 horas$/i.test(value)) return 180; return 120; }
function normalizeDateCell_(value) { return value instanceof Date ? Utilities.formatDate(value, TIMEZONE, "yyyy-MM-dd") : String(value || ""); }
function normalizeTimeCell_(value) { return value instanceof Date ? Utilities.formatDate(value, TIMEZONE, "HH:mm") : String(value || ""); }
function normalizeDateTimeCell_(value) { return value instanceof Date ? value.toISOString() : String(value || ""); }
function clean_(value, max) { return String(value == null ? "" : value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function escapeHtml_(value) { return String(value || "").replace(/[&<>"']/g, function (char) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]; }); }
function publicError_(error) { const message = String((error && error.message) || "Ocurrió un error."); return /Exception|Service invoked|Authorization/i.test(message) ? "No fue posible completar la operación. Revisa la configuración." : message; }
function json_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }

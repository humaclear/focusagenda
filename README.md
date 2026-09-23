# Focus Media · Agenda de grabaciones

Plataforma web lista para desplegar en Vercel bajo `agenda.focusmedia.mx`. Los clientes pueden consultar disponibilidad, enviar una solicitud y revisar su estatus con un folio y una clave privada. El equipo administra la agenda desde `/admin` y puede autorizar, rechazar o modificar fecha, horario, duración y mensaje al cliente.

## Funciones incluidas

- Portal responsivo con identidad visual de Focus Media.
- Campo abierto de empresa o marca; el portal público no muestra la cartera de clientes de Focus Media.
- Agenda de lunes a domingo con mínimo 5 días de anticipación.
- Horarios base: 9:00 a. m., 12:00 p. m., 3:00 p. m. y 5:00 p. m.
- Sesiones de 2 o 3 horas; solicitudes mayores a 3 horas requieren autorización.
- Cierre operativo a las 8:00 p. m.
- Calendario con días disponibles, ocupación parcial y días sin horarios.
- Bloqueo de traslapes entre solicitudes pendientes, confirmadas o reprogramadas.
- Brief de producción con tipo, locación, participantes, objetivo, guiones y requerimientos.
- Registro central en Google Sheets y evento provisional en Google Calendar.
- Correos de recepción y de actualización de estatus.
- Página privada `/estatus` para consulta mediante folio y clave de seguimiento.
- Panel privado `/admin` para aprobar, rechazar, reprogramar, completar o cancelar.
- Modificación administrativa de fecha, hora, duración y mensaje visible al cliente.
- Modo de demostración local sin servicios externos.

## Flujo de trabajo

1. El cliente revisa días y horarios visibles en el portal.
2. Envía el formulario; la solicitud inicia como `Pendiente`.
3. Vercel valida la información y Google Apps Script la registra en Sheets.
4. Se crea un evento provisional en Calendar y se envían el folio y la clave privada.
5. El equipo entra a `/admin`, revisa la solicitud y la confirma, rechaza o modifica.
6. El cliente recibe un correo y puede consultar el cambio desde `/estatus`.

La fecha **no queda reservada** hasta que el equipo la cambia a `Confirmada`.

## Política provisional incluida

- La solicitud debe enviarse con al menos 5 días naturales de anticipación.
- Toda fecha requiere confirmación expresa de Focus Media.
- Las reprogramaciones deben solicitarse al menos 48 horas antes; después quedan sujetas a disponibilidad.
- Un retraso del cliente no extiende automáticamente el horario reservado.
- Las sesiones estándar duran 2 o 3 horas.
- Una sesión mayor a 3 horas o una producción especial requiere autorización previa.
- El último horario base inicia a las 5:00 p. m.; una sesión de 3 horas termina a las 8:00 p. m.

Esta política está identificada como provisional y puede ajustarse después en `index.html`, `config.js`, las variables de Vercel y las Propiedades del script.

## 1. Preparar Google Sheets, Calendar y Apps Script

1. Crea una hoja nueva en la cuenta que administrará Focus Media.
2. Abre **Extensiones → Apps Script**.
3. Borra el contenido inicial y pega `google-apps-script/Code.gs`.
4. Guarda y ejecuta manualmente `setupFocusMediaAgenda`.
5. Autoriza acceso a Sheets, Calendar y correo.
6. En **Configuración del proyecto → Propiedades del script**, revisa estos valores:

| Propiedad | Valor recomendado |
|---|---|
| `API_SECRET` | Cadena larga y privada; debe coincidir con `FOCUS_API_SECRET` en Vercel. |
| `TEAM_EMAIL` | `f0cus.medi4.00@gmail.com` |
| `CALENDAR_ID` | `primary` o ID del calendario compartido de Focus Media. |
| `MIN_LEAD_DAYS` | `5` |
| `MAX_ADVANCE_DAYS` | `90` |
| `BOOKING_WEEKDAYS` | `0,1,2,3,4,5,6` |
| `BOOKING_SLOTS` | `09:00,12:00,15:00,17:00` |
| `PUBLIC_PORTAL_URL` | `https://agenda.focusmedia.mx` |

Si el script no está vinculado directamente a la hoja, agrega `SPREADSHEET_ID` con el ID visible en la URL de Google Sheets.

7. Pulsa **Implementar → Nueva implementación → Aplicación web**.
8. Selecciona **Ejecutar como: yo** y el acceso requerido para que el formulario pueda usar el servicio.
9. Copia la URL final que termina en `/exec`.

Cuando se actualice `Code.gs`, crea una **nueva versión de la implementación** de Apps Script. Editar el código sin actualizar la implementación no cambia el backend publicado.

## 2. Desplegar en Vercel

1. Sube la carpeta `focusmedia-agenda` a un repositorio privado de GitHub.
2. En Vercel selecciona **Add New → Project** e importa el repositorio.
3. No selecciones framework; Vercel detectará los archivos estáticos y las funciones de `api/`.
4. Agrega estas variables en **Settings → Environment Variables**:

| Variable | Valor o uso |
|---|---|
| `FOCUS_SCRIPT_URL` | URL `/exec` publicada desde Apps Script. |
| `FOCUS_API_SECRET` | Mismo valor privado que `API_SECRET`. |
| `FOCUS_TIMEOUT_MS` | `20000` (tolera el arranque en frío de Apps Script). |
| `ADMIN_TOKEN` | Clave larga y única para entrar a `/admin`. |
| `PUBLIC_BASE_URL` | `https://agenda.focusmedia.mx` |
| `MIN_LEAD_DAYS` | `5` |
| `MAX_ADVANCE_DAYS` | `90` |
| `BOOKING_SLOTS` | `09:00,12:00,15:00,17:00` |
| `BOOKING_WEEKDAYS` | `0,1,2,3,4,5,6` |

5. Despliega y prueba una solicitud completa antes de compartir la liga.

Después del despliegue abre `https://TU-DOMINIO/api/health`. Si la conexión está correcta debe mostrar `"ok":true`, `"connected":true` y `"spreadsheet":true`.

## 3. Conectar el dominio

En Vercel abre **Settings → Domains**, agrega `agenda.focusmedia.mx` y crea en el proveedor del dominio el registro DNS que Vercel indique. Después confirma:

- `PUBLIC_BASE_URL=https://agenda.focusmedia.mx` en Vercel.
- `PUBLIC_PORTAL_URL=https://agenda.focusmedia.mx` en Apps Script.
- El candado HTTPS aparece correctamente.

## Uso diario

### Cliente

- Portal: `https://agenda.focusmedia.mx`
- Seguimiento: `https://agenda.focusmedia.mx/estatus`
- El folio y la clave privada aparecen al enviar la solicitud y llegan por correo.
- El calendario muestra cantidad de horarios libres, no datos de otros clientes.

### Equipo Focus Media

- Panel: `https://agenda.focusmedia.mx/admin`
- El acceso usa la clave `ADMIN_TOKEN`.
- El selector de cada fila permite un cambio rápido de estatus.
- **Modificar** permite mover fecha u hora, cambiar duración, definir estatus y escribir una nota al cliente.
- Al guardar, se actualizan Sheets, Calendar, el seguimiento del cliente y el correo de notificación.

## Vista previa local

Desde la carpeta del proyecto:

```bash
python3 -m http.server 4173
```

- Portal: `http://localhost:4173/`
- Seguimiento: `http://localhost:4173/estatus.html?demo=1`
- Panel: `http://localhost:4173/admin.html?demo=1`
- En modo demo cualquier texto sirve como clave del panel.

El modo demo no escribe en Sheets ni crea eventos.

## Contacto configurado

- WhatsApp: `+52 56 3338 6666`
- Correo: `f0cus.medi4.00@gmail.com`

Los datos se editan en `config.js`. El número para WhatsApp debe conservar código de país y escribirse sin espacios.

## Seguridad

- Nunca publiques `API_SECRET` ni `ADMIN_TOKEN` en `config.js`, GitHub o capturas.
- Usa un repositorio privado y restringe el acceso a Vercel, Google Sheet y Calendar.
- La clave de seguimiento se guarda como hash en Sheets; el valor original solo se entrega al cliente al registrar la solicitud.
- El panel conserva la clave administrativa únicamente en la sesión del navegador.
- La disponibilidad y la regla de cinco días se validan en navegador, Vercel y Apps Script.
- Cambia ambas claves si una persona ajena obtiene acceso.
- Antes del lanzamiento público, agrega un aviso de privacidad adecuado al uso de datos e imagen.

## Para que quede “súper bien” antes del lanzamiento

Prioridad alta:

1. Definir el Calendar compartido definitivo y probar permisos.
2. Elegir una clave administrativa y secretos únicos de al menos 32 caracteres.
3. Publicar `agenda.focusmedia.mx` y completar una prueba de punta a punta.
4. Aprobar el texto definitivo de cancelación, reprogramación y puntualidad.
5. Preparar aviso de privacidad y consentimiento de uso de imagen.

Siguiente etapa recomendada:

- Cloudflare Turnstile o reCAPTCHA para reducir spam.
- Recordatorios automáticos 48 y 24 horas antes.
- Bloqueo de vacaciones, festivos y días internos desde el panel.
- Roles individuales para cada integrante del equipo y registro de quién hizo cada cambio.
- Carga directa de archivos, guiones o referencias.
- Definir zona de servicio y costos de traslado para clientes nuevos; esta versión todavía no los calcula.
- Analítica de solicitudes, confirmaciones, rechazos y horas de producción.
- Integración con el control quincenal de contenido.

## Archivos principales

| Archivo | Función |
|---|---|
| `index.html` | Portal de agenda para clientes. |
| `estatus.html` / `status.js` | Seguimiento privado de la solicitud. |
| `admin.html` / `admin.js` | Panel interno de administración. |
| `config.js` | Marca, clientes, horarios y contacto público. |
| `styles.css` | Diseño responsivo de las tres vistas. |
| `api/` | Funciones seguras de Vercel. |
| `lib/server.js` | Validaciones compartidas del servidor. |
| `google-apps-script/Code.gs` | Sheets, Calendar, correos y disponibilidad. |
| `.env.example` | Variables necesarias en Vercel. |

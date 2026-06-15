# Plan: Compartir/Embeber gráficos + arreglo de "Expand"

**Tarea:** Agregar una opción simple para **compartir/embeber** los gráficos Chart.js
(iframe en vivo + exportar a imagen PNG), y de paso **arreglar/mejorar un feature** existente.

**Fuente de verdad:** este archivo (`.mix/plan.md`). Editable.

---

## 0. Contexto del proyecto (lo que ya existe)

- Extensión CKAN que renderiza vistas de recurso CSV con **Chart.js** (vanilla JS, sin build).
- **Frontend:** `chartjs-ckan.js` expone `window.ChartJSCKAN = { init, getConfig, destroy }`.
- **Backend:** blueprint Flask `api.py` con 2 endpoints:
  - `GET /api/chartjs/data/<resource_id>` → datos del recurso (DataStore → fallback CSV), con auth por `resource_show`.
  - `POST /api/chartjs/view/<view_id>/save-config` → guarda config en `resource_view.chart_config` (JSON).
- **Template:** `chartjs_view.html` (editor con panel de config + canvas + botones Save/Expand).
- La config del gráfico se persiste en `resource_view.chart_config`.

---

## 1. Enfoque / arquitectura (plan unificado)

Coinciden **Codex** y **DeepSeek** en el enfoque base → lo adoptamos:

### A) Compartir / Embeber
1. **Exportar PNG (cliente, sin backend)** — lo más simple, siempre funciona.
   - `ChartJSCKAN.downloadPNG()` usa la instancia viva de Chart.js.
   - **Decisión propia (mejora sobre ambos asesores):** componer el canvas sobre un fondo
     **blanco** antes de exportar (el canvas de Chart.js es transparente → PNG feo en fondos oscuros).
   - Nombre de archivo derivado de `view_title` / `resource_name`.
2. **Embeber en vivo vía iframe** — nueva ruta Flask read-only.
   - `GET /chartjs/embed/<view_id>`: resuelve `resource_view_show` con el user del request
     (`ObjectNotFound→404`, `NotAuthorized→403`), lee `chart_config` + `resource_id` + título,
     y renderiza un template **standalone** `chartjs_embed.html` (sin layout de CKAN, sin panel
     de edición, sin Save).
   - El embed pide datos al endpoint existente `/api/chartjs/data/<resource_id>` y renderiza
     **solo el gráfico**, usando la **última config guardada**.
3. **UI de Share (modal liviano)** en la vista normal:
   - Botón **Share** en el header (junto a Save/Expand).
   - Modal con: URL de embed absoluta, snippet `<iframe>` listo, botones **Copiar URL** /
     **Copiar iframe**, y botón **Descargar PNG**.
   - Aviso claro: *"El embed refleja la última configuración guardada"* y *"Recursos públicos:
     se embeben en cualquier sitio; recursos privados: requieren que el visitante esté logueado
     en este CKAN (mismo origen)."*

### B) Feature a arreglar: **"Expand" (full-width) está roto** ← elegido
- **Verificado:** el JS hace `toggle('cj-expanded')` sobre `.container/.container-fluid`, pero
  **no existe ninguna regla CSS `.cj-expanded`** → no hace nada. Y `.cj-wrapper.full-width` solo
  aplica `margin:-15px` (un empujoncito, no un "expand" real).
- **Arreglo:** implementar full-width real con el truco de breakout a viewport:
  `.cj-wrapper.full-width { width: 100vw; margin-left: calc(50% - 50vw); }` (funciona en
  cualquier theme/contenedor centrado, sin depender del markup exacto de CKAN).
- Simplificar el JS para no togglear la clase muerta `.cj-expanded`; tras alternar full-width,
  llamar a un nuevo `ChartJSCKAN.resize()` para que Chart.js reajuste el canvas.
- **Aporte de DeepSeek incorporado:** el `chart.resize()` cubre su idea de "redimensionamiento"
  (nota: Chart.js ya usa `responsive:true, maintainAspectRatio:false`, así que el resize por
  ventana ya andaba; el gap real era el cambio de contenedor al expandir → ahí sirve el nudge).

---

## 2. Archivos a crear / modificar

| Archivo | Acción |
|---|---|
| `ckanext/chartjs/api.py` | **Modificar:** helper interno `_resolve_view(view_id)` (auth + config); nueva ruta `GET /chartjs/embed/<view_id>` que renderiza `chartjs_embed.html`. |
| `ckanext/chartjs/templates/chartjs_embed.html` | **Crear:** página HTML standalone (sin `{% extends %}`), carga Chart.js + app JS en modo read-only, render del gráfico con la config guardada. |
| `ckanext/chartjs/templates/chartjs_view.html` | **Modificar:** botón **Share** + modal (URL/iframe/copy/PNG); el botón **Expand** llama a `ChartJSCKAN.resize()` tras alternar y deja de togglear `.cj-expanded`. |
| `ckanext/chartjs/public/chartjs-app/chartjs-ckan.js` | **Modificar:** `init` tolera `configPanelEl === null` (modo embed read-only); agregar `downloadPNG()` (con fondo blanco) y `resize()`; exponerlos en `window.ChartJSCKAN`. |
| `ckanext/chartjs/public/chartjs-app/chartjs-ckan.css` | **Modificar:** estilos del modal de Share, estilos del embed standalone, y **arreglo real** de `.cj-wrapper.full-width` (breakout 100vw). |
| `README.md` | **Modificar:** documentar Share/Embed (iframe), Export PNG, límites (recursos privados / X-Frame-Options) y el arreglo de Expand. |

**Sin cambios en el modelo de datos.** No se agregan tablas, campos ni tokens. El embed usa
siempre `resource_view.chart_config` ya persistido.

---

## 3. Pasos en orden

1. **JS:** hacer `init()` tolerante a panel nulo (modo embed); agregar `downloadPNG()` (composición
   sobre canvas blanco) y `resize()`; exponer ambos.
2. **Backend:** helper `_resolve_view`; ruta `/chartjs/embed/<view_id>` → `toolkit.render('chartjs_embed.html', extra_vars)`.
3. **Template embed:** `chartjs_embed.html` standalone (canvas + scripts + CJ_CONFIG con `savedConfig`).
4. **Template vista:** botón **Share** + modal; `Expand` simplificado con `resize()`.
5. **CSS:** modal, embed, y `.full-width` real (100vw breakout).
6. **README:** uso, ejemplo de `<iframe>`, PNG y limitaciones.

---

## 4. Riesgos / decisiones clave

- **Recursos privados + iframe cross-site:** con `SameSite=Lax` (default), la cookie de sesión no
  viaja en subrequests de un iframe cross-site → el embed de recursos **privados** solo renderiza
  same-origin / con sesión. **Recursos públicos: OK en cualquier sitio.** Se documenta; no se
  resuelve con tokens en esta iteración (mantener simple).
- **X-Frame-Options / CSP `frame-ancestors`:** si el deployment/proxy los fija globalmente, el
  iframe externo puede bloquearse. No se sobreescriben headers globales acá; se documenta.
- **PNG client-side puro:** sin backend de render de imágenes (evita dependencias). Canvas "tainted"
  no es problema: los datos CSV no cargan imágenes externas en el gráfico.
- **Share usa solo config guardada:** el modal avisa explícitamente; no promete compartir cambios sin guardar.
- **Diferencias entre asesores:** Codex propuso *arreglar Expand* (bug verificable); DeepSeek propuso
  *auto-resize* (premisa parcial: `responsive` ya estaba activo). Elegimos **Expand** e incorporamos
  el `resize()` de DeepSeek como parte del arreglo. Las rutas de archivos las tomamos de la estructura
  real (DeepSeek adivinó paths inexistentes).

---

## 5. Cómo se verificará

- **Débil (automatizable aquí, sin instancia CKAN):** `python -m py_compile` de `api.py`/`plugin.py`
  y `node --check` del JS. Verifica sintaxis/compilación, **no comportamiento**.
- **Fuerte (requiere CKAN corriendo, manual):**
  1. Vista Chart.js sobre CSV público → configurar, guardar → aparecen **Share** y **PNG**.
  2. Abrir `/chartjs/embed/<view_id>` → solo el gráfico, sin editor ni Save.
  3. Pegar el snippet `<iframe>` en un HTML externo → carga (recurso público).
  4. Descargar PNG → fondo blanco, colores/leyenda OK.
  5. `Expand` → el gráfico ocupa el ancho real de la ventana; volver atrás OK; mobile OK.
  6. `404`/`403` del embed con `view_id` inexistente / recurso sin permiso.
- Se sugiere agregar `.mix/verify.sh` (py_compile + node --check) para una verificación repetible.

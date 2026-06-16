# Plan: Backlog priorizado de features — ckanext-chartjs

**Tarea:** revisar el plugin y proponer features/mejoras. Este documento es el **backlog**
(fuente de verdad, editable). Tras aprobar, se construye el/los increment(s) elegido(s).

**Baseline:** `main`. Nota: la rama `feat/share-embed-charts` (ya pusheada, sin mergear) agrega
share/embed por iframe, export PNG y el fix de "Expand". **No se reproponen esas.**

---

## Resumen del review (estado actual)

Capacidades en `main`: 7 tipos de gráfico, multi-series, agregaciones (sum/count/avg/min/max),
guardar/restaurar config en `resource_view.chart_config`, datos vía DataStore con fallback a CSV
directo, color por serie, opciones (legend/grid/stacked/beginAtZero), título y eje X.

Gaps detectados (código + asesores Codex/DeepSeek):
- **`filterable: True` declarado pero los filtros nunca se aplican** (bug: CKAN muestra UI de filtros que no hace nada).
- **CSV asume coma + UTF-8** (`csv.DictReader` default); los CSV con `;` (Excel es/EU) se parsean como 1 columna.
- **Categorías sin orden ni Top-N** → gráficos ilegibles con muchas categorías.
- **Fechas tratadas como categorías** (sin eje temporal ni orden cronológico).
- **Sin control de formato de números** (solo `toLocaleString`).
- **Empty/error states pobres**: si falta eje X o serie, el canvas queda en blanco sin mensaje.
- **`save_view_config` filtra errores internos** (`return ... str(e)` en 500) y solo valida JSON, no esquema.
- **Sin i18n** (~30 strings hardcodeados en inglés en el JS) ni accesibilidad (canvas sin alternativa textual).
- **Sin tests** (0).
- **Todo client-side**: `max_rows=50000` se descargan y agregan en el navegador (no escala).

---

## Backlog priorizado (impacto / esfuerzo)

> **ESTADO (2026-06-15): Tier A (A1–A5) IMPLEMENTADO en `main`** (sin commitear). Verificación: gate `.mix/verify.sh` PASS (estático + test de comportamiento del validador de config, 25/25). A1–A4 = estático + juicio; A5 = behaviorally tested. Falta prueba runtime en CKAN vivo. Tier B/C siguen pendientes.

### 🟢 Tier A — Quick wins (cliente + backend mínimo, bajo riesgo, verificable estático) ← ✅ HECHO
- **A1. Orden + Top-N + bucket "Otros"** — ordenar categorías por valor/nombre (asc/desc), limitar a Top/Bottom N, agrupar resto en "Otros". *Impacto: alto · Esfuerzo: S-M · JS (pipeline de datos) + UI.*
- **A2. Empty/error states accionables** — placeholder claro cuando falta eje X o serie; mensajes para "campo faltante / sin datos" en el área del gráfico. *Impacto: alto · Esfuerzo: S · JS + CSS.*
- **A3. Formato de números** — decimales, separador de miles, prefijo/sufijo (`%`,`$`) por serie; aplicado a ticks de eje + tooltips. *Impacto: alto · Esfuerzo: S-M · JS + UI.*
- **A4. Títulos de eje + barras horizontales** — texto de eje X/Y configurable; `indexAxis:'y'` para barras horizontales. *Impacto: medio · Esfuerzo: S · JS + UI.*
- **A5. Endurecer `save-config`** — dejar de devolver `str(e)` (loggear server-side, mensaje genérico) + validación por whitelist de campos de la config. *Impacto: alto (robustez/seguridad) · Esfuerzo: S · api.py.*

> **RUN Tier B (2026-06-15):** scope elegido = **B6 + B2 + B1** (núcleo backend verificable, alto ROI).
> Defer B3/B4/B5 (frontend/cross-cutting; B3 requiere bundlear date-adapter, B5 requiere test de render).
> **Arquitectura:** nuevo módulo `ckanext/chartjs/datautils.py` **sin dependencias de ckan/flask**
> (solo stdlib) con las funciones puras; `api.py` las importa. Tests con **pytest** (disponible) importan
> `datautils` directo → verificación **fuerte real** (flask/ckan NO son importables headless, por eso se
> extraen funciones puras). JS: export CommonJS condicional para testear helpers con node.
> **Increment 1:** B2 (encoding utf-8-sig→utf-8→latin-1, sniff delimitador `,`/`;`/tab, coerción por
> columna que preserva IDs con ceros tipo `00123`) + `tests/test_datautils.py` + JS tests de A1/A3 +
> `.mix/verify.sh` corre pytest/node.
> **Increment 2:** B1 (parse de filtros CKAN `field:value|...` → dict; aplicar igualdad nativa en
> `datastore_search` + post-parse en CSV; whitelist de campos contra metadata; sin SQL dinámico ni
> paths de usuario; frontend reenvía `filters` de la URL) + tests de filtros con payloads de inyección.
> **Seguridad (ambos asesores):** B1 → solo `datastore_search` parametrizado, validar nombres de campo
> contra el esquema, valores como literales (nunca `eval`/SQL). B2 → límite de bytes, sin path-traversal.
> **Límite documentado:** filtros post-carga sujetos a `max_rows` (en CSV); rangos numéricos/fecha quedan
> para después (Tier B soporta **igualdad**, el caso común del filtro de CKAN).

### 🟡 Tier B — Mejoras medianas
- **B1. Aplicar los filtros de CKAN** — ✅ HECHO (igualdad, post-carga, whitelist). Rangos numéricos/fecha y filtrado nativo de datastore = pendiente (futuro).
- **B2. Robustez CSV** — ✅ HECHO en `datautils.py` (sniff delimitador, encoding utf-8-sig/utf-8/latin-1, coerción por columna preservando IDs con ceros).
- **B3. Eje temporal** — detectar fechas, escala temporal de Chart.js, orden cronológico real y granularidad (auto/día/mes/año). *Impacto: alto · Esfuerzo: M-L.*
- **B4. i18n ES/EN** — ✅ HECHO. `plugin.py` `CJ_STRINGS` (es) + `_get_cj_i18n()` por locale; template inyecta `window.CJ_I18N` vía `tojson`; JS rutea ~61 strings por `t(key, fallback)`. ES funciona sin compilar `.mo` (migración a gettext/.po = follow-up).
- **B5. Accesibilidad (WCAG)** — ✅ HECHO. Tabla-fallback (función pura + DOM con `textContent`, sin XSS), `role=img`+`aria-label` en canvas, `aria-live`, paleta **Okabe-Ito** default, `:focus-visible`, `.cj-sr-only`. Tests node (incl. payloads XSS literales).
- **B6. Tests (pytest)** — ✅ HECHO (parcial). `tests/test_datautils.py` (20 tests: CSV+filtros) + `tests/chartjs-ckan.test.js` (node, helpers JS). Route tests de Flask NO posibles headless (ckan/flask no importables) → se extrajeron funciones puras. Pendiente: más cobertura si se agregan B3/B4/B5.

### 🔴 Tier C — Esfuerzo grande / arquitectónico
- **C1. Agregación server-side** — `datastore_search_sql` (parametrizado) para DataStore; agregación incremental en streaming para CSV. Reduce payload 2-3 órdenes de magnitud. *Impacto: alto · Esfuerzo: M-L · seguridad-sensible.*
- **C2. `chart_config` v2 + migración** — esquema versionado, normalización y migración v1→v2 sin romper vistas guardadas. *Impacto: alto · Esfuerzo: M.*
- **C3. Performance del editor** — debounce de inputs, no destruir/recrear el chart en cada cambio, cache de agregaciones. *Impacto: alto · Esfuerzo: M.*

---

## Riesgos / decisiones clave
- **Seguridad (DeepSeek):** si se agregan filtros/orden al endpoint de datos (B1/C1), **parametrizar** todo (usar `datastore_search`, no SQL concatenado), validar `resource_id` (uuid/alfanumérico) y usar `safe_join` para rutas CSV. No introducir SQLi/path-traversal.
- **Sin build step ni dependencias pesadas:** mantener ES5 vanilla + Flask blueprint. El eje temporal podría requerir el date-adapter de Chart.js (decidir: bundlear vs CDN).
- **Verificación:** este repo no tiene CKAN headless → la verificación automática es estática (py_compile + node --check + jinja parse) salvo que se agreguen tests (B6), que sí dan verificación fuerte. Comportamiento runtime = checklist manual en CKAN vivo.

## Cómo se verificará (del/los increment(s) elegido(s))
- Estático: `.mix/verify.sh` (py_compile + node --check + jinja parse).
- Si se elige **B6 (tests)**: `pytest` da verificación **fuerte** real.
- Manual en CKAN vivo: matriz recurso público/privado × DataStore/CSV × dataset chico/grande, según la feature.

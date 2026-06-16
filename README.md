# ckanext-chartjs

Interactive CSV data visualization for CKAN using [Chart.js](https://www.chartjs.org/).

This extension adds a **Chart.js** resource view type that lets users create beautiful, interactive charts from CSV data directly in CKAN.

## Features

- **7 chart types**: Bar, Line, Pie, Doughnut, Scatter, Radar, Polar Area
- **Interactive configuration**: Live preview as you configure axes, aggregation, and colors
- **Multi-series support**: Add multiple data series to a single chart
- **Aggregation methods**: Sum, Count, Average, Min, Max
- **Save & restore**: Chart configurations are saved and restored automatically
- **Lightweight**: ~70KB Chart.js from CDN + ~20KB app JS (vs multi-MB alternatives)
- **No build step**: Pure vanilla JavaScript, no React/Node/Vite required
- **Dual data source**: Reads from DataStore API first, falls back to direct CSV download

## Requirements

- CKAN >= 2.9
- Python >= 3.8

## Installation

1. Activate your CKAN virtual environment:

   ```bash
   source /usr/lib/ckan/default/bin/activate
   ```

2. Install the extension:

   ```bash
   pip install -e git+https://github.com/pabrojast/ckanext-chartjs.git#egg=ckanext-chartjs
   ```

   Or from a local directory:

   ```bash
   pip install -e /path/to/ckanext-chartjs
   ```

3. Add `chartjs` to the `ckan.plugins` setting in your CKAN config file:

   ```ini
   ckan.plugins = ... chartjs
   ```

4. Restart CKAN.

## Configuration

Optional settings in your CKAN config file:

```ini
# Default title for new Chart.js views (default: "Chart.js Explorer")
ckanext.chartjs.default_title = Chart.js Explorer

# Supported resource formats, comma-separated (default: csv)
ckanext.chartjs.formats = csv

# Maximum rows to load client-side (default: 50000)
ckanext.chartjs.max_rows = 50000
```

## Usage

1. Navigate to a CSV resource in your CKAN instance
2. Click **Manage** > **Views** > **Add view**
3. Select **Chart.js** from the view type dropdown
4. The chart will auto-render with default settings
5. Use the configuration panel on the left to:
   - Choose a chart type
   - Set a title
   - Select X-axis (category) field
   - Configure data series (Y-axis field, aggregation, color)
   - Add multiple series
   - Toggle options (legend, grid, stacked, etc.)
6. Click **Save** to persist your chart configuration

## Time axis (date fields)

When a chart's X-axis field holds full dates (e.g. `YYYY-MM-DD`), line, bar and
scatter charts can render a real **time axis** with chronological ordering. The
**Display → Time axis** control offers:

- **Auto** (default): a time scale is used automatically when the X field is a
  date column; otherwise the chart stays categorical.
- **On / Off**: force or disable the time scale.

**Time unit** (Auto / Day / Week / Month / Quarter / Year) controls the axis
tick granularity.

Dates without a time component are interpreted as UTC midnight for stable
chronological grouping. Values that cannot be parsed as dates are dropped from a
time-series chart.

The time scale needs Chart.js's date adapter, loaded from jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
```

For air-gapped deployments, self-host that file alongside `chart.umd.min.js`
(see *Air-gapped / Offline Environments*) and point the `<script src>` at your
local copy. If the adapter fails to load, charts fall back to a categorical axis.

## Air-gapped / Offline Environments

By default, Chart.js is loaded from the jsDelivr CDN. For environments without internet access:

1. Download Chart.js UMD bundle:
   ```bash
   curl -o ckanext/chartjs/public/chartjs-app/chart.umd.min.js \
     https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js
   ```

2. Edit `ckanext/chartjs/templates/chartjs_view.html` and change the script src:
   ```html
   <script src="/chartjs-app/chart.umd.min.js"></script>
   ```

## License

AGPL-3.0

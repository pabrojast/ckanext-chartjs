/**
 * Chart.js CKAN Extension - Frontend Application
 * Vanilla JS, no build step required.
 * Exposes: window.ChartJSCKAN = { init, getConfig, destroy }
 */
(function() {
  'use strict';

  // ============================================================
  // Module 1: State & Constants
  // ============================================================

  var DEFAULT_COLORS = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
    '#9966FF', '#FF9F40', '#C9CBCF', '#7BC8A4',
    '#E7517A', '#2EADD3', '#F0B723', '#58D68D',
    '#AF7AC5', '#F39C12', '#85C1E9', '#E74C3C'
  ];

  var CHART_TYPES = [
    { id: 'bar',       label: 'Bar' },
    { id: 'line',      label: 'Line' },
    { id: 'pie',       label: 'Pie' },
    { id: 'doughnut',  label: 'Doughnut' },
    { id: 'scatter',   label: 'Scatter' },
    { id: 'radar',     label: 'Radar' },
    { id: 'polarArea', label: 'Polar Area' },
  ];

  var AGGREGATIONS = [
    { id: 'sum',     label: 'Sum' },
    { id: 'count',   label: 'Count' },
    { id: 'average', label: 'Average' },
    { id: 'min',     label: 'Min' },
    { id: 'max',     label: 'Max' },
  ];

  var CHART_TYPE_ICONS = {
    bar: '<svg viewBox="0 0 24 24"><rect x="3" y="12" width="4" height="9" rx="1" fill="#4b5563"/><rect x="10" y="6" width="4" height="15" rx="1" fill="#4b5563"/><rect x="17" y="9" width="4" height="12" rx="1" fill="#4b5563"/></svg>',
    line: '<svg viewBox="0 0 24 24"><polyline points="3,17 8,11 13,14 21,5" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="3" cy="17" r="1.5" fill="#4b5563"/><circle cx="8" cy="11" r="1.5" fill="#4b5563"/><circle cx="13" cy="14" r="1.5" fill="#4b5563"/><circle cx="21" cy="5" r="1.5" fill="#4b5563"/></svg>',
    pie: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20z" fill="none" stroke="#4b5563" stroke-width="1.5"/><path d="M12 2a10 10 0 0 1 8.66 5L12 12z" fill="#4b5563"/></svg>',
    doughnut: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#4b5563" stroke-width="4"/><path d="M12 3a9 9 0 0 1 7.79 4.5" fill="none" stroke="#9ca3af" stroke-width="4" stroke-linecap="round"/></svg>',
    scatter: '<svg viewBox="0 0 24 24"><circle cx="5" cy="16" r="2" fill="#4b5563"/><circle cx="9" cy="10" r="2" fill="#4b5563"/><circle cx="14" cy="14" r="2" fill="#4b5563"/><circle cx="18" cy="7" r="2" fill="#4b5563"/><circle cx="12" cy="5" r="2" fill="#4b5563"/></svg>',
    radar: '<svg viewBox="0 0 24 24"><polygon points="12,3 20,9 18,18 6,18 4,9" fill="none" stroke="#4b5563" stroke-width="1.5"/><polygon points="12,7 17,11 15.5,16 8.5,16 7,11" fill="#4b5563" opacity="0.3"/></svg>',
    polarArea: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#4b5563" stroke-width="1.5"/><path d="M12 12L12 3A9 9 0 0 1 20.5 8.5Z" fill="#4b5563" opacity="0.5"/><path d="M12 12L20.5 8.5A9 9 0 0 1 20.5 15.5Z" fill="#4b5563" opacity="0.3"/></svg>',
  };

  var _state = {
    rawData: [],
    fields: [],
    chartInstance: null,
    configPanelEl: null,
    canvasEl: null,
    config: {
      version: 1,
      chartType: 'bar',
      title: '',
      xAxis: '',
      series: [],
      options: {
        showLegend: true,
        showGrid: true,
        stacked: false,
        beginAtZero: true,
      },
    },
  };

  // ============================================================
  // Module 2: Data Processing
  // ============================================================

  function groupBy(data, keyField) {
    var groups = {};
    var orderedKeys = [];
    for (var i = 0; i < data.length; i++) {
      var key = data[i][keyField];
      if (key === null || key === undefined) key = '';
      key = String(key);
      if (!(key in groups)) {
        groups[key] = [];
        orderedKeys.push(key);
      }
      groups[key].push(data[i]);
    }
    return { groups: groups, keys: orderedKeys };
  }

  function aggregate(values, method) {
    var nums = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === null || v === undefined || v === '') continue;
      var n = Number(v);
      if (!isNaN(n)) nums.push(n);
    }
    if (nums.length === 0) return 0;

    switch (method) {
      case 'sum':
        var s = 0;
        for (var j = 0; j < nums.length; j++) s += nums[j];
        return Math.round(s * 100) / 100;
      case 'count':
        return nums.length;
      case 'average':
        var total = 0;
        for (var j = 0; j < nums.length; j++) total += nums[j];
        return Math.round((total / nums.length) * 100) / 100;
      case 'min':
        return Math.min.apply(null, nums);
      case 'max':
        return Math.max.apply(null, nums);
      default:
        var s2 = 0;
        for (var j = 0; j < nums.length; j++) s2 += nums[j];
        return Math.round(s2 * 100) / 100;
    }
  }

  function aggregateData(rawData, xField, yField, method) {
    var grouped = groupBy(rawData, xField);
    var labels = grouped.keys;
    var values = [];
    for (var i = 0; i < labels.length; i++) {
      var groupRows = grouped.groups[labels[i]];
      var yValues = [];
      for (var j = 0; j < groupRows.length; j++) {
        yValues.push(groupRows[j][yField]);
      }
      values.push(aggregate(yValues, method));
    }
    return { labels: labels, values: values };
  }

  function buildScatterData(rawData, xField, yField) {
    var points = [];
    for (var i = 0; i < rawData.length; i++) {
      var xVal = Number(rawData[i][xField]);
      var yVal = Number(rawData[i][yField]);
      if (!isNaN(xVal) && !isNaN(yVal)) {
        points.push({ x: xVal, y: yVal });
      }
    }
    return points;
  }

  function inferBestDefaults(fields) {
    var xField = '';
    var yField = '';
    for (var i = 0; i < fields.length; i++) {
      if (!xField && (fields[i].semanticType === 'nominal' || fields[i].semanticType === 'temporal')) {
        xField = fields[i].fid;
      }
      if (!yField && fields[i].semanticType === 'quantitative') {
        yField = fields[i].fid;
      }
    }
    // Fallbacks
    if (!xField && fields.length > 0) xField = fields[0].fid;
    if (!yField && fields.length > 1) yField = fields[1].fid;
    if (!yField && fields.length > 0) yField = fields[0].fid;
    return { xField: xField, yField: yField };
  }

  // ============================================================
  // Module 3: Configuration UI Builder
  // ============================================================

  function buildConfigPanel(container, fields) {
    container.innerHTML = '';

    // -- Chart Type Section --
    var typeSection = createSection('Chart Type');
    var typeRow = el('div', 'cj-chart-types');
    CHART_TYPES.forEach(function(ct) {
      var btn = el('button', 'cj-chart-type-btn' + (_state.config.chartType === ct.id ? ' active' : ''));
      btn.title = ct.label;
      btn.innerHTML = CHART_TYPE_ICONS[ct.id] || '';
      btn.setAttribute('data-type', ct.id);
      btn.addEventListener('click', function() {
        _state.config.chartType = ct.id;
        updateChartTypeButtons();
        onConfigChange();
      });
      typeRow.appendChild(btn);
    });
    typeSection.appendChild(typeRow);
    container.appendChild(typeSection);

    // -- Title Section --
    var titleSection = createSection('Chart Title');
    var titleInput = el('input', 'cj-input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Enter chart title...';
    titleInput.value = _state.config.title || '';
    titleInput.id = 'cj-title-input';
    titleInput.addEventListener('input', function() {
      _state.config.title = this.value;
      onConfigChange();
    });
    titleSection.appendChild(titleInput);
    container.appendChild(titleSection);

    // -- X-Axis Section --
    var xSection = createSection('Category / X-Axis');
    var xSelect = createFieldSelect('cj-x-select', fields, _state.config.xAxis);
    xSelect.addEventListener('change', function() {
      _state.config.xAxis = this.value;
      onConfigChange();
    });
    xSection.appendChild(xSelect);
    container.appendChild(xSection);

    // -- Series Section --
    var seriesSection = createSection('Data Series');
    var seriesContainer = el('div', '');
    seriesContainer.id = 'cj-series-container';
    seriesSection.appendChild(seriesContainer);
    renderSeriesCards(seriesContainer, fields);

    var addBtn = el('button', 'cj-add-series-btn');
    addBtn.textContent = '+ Add Series';
    addBtn.addEventListener('click', function() {
      var nextColor = DEFAULT_COLORS[_state.config.series.length % DEFAULT_COLORS.length];
      var nextField = '';
      // Pick first unused quantitative field
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].semanticType === 'quantitative') {
          var used = false;
          for (var j = 0; j < _state.config.series.length; j++) {
            if (_state.config.series[j].yField === fields[i].fid) { used = true; break; }
          }
          if (!used) { nextField = fields[i].fid; break; }
        }
      }
      if (!nextField && fields.length > 0) nextField = fields[0].fid;
      _state.config.series.push({
        yField: nextField,
        label: nextField,
        aggregation: 'sum',
        color: nextColor,
      });
      renderSeriesCards(document.getElementById('cj-series-container'), fields);
      onConfigChange();
    });
    seriesSection.appendChild(addBtn);
    container.appendChild(seriesSection);

    // -- Options Section --
    var optSection = createSection('');
    var optToggle = el('div', 'cj-options-toggle');
    optToggle.innerHTML = '<span class="cj-config-section-title" style="margin-bottom:0;">Options</span><span class="cj-options-toggle-icon">&#9654;</span>';
    var optContent = el('div', 'cj-options-content');

    optToggle.addEventListener('click', function() {
      var icon = optToggle.querySelector('.cj-options-toggle-icon');
      optContent.classList.toggle('open');
      icon.classList.toggle('open');
    });

    optContent.appendChild(createCheckbox('cj-opt-legend', 'Show Legend', _state.config.options.showLegend, function(v) {
      _state.config.options.showLegend = v; onConfigChange();
    }));
    optContent.appendChild(createCheckbox('cj-opt-grid', 'Show Grid Lines', _state.config.options.showGrid, function(v) {
      _state.config.options.showGrid = v; onConfigChange();
    }));
    optContent.appendChild(createCheckbox('cj-opt-stacked', 'Stacked', _state.config.options.stacked, function(v) {
      _state.config.options.stacked = v; onConfigChange();
    }));
    optContent.appendChild(createCheckbox('cj-opt-zero', 'Begin at Zero', _state.config.options.beginAtZero, function(v) {
      _state.config.options.beginAtZero = v; onConfigChange();
    }));

    optSection.appendChild(optToggle);
    optSection.appendChild(optContent);
    container.appendChild(optSection);
  }

  function renderSeriesCards(container, fields) {
    container.innerHTML = '';
    _state.config.series.forEach(function(series, idx) {
      var card = el('div', 'cj-series-card');

      // Header
      var header = el('div', 'cj-series-card-header');
      var title = el('span', 'cj-series-card-title');
      title.textContent = 'Series ' + (idx + 1);
      header.appendChild(title);

      if (_state.config.series.length > 1) {
        var removeBtn = el('button', 'cj-series-remove-btn');
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Remove series';
        removeBtn.setAttribute('data-idx', idx);
        removeBtn.addEventListener('click', function() {
          var i = parseInt(this.getAttribute('data-idx'));
          _state.config.series.splice(i, 1);
          renderSeriesCards(container, fields);
          onConfigChange();
        });
        header.appendChild(removeBtn);
      }
      card.appendChild(header);

      // Y-Field
      var yFieldDiv = el('div', 'cj-series-field');
      var yLabel = el('label', 'cj-label');
      yLabel.textContent = 'Value (Y-Axis)';
      var ySelect = createFieldSelect('cj-series-y-' + idx, fields, series.yField);
      ySelect.setAttribute('data-idx', idx);
      ySelect.addEventListener('change', function() {
        var i = parseInt(this.getAttribute('data-idx'));
        _state.config.series[i].yField = this.value;
        _state.config.series[i].label = this.value;
        onConfigChange();
      });
      yFieldDiv.appendChild(yLabel);
      yFieldDiv.appendChild(ySelect);
      card.appendChild(yFieldDiv);

      // Aggregation
      var aggDiv = el('div', 'cj-series-field');
      var aggLabel = el('label', 'cj-label');
      aggLabel.textContent = 'Aggregation';
      var aggSelect = el('select', 'cj-select');
      aggSelect.id = 'cj-series-agg-' + idx;
      AGGREGATIONS.forEach(function(agg) {
        var opt = document.createElement('option');
        opt.value = agg.id;
        opt.textContent = agg.label;
        if (series.aggregation === agg.id) opt.selected = true;
        aggSelect.appendChild(opt);
      });
      aggSelect.setAttribute('data-idx', idx);
      aggSelect.addEventListener('change', function() {
        var i = parseInt(this.getAttribute('data-idx'));
        _state.config.series[i].aggregation = this.value;
        onConfigChange();
      });
      aggDiv.appendChild(aggLabel);
      aggDiv.appendChild(aggSelect);
      card.appendChild(aggDiv);

      // Color
      var colorDiv = el('div', 'cj-series-field');
      var colorLabel = el('label', 'cj-label');
      colorLabel.textContent = 'Color';
      var colorRow = el('div', 'cj-series-color-row');
      var colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'cj-color-input';
      colorInput.value = series.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
      colorInput.setAttribute('data-idx', idx);
      colorInput.addEventListener('input', function() {
        var i = parseInt(this.getAttribute('data-idx'));
        _state.config.series[i].color = this.value;
        onConfigChange();
      });
      var colorHex = el('span', 'cj-label');
      colorHex.textContent = series.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
      colorHex.style.fontSize = '11px';
      colorHex.style.color = '#9ca3af';
      colorRow.appendChild(colorInput);
      colorRow.appendChild(colorHex);
      colorDiv.appendChild(colorLabel);
      colorDiv.appendChild(colorRow);
      card.appendChild(colorDiv);

      container.appendChild(card);
    });
  }

  function updateChartTypeButtons() {
    var btns = document.querySelectorAll('.cj-chart-type-btn');
    btns.forEach(function(btn) {
      if (btn.getAttribute('data-type') === _state.config.chartType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // --- UI Helpers ---

  function el(tag, className) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function createSection(title) {
    var section = el('div', 'cj-config-section');
    if (title) {
      var t = el('div', 'cj-config-section-title');
      t.textContent = title;
      section.appendChild(t);
    }
    return section;
  }

  function createFieldSelect(id, fields, selectedValue) {
    var select = el('select', 'cj-select');
    select.id = id;
    fields.forEach(function(f) {
      var opt = document.createElement('option');
      opt.value = f.fid;
      opt.textContent = f.name;
      if (f.fid === selectedValue) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }

  function createCheckbox(id, label, checked, onChange) {
    var row = el('div', 'cj-checkbox-row');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = checked;
    cb.addEventListener('change', function() { onChange(this.checked); });
    var lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = label;
    row.appendChild(cb);
    row.appendChild(lbl);
    return row;
  }

  // ============================================================
  // Module 4: Chart Renderer
  // ============================================================

  function onConfigChange() {
    renderChart();
  }

  function renderChart() {
    if (!_state.canvasEl || _state.rawData.length === 0) return;

    // Destroy existing chart
    if (_state.chartInstance) {
      _state.chartInstance.destroy();
      _state.chartInstance = null;
    }

    var config = _state.config;
    var chartType = config.chartType;
    var rawData = _state.rawData;
    var xAxis = config.xAxis;
    var series = config.series;
    var opts = config.options;

    if (!xAxis || series.length === 0) return;

    var chartData = {};
    var chartOptions = buildChartOptions(config);

    if (chartType === 'scatter') {
      chartData = buildScatterChartData(rawData, series);
    } else if (chartType === 'pie' || chartType === 'doughnut' || chartType === 'polarArea') {
      chartData = buildPieChartData(rawData, xAxis, series);
    } else {
      chartData = buildStandardChartData(rawData, xAxis, series);
    }

    var ctx = _state.canvasEl.getContext('2d');
    _state.chartInstance = new Chart(ctx, {
      type: chartType,
      data: chartData,
      options: chartOptions,
    });
  }

  function buildStandardChartData(rawData, xAxis, series) {
    var datasets = [];
    var labels = null;

    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      var result = aggregateData(rawData, xAxis, s.yField, s.aggregation);
      if (!labels) labels = result.labels;

      datasets.push({
        label: s.label || s.yField,
        data: result.values,
        backgroundColor: hexToRgba(s.color, 0.7),
        borderColor: s.color,
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        pointBackgroundColor: s.color,
        pointRadius: 3,
      });
    }

    return { labels: labels || [], datasets: datasets };
  }

  function buildPieChartData(rawData, xAxis, series) {
    // Use first series for pie charts
    var s = series[0];
    var result = aggregateData(rawData, xAxis, s.yField, s.aggregation);
    var bgColors = [];
    for (var i = 0; i < result.labels.length; i++) {
      bgColors.push(DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
    }

    return {
      labels: result.labels,
      datasets: [{
        label: s.label || s.yField,
        data: result.values,
        backgroundColor: bgColors,
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    };
  }

  function buildScatterChartData(rawData, series) {
    var datasets = [];
    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      var xField = _state.config.xAxis;
      var points = buildScatterData(rawData, xField, s.yField);
      datasets.push({
        label: s.label || s.yField,
        data: points,
        backgroundColor: hexToRgba(s.color, 0.6),
        borderColor: s.color,
        pointRadius: 4,
        pointHoverRadius: 6,
      });
    }
    return { datasets: datasets };
  }

  function buildChartOptions(config) {
    var opts = config.options;
    var chartType = config.chartType;
    var isPie = chartType === 'pie' || chartType === 'doughnut' || chartType === 'polarArea';

    var options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: opts.showLegend,
          position: 'top',
          labels: {
            font: { size: 12, family: "'Inter', -apple-system, sans-serif" },
            padding: 16,
            usePointStyle: true,
          },
        },
        title: {
          display: !!config.title,
          text: config.title || '',
          font: { size: 16, weight: '600', family: "'Inter', -apple-system, sans-serif" },
          padding: { bottom: 16 },
          color: '#1f2937',
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.9)',
          titleFont: { size: 13 },
          bodyFont: { size: 12 },
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              var label = context.dataset.label || '';
              var value = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
              if (typeof value === 'number') {
                value = value.toLocaleString();
              }
              return label + ': ' + value;
            },
          },
        },
      },
      animation: {
        duration: 400,
        easing: 'easeOutQuart',
      },
    };

    if (!isPie) {
      options.scales = {
        x: {
          display: true,
          grid: { display: opts.showGrid, color: 'rgba(0,0,0,0.05)' },
          stacked: opts.stacked,
          ticks: {
            font: { size: 11 },
            color: '#6b7280',
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 30,
          },
        },
        y: {
          display: true,
          grid: { display: opts.showGrid, color: 'rgba(0,0,0,0.05)' },
          stacked: opts.stacked,
          beginAtZero: opts.beginAtZero,
          ticks: {
            font: { size: 11 },
            color: '#6b7280',
            callback: function(value) {
              if (typeof value === 'number') return value.toLocaleString();
              return value;
            },
          },
        },
      };
    }

    return options;
  }

  function hexToRgba(hex, alpha) {
    if (!hex || hex.charAt(0) !== '#') return hex;
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ============================================================
  // Module 5: Save / Load / Init
  // ============================================================

  function getConfig() {
    return JSON.parse(JSON.stringify(_state.config));
  }

  function loadConfig(saved) {
    if (!saved || typeof saved !== 'object') return;

    _state.config.chartType = saved.chartType || 'bar';
    _state.config.title = saved.title || '';
    _state.config.xAxis = saved.xAxis || '';

    if (Array.isArray(saved.series) && saved.series.length > 0) {
      _state.config.series = saved.series.map(function(s, i) {
        return {
          yField: s.yField || '',
          label: s.label || s.yField || '',
          aggregation: s.aggregation || 'sum',
          color: s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        };
      });
    }

    if (saved.options && typeof saved.options === 'object') {
      _state.config.options.showLegend = saved.options.showLegend !== false;
      _state.config.options.showGrid = saved.options.showGrid !== false;
      _state.config.options.stacked = !!saved.options.stacked;
      _state.config.options.beginAtZero = saved.options.beginAtZero !== false;
    }
  }

  function restoreUIFromConfig(fields) {
    // Update chart type buttons
    updateChartTypeButtons();

    // Update title input
    var titleInput = document.getElementById('cj-title-input');
    if (titleInput) titleInput.value = _state.config.title || '';

    // Update X-axis select
    var xSelect = document.getElementById('cj-x-select');
    if (xSelect) xSelect.value = _state.config.xAxis || '';

    // Rebuild series cards
    var seriesContainer = document.getElementById('cj-series-container');
    if (seriesContainer) renderSeriesCards(seriesContainer, fields);

    // Update checkboxes
    var optLegend = document.getElementById('cj-opt-legend');
    if (optLegend) optLegend.checked = _state.config.options.showLegend;
    var optGrid = document.getElementById('cj-opt-grid');
    if (optGrid) optGrid.checked = _state.config.options.showGrid;
    var optStacked = document.getElementById('cj-opt-stacked');
    if (optStacked) optStacked.checked = _state.config.options.stacked;
    var optZero = document.getElementById('cj-opt-zero');
    if (optZero) optZero.checked = _state.config.options.beginAtZero;
  }

  function init(configPanelEl, canvasEl, data, fields, savedConfig) {
    _state.rawData = data;
    _state.fields = fields;
    _state.configPanelEl = configPanelEl;
    _state.canvasEl = canvasEl;

    // Set defaults from field metadata
    var defaults = inferBestDefaults(fields);

    _state.config.xAxis = defaults.xField;
    _state.config.series = [{
      yField: defaults.yField,
      label: defaults.yField,
      aggregation: 'sum',
      color: DEFAULT_COLORS[0],
    }];

    // Embed/read-only mode passes a null config panel: skip all editor DOM.
    var editable = !!configPanelEl;
    if (editable) {
      buildConfigPanel(configPanelEl, fields);
    }

    // If saved config, restore it
    if (savedConfig) {
      loadConfig(savedConfig);
      if (editable) restoreUIFromConfig(fields);
    }

    // Initial render
    renderChart();
  }

  function resize() {
    if (_state.chartInstance) _state.chartInstance.resize();
  }

  function downloadPNG(filenameBase) {
    if (!_state.chartInstance || !_state.canvasEl) return false;
    var src = _state.canvasEl;
    // Composite onto a white background: the Chart.js canvas is transparent,
    // which produces an ugly PNG on dark surfaces.
    var tmp = document.createElement('canvas');
    tmp.width = src.width;
    tmp.height = src.height;
    var ctx = tmp.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(src, 0, 0);

    var url;
    try {
      url = tmp.toDataURL('image/png');
    } catch (e) {
      return false;
    }

    var name = (filenameBase || 'chart')
      .replace(/[^a-z0-9_-]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'chart';

    var a = document.createElement('a');
    a.href = url;
    a.download = name + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  }

  function destroy() {
    if (_state.chartInstance) {
      _state.chartInstance.destroy();
      _state.chartInstance = null;
    }
    _state.rawData = [];
    _state.fields = [];
  }

  // ============================================================
  // Expose Public API
  // ============================================================

  window.ChartJSCKAN = {
    init: init,
    getConfig: getConfig,
    destroy: destroy,
    downloadPNG: downloadPNG,
    resize: resize,
  };

})();

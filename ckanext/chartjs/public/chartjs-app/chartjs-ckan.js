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
    '#E69F00', '#56B4E9', '#009E73', '#F0E442',
    '#0072B2', '#D55E00', '#CC79A7', '#999999'
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

  // Translation lookup: reads window.CJ_I18N if present (populated in B4),
  // else returns the English fallback. Safe to call headless (returns fallback).
  function t(key, fallback) {
    try {
      if (typeof window !== 'undefined' && window.CJ_I18N && window.CJ_I18N[key]) {
        return window.CJ_I18N[key];
      }
    } catch (e) {}
    return fallback;
  }

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
        categorySort: 'none',
        topN: 0,
        showOthers: false,
        othersLabel: 'Others',
        xAxisTitle: '',
        yAxisTitle: '',
        horizontalBars: false,
        numberFormat: {
          decimalsMode: 'auto',
          decimals: 2,
          useThousands: true,
          prefix: '',
          suffix: '',
        },
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

  // Build one aligned row per category label, with each series' aggregated value.
  // All series aggregate the same rawData by the same xField, so the label order
  // is identical across series and values align by index.
  function buildAlignedAggregatedRows(rawData, xField, series) {
    var labels = null;
    var perSeriesValues = [];
    for (var i = 0; i < series.length; i++) {
      var res = aggregateData(rawData, xField, series[i].yField, series[i].aggregation);
      if (!labels) labels = res.labels;
      perSeriesValues.push(res.values);
    }
    labels = labels || [];
    var rows = [];
    for (var r = 0; r < labels.length; r++) {
      var values = [];
      for (var s = 0; s < perSeriesValues.length; s++) {
        values.push(perSeriesValues[s][r]);
      }
      rows.push({ label: labels[r], values: values });
    }
    return rows;
  }

  function rowTotal(row) {
    var t = 0;
    for (var i = 0; i < row.values.length; i++) {
      var n = Number(row.values[i]);
      if (!isNaN(n)) t += n;
    }
    return t;
  }

  // Whitelisted sort modes only (no dynamic code). Value sort uses the sum across
  // all series; ties broken by label asc for stable output.
  function sortAggregatedRows(rows, mode) {
    var out = rows.slice();
    if (mode === 'value_desc') {
      out.sort(function(a, b) {
        var d = rowTotal(b) - rowTotal(a);
        return d !== 0 ? d : String(a.label).localeCompare(String(b.label));
      });
    } else if (mode === 'value_asc') {
      out.sort(function(a, b) {
        var d = rowTotal(a) - rowTotal(b);
        return d !== 0 ? d : String(a.label).localeCompare(String(b.label));
      });
    } else if (mode === 'label_asc') {
      out.sort(function(a, b) { return String(a.label).localeCompare(String(b.label)); });
    } else if (mode === 'label_desc') {
      out.sort(function(a, b) { return String(b.label).localeCompare(String(a.label)); });
    }
    return out; // 'none'/unknown keeps order
  }

  // Keep the top-N rows by total (desc); collapse the rest into one "Others" row
  // that sums each series column. Selection is by total so "top" is meaningful
  // regardless of the display sort. Single pass over rows.
  function applyTopNAndOthers(rows, topN, showOthers, othersLabel) {
    var n = parseInt(topN, 10);
    if (isNaN(n) || n <= 0 || rows.length <= n) {
      return rows;
    }
    var ranked = rows.slice().sort(function(a, b) { return rowTotal(b) - rowTotal(a); });
    var keepSet = {};
    for (var i = 0; i < n && i < ranked.length; i++) {
      keepSet[ranked[i].label] = true;
    }
    var kept = [];
    var othersValues = null;
    for (var r = 0; r < rows.length; r++) {
      if (keepSet[rows[r].label]) {
        kept.push(rows[r]);
      } else if (showOthers) {
        if (!othersValues) {
          othersValues = [];
          for (var s = 0; s < rows[r].values.length; s++) othersValues.push(0);
        }
        for (var s2 = 0; s2 < rows[r].values.length; s2++) {
          var v = Number(rows[r].values[s2]);
          if (!isNaN(v)) othersValues[s2] += v;
        }
      }
    }
    if (showOthers && othersValues) {
      for (var s3 = 0; s3 < othersValues.length; s3++) {
        othersValues[s3] = Math.round(othersValues[s3] * 100) / 100;
      }
      kept.push({ label: othersLabel || 'Others', values: othersValues });
    }
    return kept;
  }

  // Full category pipeline: aggregate -> sort -> topN/Others. Returns aligned rows.
  function buildCategoryRows(rawData, xField, series, opts) {
    opts = opts || {};
    var rows = buildAlignedAggregatedRows(rawData, xField, series);
    rows = sortAggregatedRows(rows, opts.categorySort || 'none');
    rows = applyTopNAndOthers(rows, opts.topN, opts.showOthers, opts.othersLabel);
    return rows;
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
    var typeSection = createSection(t('ui.chartType', 'Chart Type'));
    var typeRow = el('div', 'cj-chart-types');
    CHART_TYPES.forEach(function(ct) {
      var btn = el('button', 'cj-chart-type-btn' + (_state.config.chartType === ct.id ? ' active' : ''));
      btn.title = t('chart.' + ct.id, ct.label);
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
    var titleSection = createSection(t('ui.title', 'Chart Title'));
    var titleInput = el('input', 'cj-input');
    titleInput.type = 'text';
    titleInput.placeholder = t('ui.titlePlaceholder', 'Enter chart title...');
    titleInput.value = _state.config.title || '';
    titleInput.id = 'cj-title-input';
    titleInput.addEventListener('input', function() {
      _state.config.title = this.value;
      onConfigChange();
    });
    titleSection.appendChild(titleInput);
    container.appendChild(titleSection);

    // -- X-Axis Section --
    var xSection = createSection(t('ui.xAxis', 'Category / X-Axis'));
    var xSelect = createFieldSelect('cj-x-select', fields, _state.config.xAxis);
    xSelect.addEventListener('change', function() {
      _state.config.xAxis = this.value;
      onConfigChange();
    });
    xSection.appendChild(xSelect);
    container.appendChild(xSection);

    // -- Series Section --
    var seriesSection = createSection(t('ui.series', 'Data Series'));
    var seriesContainer = el('div', '');
    seriesContainer.id = 'cj-series-container';
    seriesSection.appendChild(seriesContainer);
    renderSeriesCards(seriesContainer, fields);

    var addBtn = el('button', 'cj-add-series-btn');
    addBtn.textContent = t('ui.addSeries', '+ Add Series');
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
    optToggle.innerHTML = '<span class="cj-config-section-title" style="margin-bottom:0;">' + t('ui.options', 'Options') + '</span><span class="cj-options-toggle-icon">&#9654;</span>';
    var optContent = el('div', 'cj-options-content');

    optToggle.addEventListener('click', function() {
      var icon = optToggle.querySelector('.cj-options-toggle-icon');
      optContent.classList.toggle('open');
      icon.classList.toggle('open');
    });

    optContent.appendChild(createCheckbox('cj-opt-legend', t('opt.showLegend', 'Show Legend'), _state.config.options.showLegend, function(v) {
      _state.config.options.showLegend = v; onConfigChange();
    }));
    optContent.appendChild(createCheckbox('cj-opt-grid', t('opt.showGrid', 'Show Grid Lines'), _state.config.options.showGrid, function(v) {
      _state.config.options.showGrid = v; onConfigChange();
    }));
    optContent.appendChild(createCheckbox('cj-opt-stacked', t('opt.stacked', 'Stacked'), _state.config.options.stacked, function(v) {
      _state.config.options.stacked = v; onConfigChange();
    }));
    optContent.appendChild(createCheckbox('cj-opt-zero', t('opt.beginAtZero', 'Begin at Zero'), _state.config.options.beginAtZero, function(v) {
      _state.config.options.beginAtZero = v; onConfigChange();
    }));

    optSection.appendChild(optToggle);
    optSection.appendChild(optContent);
    container.appendChild(optSection);

    // -- Display Section (collapsible) --
    var dispSection = createSection('');
    var dispToggle = el('div', 'cj-options-toggle');
    dispToggle.innerHTML = '<span class="cj-config-section-title" style="margin-bottom:0;">' + t('ui.display', 'Display') + '</span><span class="cj-options-toggle-icon">&#9654;</span>';
    var dispContent = el('div', 'cj-options-content');

    dispToggle.addEventListener('click', function() {
      var icon = dispToggle.querySelector('.cj-options-toggle-icon');
      dispContent.classList.toggle('open');
      icon.classList.toggle('open');
    });

    var sortCtl = createLabeledSelect(t('opt.categoryOrder', 'Category order'), [
      { id: 'none',       label: t('sort.none', 'Original') },
      { id: 'value_desc', label: t('sort.value_desc', 'Value (high → low)') },
      { id: 'value_asc',  label: t('sort.value_asc', 'Value (low → high)') },
      { id: 'label_asc',  label: t('sort.label_asc', 'Label (A → Z)') },
      { id: 'label_desc', label: t('sort.label_desc', 'Label (Z → A)') },
    ], _state.config.options.categorySort, function(v) {
      _state.config.options.categorySort = v; onConfigChange();
    });
    sortCtl.control.id = 'cj-opt-sort';
    dispContent.appendChild(sortCtl.row);

    var topnCtl = createLabeledInput(t('opt.topN', 'Top N categories (0 = all)'), 'number', _state.config.options.topN || 0, function(v) {
      var n = parseInt(v, 10);
      if (isNaN(n) || n < 0) n = 0;
      if (n > 100) n = 100;
      _state.config.options.topN = n; onConfigChange();
    });
    topnCtl.control.id = 'cj-opt-topn';
    dispContent.appendChild(topnCtl.row);

    dispContent.appendChild(createCheckbox('cj-opt-others', t('opt.groupOthers', 'Group remainder as "Others"'), _state.config.options.showOthers, function(v) {
      _state.config.options.showOthers = v; onConfigChange();
    }));

    var othersLblCtl = createLabeledInput(t('opt.othersLabel', 'Others label'), 'text', _state.config.options.othersLabel || 'Others', function(v) {
      _state.config.options.othersLabel = v; onConfigChange();
    });
    othersLblCtl.control.id = 'cj-opt-others-label';
    dispContent.appendChild(othersLblCtl.row);

    var xTitleCtl = createLabeledInput(t('opt.xAxisTitle', 'X-axis title'), 'text', _state.config.options.xAxisTitle || '', function(v) {
      _state.config.options.xAxisTitle = v; onConfigChange();
    });
    xTitleCtl.control.id = 'cj-opt-xtitle';
    dispContent.appendChild(xTitleCtl.row);

    var yTitleCtl = createLabeledInput(t('opt.yAxisTitle', 'Y-axis title'), 'text', _state.config.options.yAxisTitle || '', function(v) {
      _state.config.options.yAxisTitle = v; onConfigChange();
    });
    yTitleCtl.control.id = 'cj-opt-ytitle';
    dispContent.appendChild(yTitleCtl.row);

    dispContent.appendChild(createCheckbox('cj-opt-hbars', t('opt.horizontalBars', 'Horizontal bars (bar chart)'), _state.config.options.horizontalBars, function(v) {
      _state.config.options.horizontalBars = v; onConfigChange();
    }));

    var nf = _state.config.options.numberFormat;

    var decModeCtl = createLabeledSelect(t('opt.numberDecimals', 'Number decimals'), [
      { id: 'auto',  label: t('fmt.auto', 'Auto') },
      { id: 'fixed', label: t('fmt.fixed', 'Fixed') },
    ], nf.decimalsMode, function(v) {
      _state.config.options.numberFormat.decimalsMode = v; onConfigChange();
    });
    decModeCtl.control.id = 'cj-opt-decmode';
    dispContent.appendChild(decModeCtl.row);

    var decCtl = createLabeledInput(t('opt.decimalPlaces', 'Decimal places'), 'number', nf.decimals, function(v) {
      var n = parseInt(v, 10);
      if (isNaN(n) || n < 0) n = 0;
      if (n > 6) n = 6;
      _state.config.options.numberFormat.decimals = n; onConfigChange();
    });
    decCtl.control.id = 'cj-opt-decimals';
    decCtl.control.max = '6';
    dispContent.appendChild(decCtl.row);

    dispContent.appendChild(createCheckbox('cj-opt-thousands', t('opt.thousands', 'Thousands separator'), nf.useThousands, function(v) {
      _state.config.options.numberFormat.useThousands = v; onConfigChange();
    }));

    var prefixCtl = createLabeledInput(t('opt.prefix', 'Value prefix'), 'text', nf.prefix, function(v) {
      _state.config.options.numberFormat.prefix = v; onConfigChange();
    });
    prefixCtl.control.id = 'cj-opt-prefix';
    dispContent.appendChild(prefixCtl.row);

    var suffixCtl = createLabeledInput(t('opt.suffix', 'Value suffix'), 'text', nf.suffix, function(v) {
      _state.config.options.numberFormat.suffix = v; onConfigChange();
    });
    suffixCtl.control.id = 'cj-opt-suffix';
    dispContent.appendChild(suffixCtl.row);

    dispSection.appendChild(dispToggle);
    dispSection.appendChild(dispContent);
    container.appendChild(dispSection);
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
      yLabel.textContent = t('ui.value', 'Value (Y-Axis)');
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
      aggLabel.textContent = t('ui.aggregation', 'Aggregation');
      var aggSelect = el('select', 'cj-select');
      aggSelect.id = 'cj-series-agg-' + idx;
      AGGREGATIONS.forEach(function(agg) {
        var opt = document.createElement('option');
        opt.value = agg.id;
        opt.textContent = t('agg.' + agg.id, agg.label);
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
      colorLabel.textContent = t('ui.color', 'Color');
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

  function createLabeledSelect(label, options, selected, onChange) {
    var wrap = el('div', 'cj-series-field');
    var lbl = el('label', 'cj-label');
    lbl.textContent = label;
    var select = el('select', 'cj-select');
    options.forEach(function(o) {
      var opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      if (o.id === selected) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function() { onChange(this.value); });
    wrap.appendChild(lbl);
    wrap.appendChild(select);
    return { row: wrap, control: select };
  }

  function createLabeledInput(label, type, value, onChange) {
    var wrap = el('div', 'cj-series-field');
    var lbl = el('label', 'cj-label');
    lbl.textContent = label;
    var input = el('input', 'cj-input');
    input.type = type;
    if (type === 'number') { input.min = '0'; input.max = '100'; input.step = '1'; }
    input.value = (value === null || value === undefined) ? '' : value;
    input.addEventListener('input', function() { onChange(this.value); });
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    return { row: wrap, control: input };
  }

  // ============================================================
  // Module 4: Chart Renderer
  // ============================================================

  function onConfigChange() {
    renderChart();
  }

  function getRenderState(config) {
    if (!config.xAxis) {
      return { ok: false, message: t('msg.selectX', 'Select a category (X-axis) field to build the chart.') };
    }
    if (!config.series || config.series.length === 0) {
      return { ok: false, message: t('msg.addSeries', 'Add at least one data series (Y-axis) to build the chart.') };
    }
    for (var i = 0; i < config.series.length; i++) {
      if (!config.series[i].yField) {
        return { ok: false, message: t('msg.seriesYField', 'Each data series needs a value (Y-axis) field.') };
      }
    }
    return { ok: true };
  }

  function chartHasData(chartData) {
    if (!chartData || !chartData.datasets || chartData.datasets.length === 0) return false;
    for (var i = 0; i < chartData.datasets.length; i++) {
      var d = chartData.datasets[i].data;
      if (d && d.length > 0) return true;
    }
    return false;
  }

  function ensureEmptyStateEl() {
    if (!_state.canvasEl) return null;
    var area = _state.canvasEl.parentNode;
    if (!area) return null;
    var elc = area.querySelector('.cj-chart-empty');
    if (!elc) {
      elc = document.createElement('div');
      elc.className = 'cj-chart-empty';
      area.appendChild(elc);
    }
    return elc;
  }

  function showChartEmpty(message) {
    if (_state.chartInstance) { _state.chartInstance.destroy(); _state.chartInstance = null; }
    var elc = ensureEmptyStateEl();
    if (elc) { elc.textContent = message; elc.style.display = 'flex'; }
    if (_state.canvasEl) _state.canvasEl.style.display = 'none';
    var a11y = ensureA11yNodes();
    if (a11y) {
      renderA11yTable(a11y.table, { caption: message, headers: [], rows: [] });
      a11y.live.textContent = message;
    }
    if (_state.canvasEl) _state.canvasEl.setAttribute('aria-label', message);
  }

  function hideChartEmpty() {
    var elc = ensureEmptyStateEl();
    if (elc) elc.style.display = 'none';
    if (_state.canvasEl) _state.canvasEl.style.display = '';
  }

  // Pure: build an accessible data-table MODEL (structure, never HTML). The DOM
  // renderer inserts these strings via textContent, so values are always literal.
  function buildAccessibleTableModel(chartData, config, tr) {
    tr = tr || function (k, f) { return f; };
    var model = { caption: '', headers: [], rows: [] };
    if (!chartData || !chartData.datasets || chartData.datasets.length === 0) {
      model.caption = tr('a11y.table.empty', 'No data to display');
      return model;
    }
    model.caption = config.title || tr('a11y.table.caption', 'Chart data');

    if (config.chartType === 'scatter') {
      model.headers = [tr('a11y.col.series', 'Series'), 'X', 'Y'];
      for (var i = 0; i < chartData.datasets.length; i++) {
        var ds = chartData.datasets[i];
        var label = ds.label || ('Series ' + (i + 1));
        var pts = ds.data || [];
        for (var p = 0; p < pts.length; p++) {
          model.rows.push([label, String(pts[p].x), String(pts[p].y)]);
        }
      }
      return model;
    }

    var labels = chartData.labels || [];
    model.headers = [tr('a11y.col.category', 'Category')];
    for (var d = 0; d < chartData.datasets.length; d++) {
      model.headers.push(chartData.datasets[d].label || ('Series ' + (d + 1)));
    }
    for (var r = 0; r < labels.length; r++) {
      var row = [String(labels[r])];
      for (var d2 = 0; d2 < chartData.datasets.length; d2++) {
        var v = chartData.datasets[d2].data[r];
        row.push((v === null || v === undefined) ? '' : String(v));
      }
      model.rows.push(row);
    }
    return model;
  }

  // Pure: a short, plain-text chart summary for the canvas aria-label.
  // Quotes/newlines stripped and length-capped for attribute hygiene.
  function buildChartAriaSummary(chartData, config, tr) {
    tr = tr || function (k, f) { return f; };
    if (!chartData || !chartData.datasets || chartData.datasets.length === 0) {
      return tr('a11y.summary.empty', 'Chart with no data');
    }
    var parts = [];
    if (config.title) parts.push(config.title);
    parts.push(config.chartType + ' chart');
    if (config.chartType === 'scatter') {
      var total = 0;
      for (var i = 0; i < chartData.datasets.length; i++) {
        total += (chartData.datasets[i].data || []).length;
      }
      parts.push(chartData.datasets.length + ' series');
      parts.push(total + ' points');
    } else {
      parts.push((chartData.labels || []).length + ' categories');
      parts.push(chartData.datasets.length + ' series');
    }
    return parts.join(', ').replace(/["\r\n]/g, ' ').slice(0, 200);
  }

  function ensureA11yNodes() {
    if (!_state.canvasEl) return null;
    var area = _state.canvasEl.parentNode;
    if (!area) return null;
    var live = area.querySelector('.cj-a11y-live');
    if (!live) {
      live = document.createElement('div');
      live.className = 'cj-sr-only cj-a11y-live';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      area.appendChild(live);
    }
    var table = area.querySelector('.cj-a11y-table');
    if (!table) {
      table = document.createElement('div');
      table.className = 'cj-sr-only cj-a11y-table';
      area.appendChild(table);
    }
    return { live: live, table: table };
  }

  // Build the <table> with DOM APIs only; cells use textContent (no innerHTML).
  function renderA11yTable(container, model) {
    container.textContent = '';
    var table = document.createElement('table');
    if (model.caption) {
      var cap = document.createElement('caption');
      cap.textContent = model.caption;
      table.appendChild(cap);
    }
    if (model.headers && model.headers.length) {
      var thead = document.createElement('thead');
      var htr = document.createElement('tr');
      for (var h = 0; h < model.headers.length; h++) {
        var th = document.createElement('th');
        th.setAttribute('scope', 'col');
        th.textContent = model.headers[h];
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      table.appendChild(thead);
    }
    var tbody = document.createElement('tbody');
    for (var r = 0; r < model.rows.length; r++) {
      var tr = document.createElement('tr');
      for (var c = 0; c < model.rows[r].length; c++) {
        var td = document.createElement('td');
        td.textContent = model.rows[r][c];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function syncA11yView(chartData) {
    var nodes = ensureA11yNodes();
    if (!nodes) return;
    var model = buildAccessibleTableModel(chartData, _state.config, t);
    renderA11yTable(nodes.table, model);
    var summary = buildChartAriaSummary(chartData, _state.config, t);
    if (_state.canvasEl) {
      _state.canvasEl.setAttribute('role', 'img');
      _state.canvasEl.setAttribute('aria-label', summary);
    }
    nodes.live.textContent = t('a11y.live.updated', 'Chart updated') + ': ' + summary;
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

    var rstate = getRenderState(config);
    if (!rstate.ok) {
      showChartEmpty(rstate.message);
      return;
    }

    var chartData = {};
    var chartOptions = buildChartOptions(config);

    if (chartType === 'scatter') {
      chartData = buildScatterChartData(rawData, series);
    } else if (chartType === 'pie' || chartType === 'doughnut' || chartType === 'polarArea') {
      chartData = buildPieChartData(rawData, xAxis, series, opts);
    } else {
      chartData = buildStandardChartData(rawData, xAxis, series, opts);
    }

    if (!chartHasData(chartData)) {
      showChartEmpty(t('msg.noData', 'No data to display for the selected fields.'));
      return;
    }
    hideChartEmpty();

    var ctx = _state.canvasEl.getContext('2d');
    _state.chartInstance = new Chart(ctx, {
      type: chartType,
      data: chartData,
      options: chartOptions,
    });

    syncA11yView(chartData);
  }

  function buildStandardChartData(rawData, xAxis, series, opts) {
    var rows = buildCategoryRows(rawData, xAxis, series, opts);
    var labels = [];
    for (var r = 0; r < rows.length; r++) labels.push(rows[r].label);

    var datasets = [];
    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      var data = [];
      for (var r2 = 0; r2 < rows.length; r2++) data.push(rows[r2].values[i]);
      datasets.push({
        label: s.label || s.yField,
        data: data,
        backgroundColor: hexToRgba(s.color, 0.7),
        borderColor: s.color,
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        pointBackgroundColor: s.color,
        pointRadius: 3,
      });
    }

    return { labels: labels, datasets: datasets };
  }

  function buildPieChartData(rawData, xAxis, series, opts) {
    var s = series[0];
    var rows = buildCategoryRows(rawData, xAxis, [s], opts);
    var labels = [];
    var values = [];
    for (var r = 0; r < rows.length; r++) {
      labels.push(rows[r].label);
      values.push(rows[r].values[0]);
    }
    var bgColors = [];
    for (var i = 0; i < labels.length; i++) {
      bgColors.push(DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
    }

    return {
      labels: labels,
      datasets: [{
        label: s.label || s.yField,
        data: values,
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
              var fmt = config.options.numberFormat;
              if (chartType === 'scatter') {
                return label + ': (' + formatNumber(context.parsed.x, fmt) + ', ' + formatNumber(context.parsed.y, fmt) + ')';
              }
              var value;
              if (isPie) {
                value = context.parsed;
              } else {
                var key = getValueAxisKey(config);
                value = context.parsed[key];
                if (value === undefined) {
                  value = (context.parsed.y !== undefined) ? context.parsed.y : context.parsed;
                }
              }
              return label + ': ' + formatNumber(value, fmt);
            },
          },
        },
      },
      animation: {
        duration: 400,
        easing: 'easeOutQuart',
      },
    };

    if (chartType === 'bar' && opts.horizontalBars) {
      options.indexAxis = 'y';
    }

    if (!isPie) {
      options.scales = {
        x: {
          display: true,
          title: { display: !!opts.xAxisTitle, text: opts.xAxisTitle || '', font: { size: 12 }, color: '#4b5563' },
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
          title: { display: !!opts.yAxisTitle, text: opts.yAxisTitle || '', font: { size: 12 }, color: '#4b5563' },
          grid: { display: opts.showGrid, color: 'rgba(0,0,0,0.05)' },
          stacked: opts.stacked,
          beginAtZero: opts.beginAtZero,
          ticks: {
            font: { size: 11 },
            color: '#6b7280',
          },
        },
      };

      var valueKey = getValueAxisKey(config);
      options.scales[valueKey].ticks.callback = function(value) {
        return formatNumber(value, config.options.numberFormat);
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

  function formatNumber(value, fmt) {
    if (typeof value !== 'number' || isNaN(value)) return value;
    fmt = fmt || {};
    var useGrouping = fmt.useThousands !== false;
    var str;
    if (fmt.decimalsMode === 'fixed') {
      var d = parseInt(fmt.decimals, 10);
      if (isNaN(d) || d < 0) d = 0;
      if (d > 6) d = 6;
      str = value.toLocaleString(undefined, {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
        useGrouping: useGrouping,
      });
    } else {
      var dm = parseInt(fmt.decimals, 10);
      if (isNaN(dm) || dm < 0) dm = 2;
      if (dm > 6) dm = 6;
      str = value.toLocaleString(undefined, {
        maximumFractionDigits: dm,
        useGrouping: useGrouping,
      });
    }
    return (fmt.prefix || '') + str + (fmt.suffix || '');
  }

  // The "value axis" is x for horizontal bars, y otherwise. Never format the
  // category axis (its ticks are labels/indices, not values).
  function getValueAxisKey(config) {
    return (config.chartType === 'bar' && config.options.horizontalBars) ? 'x' : 'y';
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
      var allowedSorts = { none: 1, value_desc: 1, value_asc: 1, label_asc: 1, label_desc: 1 };
      _state.config.options.categorySort = allowedSorts[saved.options.categorySort] ? saved.options.categorySort : 'none';
      var tn = parseInt(saved.options.topN, 10);
      _state.config.options.topN = (!isNaN(tn) && tn > 0) ? Math.min(tn, 100) : 0;
      _state.config.options.showOthers = !!saved.options.showOthers;
      _state.config.options.othersLabel = (typeof saved.options.othersLabel === 'string' && saved.options.othersLabel) ? saved.options.othersLabel : 'Others';
      _state.config.options.xAxisTitle = typeof saved.options.xAxisTitle === 'string' ? saved.options.xAxisTitle : '';
      _state.config.options.yAxisTitle = typeof saved.options.yAxisTitle === 'string' ? saved.options.yAxisTitle : '';
      _state.config.options.horizontalBars = !!saved.options.horizontalBars;
      var savedNf = (saved.options.numberFormat && typeof saved.options.numberFormat === 'object') ? saved.options.numberFormat : {};
      var nfDec = parseInt(savedNf.decimals, 10);
      _state.config.options.numberFormat = {
        decimalsMode: savedNf.decimalsMode === 'fixed' ? 'fixed' : 'auto',
        decimals: (!isNaN(nfDec) && nfDec >= 0) ? Math.min(nfDec, 6) : 2,
        useThousands: savedNf.useThousands !== false,
        prefix: typeof savedNf.prefix === 'string' ? savedNf.prefix : '',
        suffix: typeof savedNf.suffix === 'string' ? savedNf.suffix : '',
      };
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

    var optSort = document.getElementById('cj-opt-sort');
    if (optSort) optSort.value = _state.config.options.categorySort;
    var optTopN = document.getElementById('cj-opt-topn');
    if (optTopN) optTopN.value = _state.config.options.topN || 0;
    var optOthers = document.getElementById('cj-opt-others');
    if (optOthers) optOthers.checked = _state.config.options.showOthers;
    var optOthersLabel = document.getElementById('cj-opt-others-label');
    if (optOthersLabel) optOthersLabel.value = _state.config.options.othersLabel || 'Others';
    var optXTitle = document.getElementById('cj-opt-xtitle');
    if (optXTitle) optXTitle.value = _state.config.options.xAxisTitle || '';
    var optYTitle = document.getElementById('cj-opt-ytitle');
    if (optYTitle) optYTitle.value = _state.config.options.yAxisTitle || '';
    var optHBars = document.getElementById('cj-opt-hbars');
    if (optHBars) optHBars.checked = _state.config.options.horizontalBars;

    var nf2 = _state.config.options.numberFormat;
    var optDecMode = document.getElementById('cj-opt-decmode');
    if (optDecMode) optDecMode.value = nf2.decimalsMode;
    var optDecimals = document.getElementById('cj-opt-decimals');
    if (optDecimals) optDecimals.value = nf2.decimals;
    var optThousands = document.getElementById('cj-opt-thousands');
    if (optThousands) optThousands.checked = nf2.useThousands;
    var optPrefix = document.getElementById('cj-opt-prefix');
    if (optPrefix) optPrefix.value = nf2.prefix;
    var optSuffix = document.getElementById('cj-opt-suffix');
    if (optSuffix) optSuffix.value = nf2.suffix;
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

    // Build the config panel
    buildConfigPanel(configPanelEl, fields);

    // If saved config, restore it
    if (savedConfig) {
      loadConfig(savedConfig);
      restoreUIFromConfig(fields);
    }

    // Initial render
    renderChart();
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

  if (typeof window !== 'undefined') {
    window.ChartJSCKAN = {
      init: init,
      getConfig: getConfig,
      destroy: destroy,
    };
  }

  // Expose pure helpers for headless unit testing (node). No-op in the browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      t: t,
      aggregate: aggregate,
      aggregateData: aggregateData,
      sortAggregatedRows: sortAggregatedRows,
      applyTopNAndOthers: applyTopNAndOthers,
      buildCategoryRows: buildCategoryRows,
      formatNumber: formatNumber,
      buildAccessibleTableModel: buildAccessibleTableModel,
      buildChartAriaSummary: buildChartAriaSummary,
    };
  }

})();

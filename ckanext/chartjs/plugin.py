# encoding: utf-8
"""
CKAN plugin for interactive CSV visualization using Chart.js.
"""
import json
import ckan.plugins as plugins
import ckan.plugins.toolkit as toolkit

from .api import chartjs_api

PLUGIN_NAME = 'chartjs'

# i18n bridge (B4). English is the source/fallback supplied by the JS t()
# helper, so only non-English locales need entries here. A gettext/.po pipeline
# can replace this later; this keeps ES working without compiling .mo files.
CJ_STRINGS = {
    'es': {
        'ui.chartType': 'Tipo de gráfico',
        'ui.title': 'Título del gráfico',
        'ui.titlePlaceholder': 'Ingresá un título...',
        'ui.xAxis': 'Categoría / Eje X',
        'ui.series': 'Series de datos',
        'ui.addSeries': '+ Agregar serie',
        'ui.options': 'Opciones',
        'ui.display': 'Visualización',
        'ui.value': 'Valor (Eje Y)',
        'ui.aggregation': 'Agregación',
        'ui.color': 'Color',
        'opt.showLegend': 'Mostrar leyenda',
        'opt.showGrid': 'Mostrar cuadrícula',
        'opt.stacked': 'Apilado',
        'opt.beginAtZero': 'Comenzar en cero',
        'opt.categoryOrder': 'Orden de categorías',
        'opt.topN': 'Top N categorías (0 = todas)',
        'opt.groupOthers': 'Agrupar resto como "Otros"',
        'opt.othersLabel': 'Etiqueta de "Otros"',
        'opt.xAxisTitle': 'Título eje X',
        'opt.yAxisTitle': 'Título eje Y',
        'opt.horizontalBars': 'Barras horizontales (gráfico de barras)',
        'opt.numberDecimals': 'Decimales',
        'opt.decimalPlaces': 'Lugares decimales',
        'opt.thousands': 'Separador de miles',
        'opt.prefix': 'Prefijo de valor',
        'opt.suffix': 'Sufijo de valor',
        'chart.bar': 'Barras',
        'chart.line': 'Líneas',
        'chart.pie': 'Torta',
        'chart.doughnut': 'Dona',
        'chart.scatter': 'Dispersión',
        'chart.radar': 'Radar',
        'chart.polarArea': 'Área polar',
        'agg.sum': 'Suma',
        'agg.count': 'Conteo',
        'agg.average': 'Promedio',
        'agg.min': 'Mínimo',
        'agg.max': 'Máximo',
        'sort.none': 'Original',
        'sort.value_desc': 'Valor (mayor → menor)',
        'sort.value_asc': 'Valor (menor → mayor)',
        'sort.label_asc': 'Etiqueta (A → Z)',
        'sort.label_desc': 'Etiqueta (Z → A)',
        'fmt.auto': 'Automático',
        'fmt.fixed': 'Fijo',
        'msg.selectX': 'Seleccioná un campo de categoría (Eje X) para construir el gráfico.',
        'msg.addSeries': 'Agregá al menos una serie de datos (Eje Y) para construir el gráfico.',
        'msg.seriesYField': 'Cada serie de datos necesita un campo de valor (Eje Y).',
        'msg.noData': 'No hay datos para mostrar con los campos seleccionados.',
        'a11y.table.empty': 'Sin datos para mostrar',
        'a11y.table.caption': 'Datos del gráfico',
        'a11y.col.category': 'Categoría',
        'a11y.col.series': 'Serie',
        'a11y.summary.empty': 'Gráfico sin datos',
        'a11y.live.updated': 'Gráfico actualizado',
    },
}


class ChartJSPlugin(plugins.SingletonPlugin):
    """CKAN plugin for interactive CSV visualization using Chart.js."""

    def __init__(self, name=None):
        super().__init__()
        self.default_title = 'Chart.js Explorer'
        self.supported_formats = {'csv'}
        self.max_rows = 50000
        self.site_url = ''

    plugins.implements(plugins.IConfigurer)
    def update_config(self, config_):
        toolkit.add_template_directory(config_, 'templates')
        toolkit.add_public_directory(config_, 'public')

    plugins.implements(plugins.IBlueprint)
    def get_blueprint(self):
        return chartjs_api

    plugins.implements(plugins.IConfigurable, inherit=True)
    def configure(self, config):
        self.site_url = config.get('ckan.site_url', '')
        self.default_title = config.get(
            f'ckanext.{PLUGIN_NAME}.default_title', 'Chart.js Explorer'
        )
        formats_str = config.get(f'ckanext.{PLUGIN_NAME}.formats', 'csv')
        self.supported_formats = {f.strip().lower() for f in formats_str.split(',')}
        self.max_rows = int(config.get(f'ckanext.{PLUGIN_NAME}.max_rows', '50000'))

    plugins.implements(plugins.IResourceView, inherit=True)
    def info(self):
        ignore_missing = toolkit.get_validator('ignore_missing')
        return {
            'name': PLUGIN_NAME,
            'title': toolkit._('Chart.js'),
            'default_title': toolkit._(self.default_title),
            'icon': 'bar-chart-o',
            'always_available': False,
            'filterable': True,
            'iframed': False,
            'schema': {
                'chart_config': [ignore_missing],
            },
        }

    def can_view(self, data_dict):
        resource = data_dict.get('resource', {})
        fmt = resource.get('format', '').lower().strip()
        return fmt in self.supported_formats

    def _get_cj_i18n(self):
        """Pick the UI string dict for the current CKAN locale. Defensive:
        any failure falls back to {} (the JS t() helper then uses English)."""
        lang = 'en'
        try:
            lang = toolkit.h.lang() or 'en'
        except Exception:
            try:
                lang = toolkit.config.get('ckan.locale_default', 'en') or 'en'
            except Exception:
                lang = 'en'
        lang = str(lang).replace('-', '_').split('_')[0].lower()
        return CJ_STRINGS.get(lang, {})

    def setup_template_variables(self, context, data_dict):
        resource = data_dict['resource']
        view = data_dict.get('resource_view', {})

        saved_config = view.get('chart_config', '')
        chart_config = None
        if saved_config and isinstance(saved_config, str):
            try:
                chart_config = json.loads(saved_config)
            except (json.JSONDecodeError, TypeError):
                chart_config = None

        user = context.get('user', '') or ''
        try:
            user = toolkit.c.user or ''
        except Exception:
            pass

        return {
            'resource_id': resource.get('id', ''),
            'resource_name': resource.get('name', 'Dataset'),
            'resource_format': resource.get('format', 'CSV'),
            'view_title': view.get('title', self.default_title),
            'view_id': view.get('id', ''),
            'max_rows': self.max_rows,
            'api_url': f'/api/chartjs/data/{resource.get("id", "")}',
            'chart_config_json': json.dumps(chart_config) if chart_config else 'null',
            'user': user,
            'cj_i18n': self._get_cj_i18n(),
        }

    def view_template(self, context, data_dict):
        return 'chartjs_view.html'

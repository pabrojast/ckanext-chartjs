# encoding: utf-8
"""
CKAN plugin for interactive CSV visualization using Chart.js.
"""
import json
import ckan.plugins as plugins
import ckan.plugins.toolkit as toolkit

from .api import chartjs_api

PLUGIN_NAME = 'chart_js'


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
        }

    def view_template(self, context, data_dict):
        return 'chartjs_view.html'

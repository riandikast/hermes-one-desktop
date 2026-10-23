"""Offline installed-definition replay. No server imports, config, DB, network, or provider calls."""
import ast
import contextlib
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

root = Path('C:/Users/riand/AppData/Local/hermes/hermes-agent')

def definitions(relative, names, namespace):
    tree = ast.parse((root / relative).read_text(encoding='utf8'))
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {n.name for n in nodes} == set(names)
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), relative, 'exec'), namespace)

result = SimpleNamespace(success=True, new_model='deepseek-v4.1-flash', target_provider='custom:cbai', base_url='https://fixture.invalid/v1', api_key='', api_mode='', warning_message='')
modules = {name: types.ModuleType(name) for name in ['hermes_cli', 'hermes_cli.model_switch', 'hermes_cli.config', 'hermes_cli.observability', 'hermes_cli.observability.shared_metrics_events']}
modules['hermes_cli.model_switch'].switch_model = lambda **kwargs: result
modules['hermes_cli.observability.shared_metrics_events'].record_model_switch = lambda **kwargs: None
namespace = {'contextlib': contextlib, 'Any': object,
    '_switch_request': lambda *args: ('deepseek-v4.1-flash', 'custom:cbai', False, False, ''),
    '_current_model_runtime': lambda *args: ('', '', '', ''),
    '_expensive_model_confirm': lambda *args: None,
    '_switch_away_provider': lambda *args: '', '_session_source': lambda *args: 'desktop'}
definitions('tui_gateway/model_switch.py', ['_apply_model_switch'], namespace)
session = {'agent': None}
with patch.dict(sys.modules, modules):
    acknowledgement = namespace['_apply_model_switch']('fixture', session, 'deepseek-v4.1-flash --provider custom:cbai --session')
assert acknowledgement['scope'] == 'session'
assert session['agent'] is None
assert session['model_override']['provider'] == 'custom:cbai'
# The actual installed status formatter emits placeholders while no agent/mirror exists.
status = {'STATUS_LABELS': {'model': 'Model'}, 'UNKNOWN_MODEL': '(unknown)', 'UNKNOWN_PROVIDER': 'unknown', 'Any': object}
definitions('hermes_cli/status_report.py', ['status_lines'], status)
lines = status['status_lines']({'model': '', 'provider': ''}, 'model')
assert lines == ['Model: (unknown) (unknown)']
print(json.dumps({'definitionsOnly': True, 'acknowledgement': acknowledgement, 'agentReady': False, 'status': lines, 'overrideProvider': session['model_override']['provider']}))

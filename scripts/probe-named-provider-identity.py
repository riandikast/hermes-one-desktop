"""Replay installed definitions only: no server import, user config, secrets, DB, or network."""
import ast
import contextlib
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('C:/Users/riand/AppData/Local/hermes/hermes-agent')

def definitions(relative, names, namespace):
    tree = ast.parse((root / relative).read_text(encoding='utf8'))
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {n.name for n in nodes} == set(names)
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])), relative, 'exec'), namespace)

model = 'oc/mimo-v2.6-flash-free'
endpoint = 'https://requested.invalid/v1'
# This is fixture provider resolution, not the user's configuration.
rp = SimpleNamespace(
    _get_named_custom_provider=lambda name: {'name': name, 'base_url': endpoint},
    _resolves_to_custom=lambda name: False,
    _try_resolve_from_custom_pool=lambda *args, **kwargs: None,
    _host_gated_env_key_candidates=lambda *args, **kwargs: [],
    has_usable_secret=lambda key: False,
    _detect_api_mode_for_url=lambda url: 'chat_completions',
    _runtime=lambda provider, mode, url, key, **extra: {'provider': provider, 'base_url': url, 'api_mode': mode, **extra},
)
ns = {'_rp': lambda: rp, '_LLAMACPP_ALIASES': set(), '_clean': lambda value: value,
      '_key_env_secret': lambda *args: '', '_apply_custom_provider_extras': lambda *args: None,
      '_opencode_family_for_custom': lambda *args: None}
definitions('hermes_cli/runtime_provider_custom.py', ['_custom_runtime', '_resolve_named_custom_runtime'], ns)
runtime = ns['_resolve_named_custom_runtime'](requested_provider='9r', target_model=model)
assert runtime['provider'] == 'custom' and runtime['base_url'] == endpoint

result = SimpleNamespace(success=True, new_model=model, target_provider='9r', base_url=endpoint,
                         api_key='', api_mode='chat_completions', warning_message='')
modules = {name: types.ModuleType(name) for name in ['hermes_cli', 'hermes_cli.model_switch', 'hermes_cli.config', 'hermes_cli.observability', 'hermes_cli.observability.shared_metrics_events']}
modules['hermes_cli.model_switch'].switch_model = lambda **kwargs: result
modules['hermes_cli.observability.shared_metrics_events'].record_model_switch = lambda **kwargs: None
switch = {'contextlib': contextlib, '_switch_request': lambda *args: (model, '9r', False, False, ''),
          '_current_model_runtime': lambda *args: ('', '', '', ''), '_expensive_model_confirm': lambda *args: None,
          '_switch_away_provider': lambda *args: '', '_session_source': lambda *args: 'desktop'}
definitions('tui_gateway/model_switch.py', ['_apply_model_switch'], switch)
session = {'agent': None}
with patch.dict(sys.modules, modules):
    ack = switch['_apply_model_switch']('fixture-runtime', session, model + ' --provider 9r --session')
assert ack['scope'] == 'session' and session['model_override']['provider'] == '9r'
status = {'STATUS_LABELS': {'model': 'Model'}, 'UNKNOWN_MODEL': '(unknown)', 'UNKNOWN_PROVIDER': 'unknown'}
definitions('hermes_cli/status_report.py', ['status_lines'], status)

def display(runtime_model, runtime_endpoint):
    # session.status forwards agent.model/provider, not endpoint; same agent fixture after construction.
    agent = SimpleNamespace(model=runtime_model, provider=runtime['provider'], base_url=runtime_endpoint)
    return status['status_lines']({'model': agent.model, 'provider': agent.provider}, 'model')[0]

correct = display(model, endpoint)
wrong_endpoint = display(model, 'https://wrong.invalid/v1')
wrong_model = display('different-model', endpoint)
assert correct == 'Model: oc/mimo-v2.6-flash-free (custom)'
assert wrong_endpoint == correct  # Indistinguishable at the status boundary: never accept by model alone.
assert wrong_model != correct
print(json.dumps({'definitionsOnly': True, 'providerInput': '9r', 'modelInput': model,
                  'acknowledgement': ack, 'overrideProvider': session['model_override']['provider'],
                  'runtimeProvider': runtime['provider'], 'correctStatus': correct,
                  'wrongEndpointStatus': wrong_endpoint, 'wrongModelStatus': wrong_model,
                  'safeToEquateStatusAlone': False}, indent=2))

"""Offline, stdlib-only replay of installed backend definitions. No imports of server/config.
Provider resolution and persistence are excluded; the real selection guard decides whether
live runtime mutates. This is a bounded large-context reproduction, not a live-user diagnosis.
"""
import ast
import contextlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else
            'C:/Users/riand/AppData/Local/hermes/hermes-agent')


def definitions(relative, names, namespace):
    path = ROOT / relative
    tree = ast.parse(path.read_text(encoding='utf-8'))
    selected = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))
                and node.name in names]
    assert {node.name for node in selected} == set(names), (path, names)
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), 'exec'), namespace)


def replay(tokens):
    # Real context-cache guard, with fixed threshold instead of reading user config.
    guards = {'Optional': __import__('typing').Optional, 'SelectionWarning': SimpleNamespace,
              '_context_cache_threshold': lambda: 100_000}
    definitions('hermes_cli/model_selection_guards.py',
                ['selection_context_for_agent', '_context_cache_guard'], guards)
    guards['SelectionContext'] = SimpleNamespace
    agent = SimpleNamespace(model='primary', provider='9r', session_prompt_tokens=tokens,
                            _fallback_activated=False, _fallback_index=0)
    session = {'agent': agent, 'running': False}
    result = SimpleNamespace(new_model='cx/gpt-6.1-sol', target_provider='9r', success=True,
                             base_url='', api_key='', api_mode='', warning_message='')
    namespace = {'contextlib': contextlib,
                 '_session_profile_runtime_scope': lambda s: contextlib.nullcontext(),
                 '_session_uses_compute_host': lambda s: False,
                 '_MUTATES_WHILE_RUNNING': {'model', 'personality', 'compress'}}

    # Only external resolution/metrics/config are stubbed; execute the installed
    # _apply_model_switch body, including its real early return and commit decision.
    import types
    import unittest.mock
    switch_module = types.ModuleType('hermes_cli.model_switch')
    switch_module.switch_model = lambda **kw: result
    metrics = types.ModuleType('hermes_cli.observability.shared_metrics_events')
    metrics.record_model_switch = lambda **kw: None
    modules = {'hermes_cli': types.ModuleType('hermes_cli'),
               'hermes_cli.model_switch': switch_module,
               'hermes_cli.config': types.ModuleType('hermes_cli.config'),
               'hermes_cli.observability': types.ModuleType('hermes_cli.observability'),
               'hermes_cli.observability.shared_metrics_events': metrics}
    def confirm(res, base, key, live_agent):
        warning = guards['_context_cache_guard'](
            res.new_model, res.target_provider, None, None, None,
            guards['selection_context_for_agent'](live_agent))
        return None if warning is None else {
            'value': res.new_model, 'warning': warning.message,
            'confirm_required': True, 'confirm_message': warning.message}
    namespace.update({
        '_switch_request': lambda *a: ('cx/gpt-6.1-sol', '9r', False, False, ''),
        '_current_model_runtime': lambda a, p: (a.provider, a.model, '', ''),
        '_merge_preflight_warning': lambda *a: None,
        '_expensive_model_confirm': confirm,
        '_commit_agent_switch': lambda sid, s, a, r, *rest: setattr(a, 'model', r.new_model),
        '_switch_away_provider': lambda *a: '9r', '_session_source': lambda s: 'desktop'})
    definitions('tui_gateway/model_switch.py', ['_apply_model_switch'], namespace)
    real_apply = namespace['_apply_model_switch']
    def apply(*args, **kwargs):
        with unittest.mock.patch.dict(sys.modules, modules):
            return real_apply(*args, **kwargs)
    namespace['_apply_model_switch'] = apply
    tree = ast.parse((ROOT / 'tui_gateway/methods_slash.py').read_text(encoding='utf-8'))
    mirrors = next(n for n in tree.body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == '_SLASH_MIRRORS' for t in n.targets))
    # Extract only the real /model lambda; unrelated mirrors need not be loaded.
    # Trusted installed source only, fixed allowlisted AST definitions; never user input.
    entry = next(v for k, v in zip(mirrors.value.keys, mirrors.value.values)
                 if isinstance(k, ast.Constant) and k.value == 'model')
    namespace['_SLASH_MIRRORS'] = {'model': eval(compile(ast.Expression(entry),
                                                  str(ROOT / 'tui_gateway/methods_slash.py'), 'eval'), namespace)}
    definitions('tui_gateway/methods_slash.py', ['_mirror_slash_side_effects'], namespace)
    warning = namespace['_mirror_slash_side_effects']('live', session,
                                                      '/model cx/gpt-6.1-sol --provider 9r')
    # Worker has no prompt-built agent/context (methods_slash.py:21-24).
    assert guards['selection_context_for_agent'](None) is None
    slash_runtime = agent.model
    # Execute the installed config.set model setter on the SAME kind of idle
    # live session. No user state/persistence; only parsing and commit fixtures.
    agent.model = 'primary'
    switch_module.parse_model_switch_args = lambda raw: SimpleNamespace(explicit_provider='9r')
    namespace.update({'_ok': lambda rid, data: data,
                      '_err': lambda rid, code, message: (_ for _ in ()).throw(AssertionError(message))})
    definitions('tui_gateway/methods_config_set.py',
                ['_kv', '_cfgset_guarded', '_set_model'], namespace)
    params = {'session_id': 'live', 'key': 'model',
              'value': 'cx/gpt-6.1-sol --provider 9r --session'}
    with unittest.mock.patch.dict(sys.modules, modules):
        first_config = namespace['_set_model'](1, params, 'model', params['value'], session)
        first_runtime = agent.model
        confirmed_config = namespace['_set_model'](
            2, {**params, 'confirm_expensive_model': True}, 'model', params['value'], session)
    config_runtime = agent.model
    agent.model = slash_runtime
    restore = {'_revert_credential_rotation': lambda a: None}
    definitions('agent/agent_runtime_helpers.py', ['restore_primary_runtime'], restore)
    restore['restore_primary_runtime'](agent)
    return {'tokens': tokens, 'slash': {'output': 'Model switched to cx/gpt-6.1-sol',
                                       **({'warning': warning} if warning else {})},
            'status': {'output': f'Model: {agent.model} ({agent.provider})'},
            'nextTurnRuntime': agent.model,
            'config': {'initial': first_config, 'initialRuntime': first_runtime,
                       'confirmed': confirmed_config, 'confirmedRuntime': config_runtime}}


print(json.dumps({'backend': str(ROOT), 'definitionsOnly': True,
                  'belowThreshold': replay(99_999), 'atThreshold': replay(100_000)}))

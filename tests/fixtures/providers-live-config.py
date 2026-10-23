"""Read-only installed-backend fixture; no gateway imports, launches or user config reads."""
import ast
import json
import sys
import tempfile
import types
from pathlib import Path

repo = Path(sys.argv[1])

def function(path, name):
    tree = ast.parse((repo / path).read_text(encoding="utf-8"))
    node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)
    node.decorator_list = []
    return ast.unparse(node)

with tempfile.TemporaryDirectory(prefix="providers-fixture-") as directory:
    home = Path(directory)
    module = types.ModuleType("hermes_cli.config_effective")
    module.load_user_config_effective = lambda path: json.loads(path.read_text())
    sys.modules[module.__name__] = module
    scope = {"_gateway_config_home": lambda: home}
    exec(function("gateway/run.py", "_load_gateway_config"), scope)
    exec(function("gateway/run.py", "_resolve_gateway_model"), scope)
    exec(function("gateway/run_agent_cache.py", "_agent_config_signature"), scope)
    def save(model, provider, url, mode):
        config = {"model": {"default": model, "provider": provider, "base_url": url, "api_mode": mode}}
        (home / "config.yaml").write_text(json.dumps(config))
        loaded = scope["_load_gateway_config"]()
        selected = scope["_resolve_gateway_model"](loaded)
        runtime = {"provider": loaded["model"]["provider"], "base_url": loaded["model"]["base_url"], "api_mode": loaded["model"]["api_mode"]}
        return selected, scope["_agent_config_signature"](selected, runtime, [], "")
    first = save("old-model", "old", "https://old.test", "anthropic_messages")
    second = save("new-model", "custom", "https://new.test/v1", "chat_completions")
    assert first[0] == "old-model" and second[0] == "new-model"
    assert first[1] != second[1], "Model/runtime changes must invalidate cached agents"
    assert second == save("new-model", "custom", "https://new.test/v1", "chat_completions")
print("PASS: installed backend re-reads fixture default; model/provider/endpoint/protocol invalidate cache")

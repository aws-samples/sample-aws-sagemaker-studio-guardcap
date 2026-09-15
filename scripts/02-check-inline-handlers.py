#!/usr/bin/env python3
"""Parses every inline Lambda handler in the templates and reports names that are
never bound anywhere in the module.

Why this exists: the four `Code.ZipFile` handlers are YAML block scalars, so nothing
compiles them. `cfn-lint` validates the template, `py_compile` covers only
scripts/01-admin-platform-api.py, and both are happy with a handler that calls an
undefined name. That is not hypothetical - on 2026-09-03, replacing a `print()` with
`log.info()` in StopStudioAppFunction without adding the import left a NameError on the
handler's last line, reached only AFTER the DeleteApp calls, so the cap deleted the
apps and then reported failure. A syntax check would not have caught it.

Deliberately not a full linter. It answers one question - is every name this module
loads bound somewhere in it - which is the class of mistake an inline handler invites,
and it needs no dependency beyond the standard library.

    python3 scripts/02-check-inline-handlers.py

Exits 1 on the first handler with an unbound name, so it can gate a merge request.
"""

# 1. IMPORTS
import ast
import builtins
import pathlib
import sys

import yaml

TEMPLATES = ("cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml",
             "cloudformation/04-Sagemaker-Gpu-Student.yaml")

# Every short-form intrinsic the templates use. yaml.SafeLoader raises on an unknown
# tag, and the values themselves do not matter here - only Code.ZipFile is read.
INTRINSICS = ("Sub", "Ref", "GetAtt", "Select", "Split", "If", "Equals", "Not", "And",
              "Or", "Join", "FindInMap", "ImportValue", "Base64", "Condition", "GetAZs",
              "Cidr")


# 2. TEMPLATE LOADING
class TemplateLoader(yaml.SafeLoader):
    """SafeLoader that tolerates !Sub and friends by discarding them.

    Subclassing SafeLoader keeps the safe behaviour - no arbitrary object
    instantiation - while allowing the CloudFormation short-form tags, which plain
    safe_load rejects. Bandit still flags the yaml.load call below (B506) because it
    matches on the call, not on what the loader inherits from.
    """


for tag in INTRINSICS:
    TemplateLoader.add_constructor(f"!{tag}", lambda loader, node: None)


def inline_handlers(path):
    """(resource name, source) for every Lambda function with inline code."""
    text = pathlib.Path(path).read_text()
    template = yaml.load(text, Loader=TemplateLoader)  # nosec B506 - SafeLoader subclass
    for name, resource in (template.get("Resources") or {}).items():
        if resource.get("Type") != "AWS::Lambda::Function":
            continue
        source = ((resource.get("Properties") or {}).get("Code") or {}).get("ZipFile")
        if isinstance(source, str):
            yield name, source


# 3. NAME ANALYSIS
def bound_names(tree):
    """Every name the module binds, at any scope.

    Scope-insensitive on purpose: a name bound in one function and read in another is a
    bug this check does not claim to find. Flagging only names bound NOWHERE keeps it
    free of false positives, which is what makes it usable as a gate.
    """
    names = set(dir(builtins))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {a.asname or a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            names |= {a.asname or a.name for a in node.names}
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names.add(node.id)

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            args = node.args
            names |= {a.arg for a in args.posonlyargs + args.args + args.kwonlyargs}
            for extra in (args.vararg, args.kwarg):
                if extra:
                    names.add(extra.arg)
    return names


def unbound_names(source):
    """Sorted names this module reads but never binds. Raises SyntaxError if it
    does not parse, which is itself worth failing on."""
    tree = ast.parse(source)
    read = {n.id for n in ast.walk(tree)
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    return sorted(read - bound_names(tree))


# 4. ENTRY POINT
def main():
    failed = False
    for path in TEMPLATES:
        for name, source in inline_handlers(path):
            try:
                missing = unbound_names(source)
            except SyntaxError as exc:
                print(f"FAIL  {name} ({path}): does not parse - {exc}")
                failed = True
                continue
            if missing:
                print(f"FAIL  {name} ({path}): name(s) never bound: {', '.join(missing)}")
                failed = True
            else:
                print(f"ok    {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Purpose-built mutation tester for the backend (see docs/tests/backend-test-audit.md).

Not part of CI or the verify scripts: a full run takes tens of minutes.

How it works
------------
1. Coverage map. The fast test tier is run once under ``pytest-cov`` with
   ``--cov-context=test`` so that every source line knows which tests execute
   it (``--coverage`` reuses an existing data file).
2. Mutants. Each target module is parsed with ``ast`` and every mutation site
   is enumerated: arithmetic / comparison / boolean operators, ``not`` removal,
   integer and boolean constants, ``min``<->``max`` and ``any``<->``all``,
   ``return x`` -> ``return None``, deletion of call statements and of
   attribute/item assignments, and negation of plain ``if``/``while`` tests.
   Annotations, docstrings, ``__repr__`` and ``if TYPE_CHECKING`` are skipped.
3. Runs. Every mutant is written into a private copy of ``backend/`` (one per
   worker, so mutants run in parallel) and only the tests that cover the
   mutated line are run in a fresh interpreter. A failing test or a timeout
   kills the mutant; a mutant on a line no test executes is "uncovered".
   ``--matrix`` runs every covering test (no ``-x``) and records which tests
   kill each mutant (per-test value); otherwise the first failure stops the
   run.

Usage
-----
    scripts/mutation-test.sh game/rules.py game/hotel.py      # wrapper
    python scripts/mutation_test.py --module game/rules.py --out /tmp/rules.json
    python scripts/mutation_test.py --module game/game.py --matrix --workers 4
    python scripts/mutation_test.py --rerun /tmp/rules.json --marker slow
        (re-run the survivors of an earlier run against the slow tier)

The JSON output lists every mutant with file:line, the mutation, its status
(killed / survived / timeout / uncovered / error) and, with --matrix, the
killing tests.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = REPO / "backend"

BINOP_SWAP = {
    ast.Add: ast.Sub,
    ast.Sub: ast.Add,
    ast.Mult: ast.FloorDiv,
    ast.FloorDiv: ast.Mult,
    ast.Div: ast.Mult,
    ast.Mod: ast.FloorDiv,
}
CMP_SWAP = {
    ast.Lt: ast.LtE,
    ast.LtE: ast.Lt,
    ast.Gt: ast.GtE,
    ast.GtE: ast.Gt,
    ast.Eq: ast.NotEq,
    ast.NotEq: ast.Eq,
    ast.In: ast.NotIn,
    ast.NotIn: ast.In,
    ast.Is: ast.IsNot,
    ast.IsNot: ast.Is,
}
NAME_SWAP = {"min": "max", "max": "min", "any": "all", "all": "any"}
OPNAME = {
    ast.Add: "+",
    ast.Sub: "-",
    ast.Mult: "*",
    ast.FloorDiv: "//",
    ast.Div: "/",
    ast.Mod: "%",
    ast.Lt: "<",
    ast.LtE: "<=",
    ast.Gt: ">",
    ast.GtE: ">=",
    ast.Eq: "==",
    ast.NotEq: "!=",
    ast.In: "in",
    ast.NotIn: "not in",
    ast.Is: "is",
    ast.IsNot: "is not",
    ast.And: "and",
    ast.Or: "or",
}


# --------------------------------------------------------------------------
# Mutant enumeration
# --------------------------------------------------------------------------


def _skip_ids(tree: ast.AST) -> set[int]:
    """ids of nodes that must not be mutated (annotations, docstrings, ...)."""
    skip: set[int] = set()

    def mark(node):
        for n in ast.walk(node):
            skip.add(id(n))

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.returns is not None:
                mark(node.returns)
            for d in node.decorator_list:
                mark(d)
            for a in (node.args.args + node.args.kwonlyargs + node.args.posonlyargs) + [
                x for x in (node.args.vararg, node.args.kwarg) if x
            ]:
                if a.annotation is not None:
                    mark(a.annotation)
            if node.name == "__repr__":
                mark(node)
        if isinstance(node, ast.ClassDef):
            for d in node.decorator_list:
                mark(d)
        if isinstance(node, ast.AnnAssign):
            mark(node.annotation)
        if isinstance(node, ast.If):
            t = node.test
            if isinstance(t, ast.Name) and t.id == "TYPE_CHECKING":
                mark(node)
        if isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                mark(body[0])
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mark(node)
    return skip


def _sites(node: ast.AST) -> list[tuple[str, str]]:
    """(variant, description) mutations possible at ``node``."""
    out: list[tuple[str, str]] = []
    if isinstance(node, ast.BinOp) and type(node.op) in BINOP_SWAP:
        new = BINOP_SWAP[type(node.op)]
        out.append(("binop", f"{OPNAME[type(node.op)]} -> {OPNAME[new]}"))
    elif isinstance(node, ast.AugAssign) and type(node.op) in (ast.Add, ast.Sub):
        new = BINOP_SWAP[type(node.op)]
        out.append(("augop", f"{OPNAME[type(node.op)]}= -> {OPNAME[new]}="))
    elif isinstance(node, ast.Compare):
        for i, op in enumerate(node.ops):
            if type(op) in CMP_SWAP:
                out.append(
                    (f"cmp{i}", f"{OPNAME[type(op)]} -> {OPNAME[CMP_SWAP[type(op)]]}")
                )
    elif isinstance(node, ast.BoolOp):
        new = ast.Or if isinstance(node.op, ast.And) else ast.And
        out.append(("boolop", f"{OPNAME[type(node.op)]} -> {OPNAME[new]}"))
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.Not, ast.USub)):
        out.append(
            (
                "unary",
                "remove 'not'" if isinstance(node.op, ast.Not) else "remove unary -",
            )
        )
    elif isinstance(node, ast.Constant):
        v = node.value
        if isinstance(v, bool):
            out.append(("const", f"{v} -> {not v}"))
        elif isinstance(v, int):
            new = 1 if v == 0 else 0 if v == 1 else v + 1
            out.append(("const", f"{v} -> {new}"))
    elif (
        isinstance(node, ast.Name)
        and node.id in NAME_SWAP
        and isinstance(node.ctx, ast.Load)
    ):
        out.append(("name", f"{node.id} -> {NAME_SWAP[node.id]}"))
    elif isinstance(node, ast.Return) and node.value is not None:
        if not (isinstance(node.value, ast.Constant) and node.value.value is None):
            out.append(("return", "return value -> None"))
    elif isinstance(node, ast.Expr) and isinstance(node.value, (ast.Call, ast.Await)):
        out.append(("delete", "delete call statement"))
    elif isinstance(node, ast.Assign) and all(
        isinstance(t, (ast.Attribute, ast.Subscript)) for t in node.targets
    ):
        out.append(("delete", "delete attribute/item assignment"))
    if isinstance(node, (ast.If, ast.While, ast.IfExp)) and isinstance(
        node.test, (ast.Name, ast.Attribute, ast.Call, ast.Subscript)
    ):
        out.append(("negate", "negate condition"))
    return out


def enumerate_mutants(source: str) -> list[dict]:
    tree = ast.parse(source)
    skip = _skip_ids(tree)
    # innermost enclosing statement of every node: coverage records a
    # multi-line statement under its first line
    stmt_of: dict[int, ast.stmt] = {}

    def visit(node, stmt):
        if isinstance(node, ast.stmt):
            stmt = node
        stmt_of[id(node)] = stmt
        for child in ast.iter_child_nodes(node):
            visit(child, stmt)

    visit(tree, None)
    # enclosing function of every line (stable key across line shifts)
    func_of: dict[int, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for ln in range(node.lineno, (node.end_lineno or node.lineno) + 1):
                func_of[ln] = node.name  # BFS: inner functions win
    lines = source.splitlines()
    mutants = []
    for idx, node in enumerate(ast.walk(tree)):
        if id(node) in skip:
            continue
        for variant, desc in _sites(node):
            line = getattr(node, "lineno", 0)
            if isinstance(node, (ast.If, ast.While)) or variant == "negate":
                cover = [line]
            else:
                end = getattr(node, "end_lineno", line)
                stmt = stmt_of.get(id(node))
                cover = sorted({stmt.lineno if stmt else line, *range(line, end + 1)})
            mutants.append(
                {
                    "node": idx,
                    "variant": variant,
                    "line": line,
                    "cover_lines": cover,
                    "desc": desc,
                    "func": func_of.get(line, "<module>"),
                    "src": lines[line - 1].strip() if 0 < line <= len(lines) else "",
                }
            )
    return mutants


def apply_mutant(source: str, mutant: dict) -> str:
    tree = ast.parse(source)
    nodes = list(ast.walk(tree))
    target = nodes[mutant["node"]]
    parents = {}
    for p in nodes:
        for child in ast.iter_child_nodes(p):
            parents[id(child)] = p
    v = mutant["variant"]

    def replace(old, new):
        parent = parents[id(old)]
        for field, value in ast.iter_fields(parent):
            if value is old:
                setattr(parent, field, new)
                return
            if isinstance(value, list):
                for i, item in enumerate(value):
                    if item is old:
                        value[i] = new
                        return
        raise RuntimeError("parent link not found")

    if v == "binop" or v == "augop":
        target.op = BINOP_SWAP[type(target.op)]()
    elif v.startswith("cmp"):
        i = int(v[3:])
        target.ops[i] = CMP_SWAP[type(target.ops[i])]()
    elif v == "boolop":
        target.op = ast.Or() if isinstance(target.op, ast.And) else ast.And()
    elif v == "unary":
        replace(target, target.operand)
    elif v == "const":
        val = target.value
        if isinstance(val, bool):
            target.value = not val
        else:
            target.value = 1 if val == 0 else 0 if val == 1 else val + 1
    elif v == "name":
        target.id = NAME_SWAP[target.id]
    elif v == "return":
        target.value = ast.Constant(value=None)
    elif v == "delete":
        replace(target, ast.Pass())
    elif v == "negate":
        target.test = ast.UnaryOp(op=ast.Not(), operand=target.test)
    else:
        raise ValueError(v)
    ast.fix_missing_locations(tree)
    return ast.unparse(tree)


# --------------------------------------------------------------------------
# Coverage map
# --------------------------------------------------------------------------


def build_coverage(cov_file: Path, marker: str, sources: list[str]) -> None:
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "tests",
        "-q",
        "-n",
        "auto",
        "-p",
        "no:randomly",
        "--cov-context=test",
        "--cov-report=",
        f"--junitxml={cov_file.with_suffix('.junit.xml')}",
    ]
    if marker:
        cmd += ["-m", marker]
    for s in sources:
        cmd.append(f"--cov={s}")
    env = dict(os.environ, COVERAGE_FILE=str(cov_file))
    subprocess.run(cmd, cwd=BACKEND, env=env, check=False)


def load_line_map(cov_file: Path, module: str) -> dict[int, set[str]]:
    import coverage

    data = coverage.CoverageData(basename=str(cov_file))
    data.read()
    target = str((BACKEND / module).resolve())
    measured = list(data.measured_files())
    path = next((f for f in measured if os.path.realpath(f) == target), None)
    if path is None:  # map recorded in another checkout of the repo
        suffix = "/backend/" + module
        path = next((f for f in measured if f.endswith(suffix)), None)
    if path is None:
        return {}
    ctx = data.contexts_by_lineno(path)
    out: dict[int, set[str]] = {}
    for line, contexts in ctx.items():
        tests = set()
        for c in contexts:
            if not c:
                # executed at import time (class bodies, default arguments,
                # module constants): no single test owns it
                out.setdefault(IMPORT_TIME, set()).add(line)
                continue
            nodeid = c.rsplit("|", 1)[0]
            tests.add(nodeid)
        if tests:
            out[line] = tests
    return out


IMPORT_TIME = -1  # key of load_line_map's set of import-time lines
MAX_SECONDS = 240  # per mutant run


def load_durations(junit: Path) -> dict[str, float]:
    if not junit.exists():
        return {}
    out = {}
    for case in ET.parse(junit).getroot().iter("testcase"):
        out[junit_nodeid(case)] = float(case.get("time", 0) or 0)
    return out


def junit_nodeid(case) -> str:
    """classname "tests.test_game.TestX" + name -> tests/test_game.py::TestX::name"""
    cls = case.get("classname", "")
    name = case.get("name", "")
    parts = cls.split(".")
    for i in range(len(parts), 0, -1):
        path = "/".join(parts[:i]) + ".py"
        if (BACKEND / path).exists():
            return "::".join([path] + parts[i:] + [name])
    return f"{cls}::{name}"


# --------------------------------------------------------------------------
# Running
# --------------------------------------------------------------------------


def make_workers(n: int, root: Path) -> list[Path]:
    workers = []
    for i in range(n):
        w = root / f"w{i}"
        if w.exists():
            shutil.rmtree(w)
        w.mkdir(parents=True)
        shutil.copytree(
            BACKEND,
            w / "backend",
            ignore=shutil.ignore_patterns(".pytest_cache", ".coverage*", "*.db"),
        )
        for entry in REPO.iterdir():
            if entry.name in ("backend", ".git"):
                continue
            (w / entry.name).symlink_to(entry)
        subprocess.run(
            [sys.executable, "-m", "compileall", "-q", str(w / "backend")],
            check=False,
            stdout=subprocess.DEVNULL,
        )
        workers.append(w)
    return workers


def failures_from_junit(path: Path) -> list[str]:
    if not path.exists():
        return []
    failed = []
    for case in ET.parse(path).getroot().iter("testcase"):
        if case.find("failure") is not None or case.find("error") is not None:
            failed.append(junit_nodeid(case))
    return failed


def run_mutant(
    worker: Path,
    module: str,
    original: str,
    mutant: dict,
    tests: list[str],
    durations: dict[str, float],
    matrix: bool,
    light_threshold: float,
) -> dict:
    """Run one mutant. In matrix mode the light tests (cheap unit tests) all
    run and every killer is recorded; the heavy ones (full games, fuzz) run
    with -x only if no light test killed the mutant."""
    target = worker / "backend" / module
    try:
        mutated = apply_mutant(original, mutant)
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "detail": f"apply failed: {exc}"}
    stem = target.stem

    def clear_pyc():
        for pyc in (target.parent / "__pycache__").glob(f"{stem}.*.pyc"):
            pyc.unlink()

    target.write_text(mutated)
    clear_pyc()
    try:
        if not matrix:
            return _pytest(worker, tests, durations, stop_first=True)
        light = [t for t in tests if durations.get(t, 0.5) < light_threshold]
        heavy = [t for t in tests if t not in set(light)]
        res = {"status": "survived", "seconds": 0.0, "killers": []}
        if light:
            res = _pytest(worker, light, durations, stop_first=False)
            res.setdefault("killers", [])
        if res["status"] == "survived" and heavy:
            r2 = _pytest(worker, heavy, durations, stop_first=True)
            r2["seconds"] = round(r2.get("seconds", 0) + res["seconds"], 1)
            r2["killers"] = r2.get("killers", [])
            r2["heavy_only"] = r2["status"] != "survived"
            res = r2
        return res
    finally:
        target.write_text(original)
        clear_pyc()


def _pytest(worker: Path, tests: list[str], durations, stop_first: bool) -> dict:
    # durations were measured under coverage (slower than a plain run); a
    # mutant that makes the selected tests take far longer is a hang
    timeout = min(30 + 3 * sum(durations.get(t, 0.5) for t in tests), MAX_SECONDS)
    junit = worker / "junit.xml"
    if junit.exists():
        junit.unlink()
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "-p",
        "no:randomly",
        "-p",
        "no:cacheprovider",
        "-p",
        "no:cov",
        "-p",
        "no:xdist",
        f"--junitxml={junit}",
    ]
    if stop_first:
        cmd.append("-x")
    cmd += tests
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    start = time.time()
    log = worker / "pytest.log"
    with open(log, "w") as fh:
        # own process group: on a timeout the whole tree is killed (a test's
        # child process must not keep the run alive)
        proc = subprocess.Popen(
            cmd,
            cwd=worker / "backend",
            env=env,
            stdout=fh,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            return {"status": "timeout", "seconds": round(time.time() - start, 1)}
    killers = failures_from_junit(junit)
    # rc 1: tests failed; other non-zero: collection/import error -> killed
    status = "survived" if proc.returncode == 0 else "killed"
    out = {"status": status, "seconds": round(time.time() - start, 1)}
    out["killers"] = killers
    if status == "killed" and not killers:
        out["detail"] = log.read_text()[-300:]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--module",
        action="append",
        default=[],
        help="backend-relative path, e.g. game/rules.py",
    )
    ap.add_argument("--out", type=Path, required=False)
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    ap.add_argument(
        "--matrix", action="store_true", help="record every killing test (slower)"
    )
    ap.add_argument(
        "--marker",
        default="not slow",
        help="pytest -m expression for the killing suite",
    )
    ap.add_argument(
        "--coverage", type=Path, help="existing coverage data file (with test contexts)"
    )
    ap.add_argument(
        "--sample", type=int, default=0, help="random sample of N mutants per module"
    )
    ap.add_argument(
        "--lines", default="", help="only mutants on these lines, e.g. 100-140,300"
    )
    ap.add_argument(
        "--rerun",
        type=Path,
        help="re-run the survivors listed in an earlier JSON result",
    )
    ap.add_argument(
        "--fallback-tests",
        default="",
        help="test paths (space separated) for mutants no test is mapped to",
    )
    ap.add_argument(
        "--ids",
        help="file with mutant ids (module#n, whitespace separated) to run",
    )
    ap.add_argument(
        "--status",
        default="survived",
        help="--rerun: which earlier statuses to run again (comma separated)",
    )
    ap.add_argument(
        "--workdir", type=Path, default=Path(tempfile.gettempdir()) / "acquire-mutation"
    )
    ap.add_argument("--list", action="store_true", help="only list mutants")
    ap.add_argument(
        "--light",
        type=float,
        default=0.1,
        help="--matrix: tests faster than this (s, under coverage) all run",
    )
    ap.add_argument(
        "--max-seconds",
        type=float,
        default=MAX_SECONDS,
        help="time limit per mutant run (raise it for the slow tier)",
    )
    args = ap.parse_args()
    globals()["MAX_SECONDS"] = args.max_seconds

    args.workdir.mkdir(parents=True, exist_ok=True)
    previous = None
    if args.rerun:
        previous = json.loads(args.rerun.read_text())
        args.module = sorted({m["module"] for m in previous["mutants"]})

    if not args.module:
        ap.error("--module (or --rerun) is required")

    cov_file = args.coverage or (
        args.workdir / f"coverage-{args.marker.replace(' ', '_')}"
    )
    if not args.list and not cov_file.exists():
        print(f"[mutation] building coverage map ({args.marker}) ...", flush=True)
        build_coverage(
            cov_file,
            args.marker,
            sorted({m.split("/")[0].removesuffix(".py") for m in args.module}),
        )
    durations = load_durations(cov_file.with_suffix(".junit.xml"))

    jobs = []
    for module in args.module:
        source = (BACKEND / module).read_text()
        mutants = enumerate_mutants(source)
        for i, m in enumerate(mutants):
            m["id"] = f"{module}#{i}"
            m["module"] = module
        if previous is not None:
            keep = {
                m["id"]
                for m in previous["mutants"]
                if m["module"] == module and m["status"] in args.status.split(",")
            }
            mutants = [m for m in mutants if m["id"] in keep]
        if args.ids:
            wanted_ids = set(Path(args.ids).read_text().split())
            mutants = [m for m in mutants if m["id"] in wanted_ids]
        if args.lines:
            wanted = set()
            for part in args.lines.split(","):
                a, _, b = part.partition("-")
                wanted.update(range(int(a), int(b or a) + 1))
            mutants = [m for m in mutants if m["line"] in wanted]
        if args.sample and len(mutants) > args.sample:
            import random

            mutants = sorted(
                random.Random(0).sample(mutants, args.sample), key=lambda m: m["line"]
            )
        if args.list:
            for m in mutants:
                print(f"{m['id']}\t{module}:{m['line']}\t{m['desc']}")
            continue
        line_map = load_line_map(cov_file, module)
        import_lines = line_map.get(IMPORT_TIME, set())
        for m in mutants:
            tests = set()
            for line in m["cover_lines"]:
                tests |= line_map.get(line, set())
            if not tests and args.fallback_tests:
                # code the coverage map cannot attribute to a test (e.g. the
                # server's background driver loop): run the given test files
                tests = set(args.fallback_tests.split())
                m["fallback_tests"] = True
            if not tests and import_lines & set(m["cover_lines"]):
                # an import-time line affects every test: run them all
                tests = set(durations)
                m["import_time"] = True
            m["tests"] = sorted(tests, key=lambda t: (durations.get(t, 0.5), t))
            jobs.append((module, source, m))
    if args.list:
        return 0

    print(f"[mutation] {len(jobs)} mutants, {args.workers} workers", flush=True)
    workers = make_workers(args.workers, args.workdir)
    free = list(workers)
    results = []
    import threading

    lock = threading.Lock()

    def job(item):
        module, source, m = item
        if not m["tests"]:
            return m, {"status": "uncovered"}
        with lock:
            w = free.pop()
        try:
            matrix = args.matrix and not m.get("import_time")
            return m, run_mutant(
                w, module, source, m, m["tests"], durations, matrix, args.light
            )
        finally:
            with lock:
                free.append(w)

    done = 0
    start = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(job, j) for j in jobs]
        for fut in as_completed(futures):
            m, res = fut.result()
            rec = {
                k: v
                for k, v in m.items()
                if k not in ("tests", "node", "variant", "cover_lines")
            }
            rec["n_tests"] = len(m["tests"])
            rec.update(res)
            results.append(rec)
            done += 1
            if done % 25 == 0 or done == len(jobs):
                el = time.time() - start
                print(f"[mutation] {done}/{len(jobs)} ({el:.0f}s)", flush=True)

    results.sort(key=lambda r: (r["module"], r["line"], r["id"]))
    summary = {}
    for r in results:
        s = summary.setdefault(
            r["module"],
            {
                "total": 0,
                "killed": 0,
                "timeout": 0,
                "survived": 0,
                "uncovered": 0,
                "error": 0,
            },
        )
        s["total"] += 1
        s[r["status"]] += 1
    for mod, s in summary.items():
        denom = s["total"] - s["error"]
        s["score"] = (
            round(100 * (s["killed"] + s["timeout"]) / denom, 1) if denom else 0.0
        )
        print(f"{mod}: {s}")
    out = {"marker": args.marker, "summary": summary, "mutants": results}
    if args.out:
        args.out.write_text(json.dumps(out, indent=1))
    for r in results:
        if r["status"] in ("survived", "uncovered"):
            print(f"  {r['status']:9} {r['module']}:{r['line']}  {r['desc']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

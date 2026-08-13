#!/usr/bin/env python3
"""Record exactly what a real Python analyzer says about the fixture corpus.

The Python pack's codes and patterns are derived from this output, not from memory. The first
version of that pack was written from recalled *traceback* text — `'NoneType' object has no
attribute 'strip'` — and would have matched nothing, because VS Code diagnostics come from Pylance,
Pylint and Ruff, none of which phrase anything that way. The tutor would simply have stayed silent,
which is the one failure mode nobody reports.

Run this whenever the corpus changes or the analyzers are upgraded:

    pip install pylint ruff pyright
    python3 scripts/capture-python-diagnostics.py > test/fixtures/python/diagnostics.json

`test/multilingual.test.ts` then asserts the pack still claims every diagnostic in here.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CORPUS = sorted((ROOT / "test/fixtures/python/corpus").glob("*.py"))

# Style and annotation rules are noise for this purpose: they say nothing about the concepts the
# pack teaches, and they churn with every analyzer release.
PYLINT_OFF = (
    "missing-module-docstring,missing-function-docstring,invalid-name,"
    "unused-variable,unused-argument,too-few-public-methods"
)
RUFF_OFF = "D,ANN,INP,T20,PLR,COM,I,ARG,RET,C901,S,PTH,EM,TRY,N,FBT,UP,RUF"


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def main():
    if not CORPUS:
        print("no corpus files found", file=sys.stderr)
        return 1

    out = []

    # pylint. microsoft/vscode-pylint builds its LSP diagnostic with
    # `code=f"{msg_id}:{data.get('symbol')}"`, so that composite is what actually reaches us.
    raw = run(
        [sys.executable, "-m", "pylint", "--output-format=json", "--disable=" + PYLINT_OFF]
        + [str(p) for p in CORPUS]
    )
    for m in json.loads(raw or "[]"):
        out.append(
            {
                "analyzer": "pylint",
                "file": pathlib.Path(m["path"]).name,
                "code": "{}:{}".format(m["message-id"], m["symbol"]),
                "message": m["message"],
            }
        )

    # ruff sends the rule code, e.g. F823.
    raw = run(
        [
            "ruff", "check", "--no-cache", "--select", "ALL", "--ignore", RUFF_OFF,
            "--output-format", "json",
        ]
        + [str(p) for p in CORPUS]
    )
    for m in json.loads(raw or "[]"):
        out.append(
            {
                "analyzer": "ruff",
                "file": pathlib.Path(m["filename"]).name,
                "code": m["code"],
                "message": m["message"],
            }
        )

    # pyright is Pylance's engine, and sends the rule name as the code.
    raw = run(["pyright", "--outputjson"] + [str(p) for p in CORPUS])
    start = raw.find("{")
    if start >= 0:
        for m in json.loads(raw[start:]).get("generalDiagnostics", []):
            out.append(
                {
                    "analyzer": "pyright",
                    "file": pathlib.Path(m["file"]).name,
                    "code": m.get("rule", ""),
                    "message": m["message"].splitlines()[0],
                }
            )

    out.sort(key=lambda r: (r["file"], r["analyzer"], r["code"], r["message"]))

    # Versions travel with the capture. Analyzer wording changes between releases, and a fixture
    # that silently describes a three-year-old Pylint is the same failure as one written from
    # memory — just slower to notice.
    versions = {
        "python": sys.version.split()[0],
        "pylint": run([sys.executable, "-m", "pylint", "--version"]).splitlines()[0].strip(),
        "ruff": run(["ruff", "--version"]).strip(),
        # pyright prints an upgrade nag before its version; keep the last line only.
        "pyright": run(["pyright", "--version"]).strip().splitlines()[-1].strip(),
    }
    print(json.dumps({"capturedWith": versions, "diagnostics": out}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

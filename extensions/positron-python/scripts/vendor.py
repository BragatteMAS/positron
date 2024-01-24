#
#   Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import json
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

# This file adapts code extracted from the MIT-licensed `vendoring` Python package:
# https://github.com/pradyunsg/vendoring.


def main() -> None:
    project_path = Path()

    print(f"Working in {project_path.absolute()}")

    cfg = Configuration(
        base_directory=project_path,
        destination=Path("pythonFiles/positron/_vendor/"),
        namespace="positron._vendor",
        requirements=Path("pythonFiles/jedilsp_requirements/requirements.txt"),
        patches_dir=Path("scripts/patches"),
        substitutions=[
            # Fix pygments.lexers._mapping strings, via: https://github.com/pypa/pip/blob/main/pyproject.toml
            {
                "match": r"\('pygments\.lexers\.",
                "replace": r"('positron._vendor.pygments.lexers.",
            }
        ],
    )

    print("Clean existing libraries")
    if cfg.destination.exists():
        # Remove existing libraries in the destination dir.
        for item in cfg.destination.iterdir():
            # Exclude the requirements file.
            if item == cfg.requirements:
                continue
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item)
            else:
                item.unlink()

    print("Download vendored libraries")
    # Note that we use flags for secure and reproducible installs, via: https://github.com/brettcannon/pip-secure-install.
    run(
        [
            "python3",
            "-m",
            "pip",
            "install",
            "-t",
            str(cfg.destination),
            "--no-cache-dir",
            "--implementation",
            "py",
            "--no-deps",
            "--require-hashes",
            "--only-binary",
            ":all:",
            "-r",
            str(cfg.requirements),
        ],
    )

    # Detect what got downloaded.
    vendored_libs = detect_vendored_libs(cfg.destination)

    # Apply user provided patches.
    if cfg.patches_dir:
        print("Apply patches")
        for patch_file in cfg.patches_dir.glob("*.patch"):
            run(
                [
                    "git",
                    "apply",
                    # TODO(seem): I couldn't find any other way to get git to apply our patches
                    # on Windows, even though neither the patch/patched files have CRLF line endings.
                    # Hopefully this doesn't cause any incorrect matches since whitespaces are part
                    # of Python's syntax.
                    "--ignore-whitespace",
                    "--verbose",
                    str(patch_file),
                ],
                cwd=cfg.base_directory,
            )

    # Rewrite the imports to reference the parent namespace.
    print("Rewrite imports")
    rewrite_imports(
        cfg.destination,
        cfg.namespace,
        vendored_libs,
        cfg.substitutions,
    )


class VendoringError(Exception):
    """Errors originating from this package."""


@dataclass
class Configuration:
    # Base directory for all of the operation of this project
    base_directory: Path

    # Location to unpack into
    destination: Path

    # Final namespace to rewrite imports to originate from
    namespace: str

    # Path to a pip-style requirement files
    requirements: Path

    # Location to ``.patch` files to apply after vendoring
    patches_dir: Optional[Path]

    # Additional substitutions, done in addition to import rewriting
    substitutions: List[Dict[str, str]]


def run(args: List[str], cwd: Optional[str] = None) -> None:
    # This function is mainly to stream stdout/stderr to the terminal.
    cmd = " ".join(map(shlex.quote, args))
    print(f"Running {cmd}")
    p = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        cwd=cwd,
    )
    assert p.stdout  # make mypy happy
    while True:
        retcode = p.poll()
        line = p.stdout.readline().rstrip()

        if line:
            print(line)

        if retcode is not None:
            break
    if retcode:
        raise VendoringError(f"Command exited with non-zero exit code: {retcode}")


def detect_vendored_libs(destination: Path) -> List[str]:
    vendored_libs = []
    for item in destination.iterdir():
        if item.is_dir():
            vendored_libs.append(item.name)
        else:
            if not item.name.endswith(".py"):
                print(f"Got unexpected non-Python file: {item}")
                continue
            vendored_libs.append(item.name[:-3])
    return vendored_libs


def rewrite_imports(
    destination: Path,
    namespace: str,
    vendored_libs: List[str],
    substitutions: List[Dict[str, str]],
) -> None:
    for item in destination.iterdir():
        if item.is_dir():
            rewrite_imports(item, namespace, vendored_libs, substitutions)
        elif item.name.endswith(".py"):
            rewrite_file_imports(item, namespace, vendored_libs, substitutions)


def rewrite_file_imports(
    item: Path,
    namespace: str,
    vendored_libs: List[str],
    substitutions: List[Dict[str, str]],
) -> None:
    """Rewrite 'import xxx' and 'from xxx import' for vendored_libs."""

    text = item.read_text(encoding="utf-8")

    # Configurable rewriting of lines.
    for di in substitutions:
        pattern, substitution = di["match"], di["replace"]
        # TODO: Should this be multiline?
        text = re.sub(pattern, substitution, text)

    # If an empty namespace is provided, we don't rewrite imports.
    if namespace != "":
        for lib in vendored_libs:
            # Normal case "import a"
            text = re.sub(
                rf"^(\s*)import {lib}(\s|$)",
                rf"\1from {namespace} import {lib}\2",
                text,
                flags=re.MULTILINE,
            )
            # Special case "import a.b as b"
            text = re.sub(
                rf"^(\s*)import {lib}(\.\S+)(?=\s+as)",
                rf"\1import {namespace}.{lib}\2",
                text,
                flags=re.MULTILINE,
            )

            # Error on "import a.b": this cannot be rewritten
            # (except for the special case handled above)
            match = re.search(
                rf"^\s*(import {lib}\.\S+)",
                text,
                flags=re.MULTILINE,
            )
            if match:
                line_number = text.count("\n", 0, match.start()) + 1
                raise VendoringError(
                    "Encountered import that cannot be transformed for a namespace.\n"
                    f'File "{item}", line {line_number}\n'
                    f"  {match.group(1)}\n"
                    "\n"
                    "You will need to add a patch, that adapts the code to avoid a "
                    "`import dotted.name` style import here; since those cannot be "
                    "transformed for importing via a namespace."
                )

            # Normal case "from a import b"
            text = re.sub(
                rf"^(\s*)from {lib}(\.|\s)",
                rf"\1from {namespace}.{lib}\2",
                text,
                flags=re.MULTILINE,
            )

    item.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()

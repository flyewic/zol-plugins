#!/usr/bin/env python3
"""Reject obvious catalog mistakes. The editor parser stays the authority."""

import os
import subprocess
import sys

MAX_FILE = 256 * 1024
MAX_FILES = 32
MAX_DEPTH = 8
ALLOWED_MODES = {"100644", "100755"}
EXACT_NAMES = {"LICENSE", "README", "README.md"}
SUFFIXES = (".js", ".kdl", ".md")


def fail(message):
    print(f"check: {message}", file=sys.stderr)
    raise SystemExit(1)


def git_bytes(args):
    return subprocess.check_output(["git", *args])


def decode_git_path(path):
    if len(path) < 2 or path[0] != '"' or path[-1] != '"':
        return path
    body = path[1:-1]
    out = []
    i = 0
    while i < len(body):
        if body[i] != "\\":
            out.append(body[i])
            i += 1
            continue
        i += 1
        if i >= len(body):
            break
        c = body[i]
        i += 1
        if c == "n":
            out.append("\n")
        elif c == "t":
            out.append("\t")
        elif c == "\\":
            out.append("\\")
        elif c == '"':
            out.append('"')
        elif c.isdigit():
            octal = c
            while len(octal) < 3 and i < len(body) and body[i].isdigit():
                octal += body[i]
                i += 1
            out.append(chr(int(octal, 8)))
        else:
            out.append(c)
    return "".join(out)


def listed_files():
    raw = git_bytes(["ls-files", "-s"]).decode("utf-8", "surrogateescape")
    rows = []
    for line in raw.splitlines():
        if "\t" not in line:
            fail(f"unexpected git ls-files line: {line}")
        meta, path = line.split("\t", 1)
        parts = meta.split(" ")
        if len(parts) != 3:
            fail(f"unexpected git ls-files line: {line}")
        mode, obj, _stage = parts
        rows.append((mode, obj, decode_git_path(path)))
    return rows


def depth_of(rel):
    # Same count as the installer: plugin.kdl has no slash and is depth 1.
    return 1 + rel.count("/")


def allowed_name(base):
    if base in EXACT_NAMES:
        return True
    return base.endswith(SUFFIXES)


def blob_size(obj):
    return int(git_bytes(["cat-file", "-s", obj]).strip())


def blob_bytes(obj):
    return git_bytes(["cat-file", "-p", obj])


class Node:
    def __init__(self, name, args, children):
        self.name = name
        self.args = args
        self.children = children


class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.i = 0

    def peek(self):
        if self.i >= len(self.tokens):
            return None
        return self.tokens[self.i]

    def skip_breaks(self):
        while self.peek() in ("\n", ";"):
            self.i += 1

    def parse_document(self):
        nodes = []
        while True:
            self.skip_breaks()
            if self.peek() is None:
                return nodes
            nodes.append(self.parse_node())

    def parse_node(self):
        name = self.take_ident()
        args = []
        children = []
        while True:
            tok = self.peek()
            if tok is None or tok in ("\n", ";", "}"):
                if tok in ("\n", ";"):
                    self.i += 1
                return Node(name, args, children)
            if tok == "{":
                self.i += 1
                children = self.parse_children()
                if self.peek() != "}":
                    fail("unclosed '{'")
                self.i += 1
                if self.peek() in ("\n", ";"):
                    self.i += 1
                return Node(name, args, children)
            if tok == "=":
                fail("property is missing a name")
            if isinstance(tok, tuple) and tok[0] == "ident" and self.lookahead_eq():
                self.i += 1
                self.i += 1  # '='
                self.parse_value()
                continue
            args.append(self.parse_value())

    def parse_children(self):
        nodes = []
        while True:
            self.skip_breaks()
            tok = self.peek()
            if tok is None or tok == "}":
                return nodes
            nodes.append(self.parse_node())

    def lookahead_eq(self):
        return self.i + 1 < len(self.tokens) and self.tokens[self.i + 1] == "="

    def take_ident(self):
        tok = self.peek()
        # KDL node names may be quoted strings. `depends { "ai-kit" "^0.1.0" }`
        # uses one; the editor parser accepts it, so the gate must too.
        if not isinstance(tok, tuple) or tok[0] not in ("ident", "string"):
            fail(f"expected a node name, got {tok!r}")
        self.i += 1
        return tok[1]

    def parse_value(self):
        tok = self.peek()
        if tok is None:
            fail("expected a value")
        self.i += 1
        if tok in ("{", "}", "=", "\n", ";"):
            fail(f"expected a value, got {tok!r}")
        return tok


def strip_comments(text):
    out = []
    i = 0
    n = len(text)
    in_string = False
    escape = False
    while i < n:
        c = text[i]
        if in_string:
            out.append(c)
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            if i + 1 >= n:
                fail("unclosed block comment")
            i += 2
            continue
        out.append(c)
        i += 1
    if in_string:
        fail("unterminated string")
    return "".join(out)


def tokenize(text):
    tokens = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c in " \t\r":
            i += 1
            continue
        if c == "\n":
            tokens.append("\n")
            i += 1
            continue
        if c in "{}=;":
            tokens.append(c)
            i += 1
            continue
        if c == '"':
            i += 1
            buf = []
            while i < n:
                if text[i] == "\\":
                    i += 1
                    if i >= n:
                        fail("unterminated string")
                    esc = text[i]
                    buf.append({"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"'}.get(esc, esc))
                    i += 1
                    continue
                if text[i] == '"':
                    i += 1
                    break
                buf.append(text[i])
                i += 1
            else:
                fail("unterminated string")
            tokens.append(("string", "".join(buf)))
            continue
        if c == "-" or c.isdigit():
            j = i + 1 if c == "-" else i
            if c == "-" and (j >= n or not text[j].isdigit()):
                fail(f"unexpected {c!r}")
            while j < n and text[j].isdigit():
                j += 1
            # KDL numbers may carry a fraction and/or exponent. The gate only
            # reads id/version strings, but it still tokenizes the rest of the
            # manifest, and AI settings use floats (temperature 0.2).
            is_float = False
            if j < n and text[j] == ".":
                is_float = True
                j += 1
                while j < n and text[j].isdigit():
                    j += 1
            if j < n and text[j] in ("e", "E"):
                is_float = True
                j += 1
                if j < n and text[j] in ("+", "-"):
                    j += 1
                while j < n and text[j].isdigit():
                    j += 1
            raw = text[i:j]
            tokens.append(("float", float(raw)) if is_float else ("int", int(raw)))
            i = j
            continue
        if c == "#":
            j = i + 1
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            tokens.append(("hash", text[i:j]))
            i = j
            continue
        if c.isalpha() or c == "_":
            j = i + 1
            while j < n and (text[j].isalnum() or text[j] in "_-"):
                j += 1
            tokens.append(("ident", text[i:j]))
            i = j
            continue
        fail(f"unexpected {c!r} in KDL")
    return tokens


def parse_kdl(text):
    return Parser(tokenize(strip_comments(text))).parse_document()


def string_arg(node, label):
    if not node.args or node.args[0][0] != "string":
        fail(f"{label} must be a string")
    return node.args[0][1]


def child_string(node, name, label):
    found = None
    for child in node.children:
        if child.name != name:
            continue
        if found is not None:
            fail(f"duplicate {name} in {label}")
        found = string_arg(child, f"{label} {name}")
    return found


def manifest_id_version(text, label):
    doc = parse_kdl(text)
    found_id = None
    found_version = None
    for node in doc:
        if node.name == "id" and found_id is None:
            found_id = string_arg(node, f"{label} id")
        elif node.name == "version" and found_version is None:
            found_version = string_arg(node, f"{label} version")
    if found_id is None or found_version is None:
        fail(f"{label}: id/version mismatch")
    return found_id, found_version


def index_rows(text):
    doc = parse_kdl(text)
    saw_format = False
    rows = []
    seen = set()
    for node in doc:
        if node.name == "format":
            if saw_format:
                fail("duplicate format")
            if len(node.args) != 1 or node.args[0][0] != "int" or node.args[0][1] != 1:
                fail("format must be the integer 1")
            saw_format = True
            continue
        if node.name != "plugin":
            continue
        if len(node.args) < 1 or node.args[0][0] != "string":
            fail("plugin id must be a string")
        pid = node.args[0][1]
        if pid in seen:
            fail(f"duplicate plugin id {pid}")
        seen.add(pid)
        path = child_string(node, "path", pid)
        version = child_string(node, "version", pid)
        if path != f"plugins/{pid}":
            fail(f"index path not plugins/{pid}")
        if version is None:
            fail(f"{pid}: id/version mismatch")
        rows.append((pid, version))
    if not saw_format:
        fail("format is missing")
    return rows


def check_plugins(by_path):
    groups = {}
    for path in by_path:
        if not path.startswith("plugins/"):
            continue
        rest = path[len("plugins/") :]
        if "/" not in rest or rest.startswith("/") or rest.endswith("/"):
            fail(f"{path}: not inside a plugin directory")
        pid, rel = rest.split("/", 1)
        if not pid or pid in (".", "..") or pid.startswith(".") or "/" in pid:
            fail(f"{path}: bad plugin id")
        if rel == "" or rel.startswith("/") or "//" in rel:
            fail(f"{path}: bad path")
        for part in rel.split("/"):
            if part in ("", ".", "..") or part.startswith("."):
                fail(f"{path}: bad path")
            if any(ch in part for ch in "\\?#%"):
                fail(f"{path}: bad path")
        if depth_of(rel) > MAX_DEPTH:
            fail(f"{path}: depth exceeds 8")
        if not allowed_name(part):
            fail(f"{path}: file name is not allowed")
        groups.setdefault(pid, []).append(rel)
    for pid, rels in groups.items():
        if len(rels) > MAX_FILES:
            fail(f"plugins/{pid}: more than 32 files")
        if "plugin.kdl" not in rels:
            fail(f"plugins/{pid}: missing plugin.kdl")
    return groups


def main():
    try:
        root = git_bytes(["rev-parse", "--show-toplevel"]).decode().strip()
    except subprocess.CalledProcessError:
        fail("not a git checkout")
    os.chdir(root)

    rows = listed_files()
    by_path = {}
    for mode, obj, path in rows:
        if mode == "120000":
            fail(f"{path}: symlink")
        if mode not in ALLOWED_MODES:
            fail(f"{path}: mode {mode}")
        full = os.path.join(root, path)
        if os.path.islink(full):
            fail(f"{path}: symlink")
        if blob_size(obj) > MAX_FILE:
            fail(f"{path}: file is over 256 KiB")
        by_path[path] = obj

    groups = check_plugins(by_path)
    if "index.kdl" not in by_path:
        fail("index.kdl is missing")
    index_blob = blob_bytes(by_path["index.kdl"])
    if b"://" in index_blob:
        fail("index.kdl contains ://")
    try:
        index_text = index_blob.decode("utf-8")
    except UnicodeDecodeError:
        fail("index.kdl: not utf-8")
    listed = index_rows(index_text)
    indexed = {pid: version for pid, version in listed}
    for pid in groups:
        if pid not in indexed:
            fail(f"index.kdl has no row whose path is plugins/{pid}")
    for pid, version in listed:
        manifest_path = f"plugins/{pid}/plugin.kdl"
        if manifest_path not in by_path:
            fail(f"plugins/{pid}: missing plugin.kdl")
        try:
            manifest_text = blob_bytes(by_path[manifest_path]).decode("utf-8")
        except UnicodeDecodeError:
            fail(f"plugins/{pid}: id/version mismatch")
        mid, mver = manifest_id_version(manifest_text, f"plugins/{pid}/plugin.kdl")
        if mid != pid or mver != version:
            fail(f"plugins/{pid}: id/version mismatch")


if __name__ == "__main__":
    main()

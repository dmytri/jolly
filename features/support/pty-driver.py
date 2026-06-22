#!/usr/bin/env python3
# Real-PTY driver for the interactive-terminal login scenario (feature 018).
#
# Node has no openpty and the harness does not ship node-pty, so the one POSIX
# way to give the CLI a genuine controlling terminal on stdin is to allocate a
# PTY out-of-process. This is NOT a mock of the terminal: it is a real kernel
# PTY. The CLI under test sees `process.stdin.isTTY === true`, prints its prompt
# to the terminal, disables echo, and reads the pasted line from the tty exactly
# as it would for a human at a keyboard.
#
# Config (a JSON file path in argv[1]):
#   runtime      str            the executable to run (e.g. "node")
#   argv         list[str]      args after the runtime (CLI entry + flags)
#   cwd          str            working directory for the child
#   env          dict[str,str]  full child environment
#   input        str            the bytes "pasted" at the prompt (newline added)
#   inputDelayMs int            wait before pasting, so the prompt is shown first
#   timeoutMs    int            overall cap; the child is killed past it
#
# The child's stdin/stdout/stderr are all the PTY slave, so everything the user
# would see on the terminal is captured from the master and written verbatim to
# this process's stdout. The driver itself prints nothing else. Exit code is the
# child's.
import json
import os
import pty
import select
import subprocess
import sys
import time

cfg = json.load(open(sys.argv[1]))
argv = [cfg["runtime"], *cfg["argv"]]
paste = (cfg["input"] + "\n").encode()
input_delay = cfg.get("inputDelayMs", 300) / 1000.0
timeout = cfg.get("timeoutMs", 30000) / 1000.0

master, slave = pty.openpty()
child = subprocess.Popen(
    argv,
    stdin=slave,
    stdout=slave,
    stderr=slave,
    cwd=cfg["cwd"],
    env=cfg["env"],
    close_fds=True,
)
os.close(slave)

# Let the prompt appear, then paste the token as a human would.
time.sleep(input_delay)
try:
    os.write(master, paste)
except OSError:
    pass

out = bytearray()
deadline = time.time() + timeout
while True:
    remaining = deadline - time.time()
    if remaining <= 0:
        child.kill()
        break
    try:
        readable, _, _ = select.select([master], [], [], min(0.5, remaining))
    except OSError:
        break
    if readable:
        try:
            chunk = os.read(master, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    if child.poll() is not None and not select.select([master], [], [], 0)[0]:
        break

try:
    code = child.wait(timeout=2)
except subprocess.TimeoutExpired:
    child.kill()
    code = child.wait()

os.write(1, bytes(out))
sys.exit(code if code is not None else -1)

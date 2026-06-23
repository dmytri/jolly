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
import base64
import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import threading
import time

cfg = json.load(open(sys.argv[1]))
argv = [cfg["runtime"], *cfg["argv"]]
# Two input modes. `input` (single string) pastes one line, newline appended —
# the token-paste login path. `inputs` (list of strings) sends a scripted
# sequence verbatim, one chunk per prompt with a delay between each — the
# interactive `jolly start` walk-through (e.g. ["\r","\r","\r"] presses Enter at
# every prompt; "n" declines a confirm). Each chunk is written exactly as given.
if "inputs" in cfg:
    sends = [chunk.encode() for chunk in cfg["inputs"]]
else:
    # Append a carriage return — the byte a real terminal sends for Enter, and
    # the one raw-mode prompt readers (Bombshell/@clack/prompts) treat as submit.
    sends = [(cfg["input"] + "\r").encode()]
input_delay = cfg.get("inputDelayMs", 300) / 1000.0
timeout = cfg.get("timeoutMs", 30000) / 1000.0

# A real window size for every PTY. Without it the terminal reports 0 columns and
# full-screen renderers (Bombshell/@clack/prompts) wrap after every character,
# shattering the prompt text in the captured stream.
WINSZ = struct.pack("HHHH", 24, 80, 0, 0)


def feed_inputs(master_fd, sends_seq):
    # Drive the prompts as a human would: wait for each prompt to render, then
    # send the next scripted chunk. A write past child exit fails harmlessly.
    for chunk in sends_seq:
        time.sleep(input_delay)
        try:
            os.write(master_fd, chunk)
        except OSError:
            return


# --- Separate-streams mode (feature 020 progress contract) -----------------
# Allocate THREE real PTYs so the child sees an interactive terminal on each of
# stdin, stdout, and stderr (every `isTTY` true) while the driver captures stdout
# and stderr SEPARATELY. The single merged-PTY mode below cannot distinguish the
# two streams, but the progress contract asserts in-place progress on stderr and
# a clean stdout. stdin is its own PTY so input-keystroke echo never lands in the
# captured stdout. Result is a JSON object on fd 1: base64 stdout/stderr + code.
if cfg.get("separateStreams"):
    in_master, in_slave = pty.openpty()
    out_master, out_slave = pty.openpty()
    err_master, err_slave = pty.openpty()
    for s in (in_slave, out_slave, err_slave):
        fcntl.ioctl(s, termios.TIOCSWINSZ, WINSZ)
    # Disable ONLCR on the CAPTURED streams so a bare `\n` is NOT translated to
    # `\r\n`. The captured stdout/stderr then match exactly what a pipe would see
    # — the contract is "piping stdout stays clean" — so a `\r` in the capture is
    # a genuine in-place redraw, not a line ending. (stdin keeps defaults; its
    # echo is never captured.)
    for s in (out_slave, err_slave):
        attrs = termios.tcgetattr(s)
        attrs[1] &= ~termios.ONLCR  # oflag
        termios.tcsetattr(s, termios.TCSANOW, attrs)
    child = subprocess.Popen(
        argv,
        stdin=in_slave,
        stdout=out_slave,
        stderr=err_slave,
        cwd=cfg["cwd"],
        env=cfg["env"],
        close_fds=True,
    )
    for s in (in_slave, out_slave, err_slave):
        os.close(s)
    threading.Thread(target=feed_inputs, args=(in_master, sends), daemon=True).start()

    bufs = {out_master: bytearray(), err_master: bytearray()}
    open_fds = set(bufs)
    deadline = time.time() + timeout
    while open_fds:
        remaining = deadline - time.time()
        if remaining <= 0:
            child.kill()
            break
        try:
            readable, _, _ = select.select(list(open_fds), [], [], min(0.5, remaining))
        except OSError:
            break
        for fd in readable:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                chunk = b""
            if not chunk:
                open_fds.discard(fd)
            else:
                bufs[fd] += chunk
    try:
        code = child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        child.kill()
        code = child.wait()
    os.write(
        1,
        json.dumps(
            {
                "out": base64.b64encode(bytes(bufs[out_master])).decode(),
                "err": base64.b64encode(bytes(bufs[err_master])).decode(),
                "code": code if code is not None else -1,
            }
        ).encode(),
    )
    sys.exit(0)

master, slave = pty.openpty()
# Give the PTY a real window size. Without it the terminal reports 0 columns and
# full-screen prompt renderers (Bombshell/@clack/prompts) wrap after every
# character, shattering the prompt text in the captured stream.
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
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

# Drive the prompts as a human would (shared with the separate-streams mode):
# wait for each prompt to render, then send the next scripted chunk.
threading.Thread(target=feed_inputs, args=(master, sends), daemon=True).start()

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

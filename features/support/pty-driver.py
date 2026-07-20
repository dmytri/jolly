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
#   readUntil    "exit"|list    what ENDS the read (see below)
#   timeoutMs    int            failure ceiling; a read still unfinished past it
#                               is reported as timedOut, never as a result
#
# The child's stdin/stdout/stderr are all the PTY slave, so everything the user
# would see on the terminal is captured from the master. The driver writes one
# JSON object to fd 1: base64 output (and, in separate-streams mode, base64
# stdout/stderr), the child's exit code, whether the child was still running when
# the read ended, and whether the ceiling fired.
import base64
import fcntl
import json
import os
import pty
import re
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

# Optional prompt-aware (marker) feeding. A fixed input cadence assumes each
# prompt has rendered by its scheduled time — true only when prompt timing is
# deterministic (stand-in creds, mocked org resolution). A REAL `jolly start`
# run has network gaps of unknown length BEFORE each prompt (org resolution,
# store provisioning), so a fixed cadence sends keystrokes before the prompt
# renders and they are lost. When `waitFor` is provided (one marker substring
# per input chunk), each chunk is sent only AFTER its prompt marker appears in
# the captured output — so a human-speed, prompt-synchronized walk-through drives
# a genuinely-completing interactive run. A null/empty marker for a chunk falls
# back to the fixed `inputDelayMs` cadence for that chunk.
wait_for = cfg.get("waitFor")
settle = cfg.get("settleMs", 250) / 1000.0
per_chunk_timeout = cfg.get("perChunkTimeoutMs", 180000) / 1000.0

# What ENDS the read. A read ended by the overall `timeoutMs` returns whatever the
# terminal happened to have produced by then: the wait is paid in full on every
# run, and the capture is whatever the timer caught rather than what the caller
# asserts on. So the caller declares the read's ending signal.
#   "exit"  the child completes on its own; the read ends at EOF on the PTY.
#   [str]   the output the caller asserts on; the read ends the moment EVERY
#           marker has appeared in the terminal, and the child is then terminated.
# `timeoutMs` is the failure ceiling in both modes: when it fires before the read
# has ended, the run is reported as timed out and fails loudly.
read_until = cfg.get("readUntil", "exit")
read_markers = [m.encode() for m in read_until] if isinstance(read_until, list) else []

# Shared, lock-guarded view of everything captured so far, so the feeder thread
# can watch for prompt markers while the main thread reads the PTY. ANSI control
# sequences are stripped before matching so a styled prompt still matches a plain
# marker substring.
_ANSI_RE = re.compile(rb"\x1b\[[0-9;?]*[ -/]*[@-~]")
_captured = bytearray()
_captured_lock = threading.Lock()


def note_output(chunk):
    if not wait_for and not read_markers:
        return
    with _captured_lock:
        _captured.extend(chunk)


def read_ended():
    """True once every `readUntil` marker has appeared in the captured output —
    the read is ended by the output the caller asserts on, not by a timer."""
    if not read_markers:
        return False
    with _captured_lock:
        text = _ANSI_RE.sub(b"", bytes(_captured))
    return all(marker in text for marker in read_markers)


def wait_for_marker(marker, search_from):
    """Block until `marker` (bytes) appears in the captured output past
    `search_from`; return the index just after it, or send anyway after the
    per-chunk cap so a missing prompt cannot hang the run forever."""
    start = time.time()
    while True:
        with _captured_lock:
            text = _ANSI_RE.sub(b"", bytes(_captured))
        idx = text.find(marker, search_from)
        if idx != -1:
            return idx + len(marker)
        if time.time() - start > per_chunk_timeout:
            return search_from
        time.sleep(0.05)

def finish(child):
    """Settle the child and report whether it was PARKED, not merely unreaped.

    `stillRunning` answers "was the run parked at the output it was read for, or
    did it end on its own". In `readUntil="exit"` mode the read ends at EOF on the
    PTY, and EOF arrives when the slave closes — a moment BEFORE the exiting child
    is reaped. Sampling poll() there reports a process that is already leaving as
    still running, so a scenario asserting the CLI exits itself reds on the
    sampling instant rather than on the CLI. Wait for the exit that EOF already
    announced, bounded, and treat only a child that outlasts that wait as parked.
    In marker mode the caller ends the read deliberately while the child is
    expected to still be there, so the immediate sample IS the answer.
    """
    if read_until == "exit":
        try:
            return child.wait(timeout=5), False
        except subprocess.TimeoutExpired:
            child.kill()
            return child.wait(), True
    still = child.poll() is None
    if still:
        child.kill()
    try:
        return child.wait(timeout=2), still
    except subprocess.TimeoutExpired:
        child.kill()
        return child.wait(), still


def acquire_controlling_terminal():
    """Make the child's stdin PTY its CONTROLLING terminal, in a new session.

    Without this the slave fd is merely an open file to the child: the line
    discipline has no foreground process group to signal, so the INTR character
    (`\\x03`, Ctrl-C) is echoed as `^C` and generates no SIGINT. A scenario that
    interrupts the CLI would then observe the UNINTERRUPTED run and assert
    against it. `start_new_session=True` alone is not enough — Python calls
    setsid() without TIOCSCTTY, and a session leader with no controlling
    terminal signals nothing. Runs in the child after the fds are dup'd, so fd 0
    is the PTY slave.
    """
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


# A real window size for every PTY. Without it the terminal reports 0 columns and
# full-screen renderers (Bombshell/@clack/prompts) wrap after every character,
# shattering the prompt text in the captured stream.
WINSZ = struct.pack("HHHH", 24, 80, 0, 0)


def feed_inputs(master_fd, sends_seq):
    # Drive the prompts as a human would: wait for each prompt to render, then
    # send the next scripted chunk. A write past child exit fails harmlessly.
    # With `waitFor`, gate each chunk on its prompt marker (prompt-synchronized);
    # otherwise use the fixed `inputDelayMs` cadence.
    search_from = 0
    for i, chunk in enumerate(sends_seq):
        marker = wait_for[i] if wait_for and i < len(wait_for) else None
        if marker:
            search_from = wait_for_marker(marker.encode(), search_from)
            time.sleep(settle)  # let the prompt finish rendering and enter raw mode
        else:
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
        preexec_fn=acquire_controlling_terminal,
    )
    for s in (in_slave, out_slave, err_slave):
        os.close(s)
    threading.Thread(target=feed_inputs, args=(in_master, sends), daemon=True).start()

    bufs = {out_master: bytearray(), err_master: bytearray()}
    open_fds = set(bufs)
    deadline = time.time() + timeout
    timed_out = False
    while open_fds:
        remaining = deadline - time.time()
        if remaining <= 0:
            timed_out = True
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
                note_output(chunk)
        if read_ended():
            break
    code, still_running = finish(child)
    os.write(
        1,
        json.dumps(
            {
                "out": base64.b64encode(bytes(bufs[out_master])).decode(),
                "err": base64.b64encode(bytes(bufs[err_master])).decode(),
                "code": code if code is not None else -1,
                "stillRunning": still_running,
                "timedOut": timed_out,
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
    preexec_fn=acquire_controlling_terminal,
)
os.close(slave)

# Drive the prompts as a human would (shared with the separate-streams mode):
# wait for each prompt to render, then send the next scripted chunk.
threading.Thread(target=feed_inputs, args=(master, sends), daemon=True).start()

out = bytearray()
deadline = time.time() + timeout
timed_out = False
while True:
    remaining = deadline - time.time()
    if remaining <= 0:
        timed_out = True
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
        note_output(chunk)
    if read_ended():
        break
    if child.poll() is not None and not select.select([master], [], [], 0)[0]:
        break

code, still_running = finish(child)

os.write(
    1,
    json.dumps(
        {
            "out": base64.b64encode(bytes(out)).decode(),
            "code": code if code is not None else -1,
            "stillRunning": still_running,
            "timedOut": timed_out,
        }
    ).encode(),
)
sys.exit(0)

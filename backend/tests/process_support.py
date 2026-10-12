"""Stop owned test processes before removing Windows executable fixtures."""

from __future__ import annotations

import ctypes
import os
import subprocess
import tempfile
import time
from contextlib import contextmanager
from ctypes import wintypes


class _ProcessEntry(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


def _windows_api():
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateToolhelp32Snapshot": ([wintypes.DWORD, wintypes.DWORD], wintypes.HANDLE),
        "Process32FirstW": ([wintypes.HANDLE, ctypes.POINTER(_ProcessEntry)], wintypes.BOOL),
        "Process32NextW": ([wintypes.HANDLE, ctypes.POINTER(_ProcessEntry)], wintypes.BOOL),
        "OpenProcess": ([wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
        "WaitForSingleObject": ([wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
        "CloseHandle": ([wintypes.HANDLE], wintypes.BOOL),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(api, name)
        function.argtypes = arguments
        function.restype = result
    return api


def _descendant_pids(parents: dict[int, int], root: int) -> list[int]:
    descendants = {root}
    while True:
        children = {pid for pid, parent in parents.items() if parent in descendants}
        if children.issubset(descendants):
            return sorted(descendants - {root})
        descendants.update(children)


@contextmanager
def _windows_descendants(root: int):
    """Capture wait handles before termination can orphan/reuse child PIDs."""
    api = _windows_api()
    snapshot = api.CreateToolhelp32Snapshot(0x00000002, 0)  # TH32CS_SNAPPROCESS
    if snapshot == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    parents: dict[int, int] = {}
    try:
        entry = _ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        found = api.Process32FirstW(snapshot, ctypes.byref(entry))
        while found:
            parents[entry.th32ProcessID] = entry.th32ParentProcessID
            found = api.Process32NextW(snapshot, ctypes.byref(entry))
        error = ctypes.get_last_error()
        if error != 18:  # ERROR_NO_MORE_FILES
            raise ctypes.WinError(error)
    finally:
        api.CloseHandle(snapshot)

    handles = []
    try:
        for pid in _descendant_pids(parents, root):
            handle = api.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
            if not handle:
                error = ctypes.get_last_error()
                if error == 87:  # ERROR_INVALID_PARAMETER: process already exited
                    continue
                raise ctypes.WinError(error)
            handles.append((pid, handle))
        yield api, handles
    finally:
        for _pid, handle in handles:
            api.CloseHandle(handle)


def _terminate_windows_tree(process: subprocess.Popen, timeout: float) -> None:
    result = subprocess.run(
        ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
        capture_output=True, check=False, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode and process.poll() is None:
        output = (result.stdout + result.stderr).decode(errors="replace")
        raise RuntimeError(f"Cannot stop test launcher {process.pid}: {output}")


def stop_process_tree(process: subprocess.Popen, *, timeout: float = 10) -> None:
    """Terminate only this launcher's tree and wait for captured descendants."""
    if process.poll() is not None:
        process.wait(timeout=timeout)
        return
    if os.name != "nt":
        process.terminate()
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=timeout)
        return

    # Waiting only for cmd.exe does not wait for the PyInstaller parent/child.
    try:
        with _windows_descendants(process.pid) as (api, handles):
            _terminate_windows_tree(process, timeout)
            deadline = time.monotonic() + timeout
            process.wait(timeout=timeout)
            for pid, handle in handles:
                remaining_ms = max(0, int((deadline - time.monotonic()) * 1000))
                status = api.WaitForSingleObject(handle, remaining_ms)
                if status == 258:  # WAIT_TIMEOUT
                    raise TimeoutError(f"Test child process {pid} did not exit within {timeout}s")
                if status != 0:  # WAIT_OBJECT_0
                    raise ctypes.WinError(ctypes.get_last_error())
    except OSError as capture_error:
        # A snapshot/OpenProcess failure must not leave the test server running.
        if process.poll() is None:
            try:
                _terminate_windows_tree(process, timeout)
                process.wait(timeout=timeout)
            except Exception as teardown_error:
                raise capture_error from teardown_error
        raise


def cleanup_directory(directory: tempfile.TemporaryDirectory, *, timeout: float = 10) -> None:
    """Retry delayed Windows file release; persistent cleanup errors still fail."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            directory.cleanup()
            return
        except OSError as error:
            # Executable mappings or a scanner may briefly outlive process exit.
            if getattr(error, "winerror", None) not in (5, 32, 145):
                raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise
            time.sleep(min(0.1, remaining))

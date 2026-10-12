"""Regressions for Windows process completion and delayed fixture release."""

from __future__ import annotations

import errno
import os
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

from backend.tests import process_support as support


class CleanupTests(unittest.TestCase):
    def locked_file(self, code: int) -> OSError:
        error = PermissionError(errno.EACCES, "executable still locked", "server.exe")
        error.winerror = code
        return error

    def test_cleanup_retries_transient_windows_locks_until_success(self) -> None:
        for code in (5, 32, 145):
            with self.subTest(winerror=code):
                directory = Mock()
                directory.cleanup.side_effect = [self.locked_file(code), None]
                with patch.object(support.time, "sleep") as sleep:
                    support.cleanup_directory(directory)
                self.assertEqual(directory.cleanup.call_count, 2)
                sleep.assert_called_once_with(0.1)

    def test_permanent_lock_fails_with_original_path_after_deadline(self) -> None:
        locked = self.locked_file(5)
        directory = Mock()
        directory.cleanup.side_effect = locked
        with patch.object(support.time, "monotonic", side_effect=[0, 0, 0.5, 1]), patch.object(
            support.time, "sleep",
        ):
            with self.assertRaises(PermissionError) as raised:
                support.cleanup_directory(directory, timeout=1)
        self.assertIs(raised.exception, locked)
        self.assertEqual(raised.exception.filename, "server.exe")
        self.assertEqual(directory.cleanup.call_count, 3)

    def test_cleanup_does_not_retry_unrelated_errors(self) -> None:
        error = OSError(errno.EIO, "storage failure", "server.exe")
        directory = Mock()
        directory.cleanup.side_effect = error
        with patch.object(support.time, "sleep") as sleep:
            with self.assertRaises(OSError) as raised:
                support.cleanup_directory(directory)
        self.assertIs(raised.exception, error)
        directory.cleanup.assert_called_once_with()
        sleep.assert_not_called()

    def test_cleanup_is_idempotent_after_directory_removal(self) -> None:
        directory = tempfile.TemporaryDirectory()
        directory.cleanup()
        support.cleanup_directory(directory)
        self.assertFalse(Path(directory.name).exists())

    def test_descendants_exclude_unrelated_processes_and_handle_out_of_order_tree(self) -> None:
        self.assertEqual(support._descendant_pids({3: 2, 2: 1, 10: 9, 1: 9}, 1), [2, 3])


@unittest.skipUnless(os.name == "nt", "Windows process handles require Windows")
class WindowsProcessTests(unittest.TestCase):
    def test_snapshot_failure_still_stops_launcher_and_preserves_error(self) -> None:
        process = Mock(pid=123)
        process.poll.return_value = None
        capture_error = OSError(errno.EACCES, "process snapshot denied")
        with patch.object(support, "_windows_descendants", side_effect=capture_error), patch.object(
            support.subprocess, "run", return_value=Mock(returncode=0),
        ) as terminate:
            with self.assertRaises(OSError) as raised:
                support.stop_process_tree(process)
        self.assertIs(raised.exception, capture_error)
        self.assertEqual(terminate.call_args.args[0], ["taskkill.exe", "/PID", "123", "/T", "/F"])
        process.wait.assert_called_once_with(timeout=10)

    def test_stopping_owned_tree_releases_child_file_lock_and_keeps_unrelated_process(self) -> None:
        child_script = """
import ctypes
import os
import sys
import time
from ctypes import wintypes
from pathlib import Path
api = ctypes.WinDLL('kernel32', use_last_error=True)
api.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                           wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
api.CreateFileW.restype = wintypes.HANDLE
handle = api.CreateFileW(sys.argv[1], 0x40000000, 0, None, 2, 0x80, None)
if handle == ctypes.c_void_p(-1).value:
    raise ctypes.WinError(ctypes.get_last_error())
Path(sys.argv[2]).write_text(str(os.getpid()))
time.sleep(60)
"""
        launcher_script = """
import subprocess
import sys
import time
subprocess.Popen([sys.executable, '-c', sys.argv[1], sys.argv[2], sys.argv[3]])
time.sleep(60)
"""
        directory = tempfile.TemporaryDirectory(prefix="process-lock-")
        self.addCleanup(support.cleanup_directory, directory)
        root = Path(directory.name)
        locked = root / "locked fixture.bin"
        ready = root / "child.ready"
        with (root / "launcher.log").open("w+b") as log:
            unrelated = subprocess.Popen(
                [sys.executable, "-c", "import time; time.sleep(60)"],
                stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            self.addCleanup(support.stop_process_tree, unrelated)
            launcher = subprocess.Popen(
                [sys.executable, "-c", launcher_script, child_script, str(locked), str(ready)],
                stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            try:
                deadline = time.monotonic() + 10
                while not ready.exists() and time.monotonic() < deadline:
                    if launcher.poll() is not None:
                        break
                    time.sleep(0.05)
                log.seek(0)
                self.assertTrue(ready.exists(), log.read().decode(errors="replace"))
                with self.assertRaises(PermissionError):
                    locked.unlink()
                support.stop_process_tree(launcher)
                locked.unlink()
                self.assertIsNone(unrelated.poll())
            finally:
                support.stop_process_tree(launcher)
                support.stop_process_tree(unrelated)

    def test_termination_waits_for_captured_children_after_waiting_for_launcher(self) -> None:
        api = Mock()
        api.WaitForSingleObject.return_value = 0
        process = Mock(pid=123)
        process.poll.return_value = None
        closed = []

        @contextmanager
        def captured(root):
            self.assertEqual(root, 123)
            try:
                yield api, [(124, 44), (125, 55)]
            finally:
                closed.extend([44, 55])

        with patch.object(support, "_windows_descendants", captured), patch.object(
            support.subprocess, "run", return_value=Mock(returncode=0),
        ) as terminate:
            support.stop_process_tree(process)
        self.assertEqual(terminate.call_args.args[0], ["taskkill.exe", "/PID", "123", "/T", "/F"])
        process.wait.assert_called_once_with(timeout=10)
        self.assertEqual([item.args[0] for item in api.WaitForSingleObject.call_args_list], [44, 55])
        self.assertEqual(closed, [44, 55])

    def test_child_timeout_still_releases_captured_handles(self) -> None:
        api = Mock()
        api.WaitForSingleObject.return_value = 258
        process = Mock(pid=123)
        process.poll.return_value = None
        closed = Mock()

        @contextmanager
        def captured(root):
            try:
                yield api, [(124, 44)]
            finally:
                closed()

        with patch.object(support, "_windows_descendants", captured), patch.object(
            support.subprocess, "run", return_value=Mock(returncode=0),
        ):
            with self.assertRaisesRegex(TimeoutError, "124"):
                support.stop_process_tree(process)
        closed.assert_called_once_with()

    def test_termination_failure_still_releases_captured_handles(self) -> None:
        process = Mock(pid=123)
        process.poll.return_value = None
        closed = Mock()

        @contextmanager
        def captured(root):
            try:
                yield Mock(), [(124, 44)]
            finally:
                closed()

        with patch.object(support, "_windows_descendants", captured), patch.object(
            support.subprocess, "run", return_value=Mock(returncode=1, stdout=b"", stderr=b"denied"),
        ):
            with self.assertRaisesRegex(RuntimeError, "123.*denied"):
                support.stop_process_tree(process)
        closed.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()

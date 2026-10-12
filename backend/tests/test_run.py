from __future__ import annotations

import argparse
import errno
import io
import os
import socket
import sys
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest import mock

import run
from backend.settings import AppSettings, SettingsError


class DevelopmentRunnerTests(unittest.TestCase):
    def test_resolve_host_selects_numeric_address_and_its_socket_family(self) -> None:
        records = [
            (socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("::1", 0, 0, 0)),
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", 0)),
        ]
        with mock.patch("run.socket.getaddrinfo", return_value=records) as lookup:
            self.assertEqual(run.resolve_host("localhost"), (socket.AF_INET6, "::1"))
            lookup.assert_called_once_with("localhost", 0, type=socket.SOCK_STREAM)

    def test_invalid_bind_host_reports_a_startup_error(self) -> None:
        with mock.patch("run.socket.getaddrinfo", side_effect=socket.gaierror("unknown host")):
            with self.assertRaisesRegex(run.RunError, "Cannot resolve bind address 'missing'"):
                run.resolve_host("missing")

    def test_service_urls_use_reachable_wildcard_targets_and_bracket_ipv6(self) -> None:
        for host, expected in (
            ("0.0.0.0", "http://127.0.0.1:4321"),
            ("192.168.56.1", "http://192.168.56.1:4321"),
            ("127.0.0.1", "http://127.0.0.1:4321"),
            ("::", "http://[::1]:4321"),
            ("::1", "http://[::1]:4321"),
            ("2001:db8::1", "http://[2001:db8::1]:4321"),
        ):
            with self.subTest(host=host):
                self.assertEqual(run.service_url(host, 4321), expected)

    def test_port_probe_uses_requested_host_family_and_skips_busy_and_reserved_ports(self) -> None:
        for host, family in (("0.0.0.0", socket.AF_INET), ("::1", socket.AF_INET6)):
            with self.subTest(host=host):
                busy = mock.MagicMock(spec=socket.socket)
                busy.__enter__.return_value = busy
                busy.bind.side_effect = OSError(errno.EADDRINUSE, "already in use")
                free = mock.MagicMock(spec=socket.socket)
                free.__enter__.return_value = free
                with mock.patch("run.socket.socket", side_effect=[busy, free]) as create:
                    self.assertEqual(run.available_port(8000, {8001}, host=host, family=family), 8002)
                self.assertEqual(create.call_args_list, [
                    mock.call(family, socket.SOCK_STREAM), mock.call(family, socket.SOCK_STREAM),
                ])
                busy.bind.assert_called_once_with((host, 8000))
                free.bind.assert_called_once_with((host, 8002))
                if os.name == "nt":
                    for probe in (busy, free):
                        probe.setsockopt.assert_called_once_with(
                            socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1,
                        )

    def test_port_range_exhaustion_is_reported(self) -> None:
        probe = mock.MagicMock(spec=socket.socket)
        probe.__enter__.return_value = probe
        probe.bind.side_effect = OSError(errno.EADDRINUSE, "already in use")
        with mock.patch("run.socket.socket", return_value=probe):
            with self.assertRaisesRegex(run.RunError, "No available TCP port"):
                run.available_port(65535, host="192.168.56.1")

    def test_nonlocal_bind_address_fails_without_scanning_more_ports(self) -> None:
        probe = mock.MagicMock(spec=socket.socket)
        probe.__enter__.return_value = probe
        probe.bind.side_effect = OSError(errno.EADDRNOTAVAIL, "address is not assigned")
        with mock.patch("run.socket.socket", return_value=probe) as create:
            with self.assertRaisesRegex(run.RunError, "Cannot bind to 192.168.99.99:8000"):
                run.available_port(8000, host="192.168.99.99")
        create.assert_called_once_with(socket.AF_INET, socket.SOCK_STREAM)
        probe.bind.assert_called_once_with(("192.168.99.99", 8000))

    def test_cors_merge_preserves_custom_origins_and_adds_exact_lan_origins_once(self) -> None:
        environment = {"CORS_ORIGINS": " https://custom.example ,http://localhost:5173,,"}
        run.merge_cors_origins(environment, 5173, [
            "http://192.168.1.156:5173", "http://192.168.56.1:5173",
            "http://localhost:5173", "http://192.168.1.156:5173",
        ])
        self.assertEqual(environment["CORS_ORIGINS"], ",".join([
            "https://custom.example", "http://localhost:5173", "http://127.0.0.1:5173",
            "http://192.168.1.156:5173", "http://192.168.56.1:5173",
        ]))

    def test_explicit_cors_wildcard_is_preserved(self) -> None:
        environment = {"CORS_ORIGINS": " * "}
        run.merge_cors_origins(environment, 5173, ["http://192.168.1.156:5173"])
        self.assertEqual(environment, {"CORS_ORIGINS": " * "})

    def run_mocked_main(self, argument_host: str | None, resolved_host: str, lan_hosts: list[str]):
        arguments = argparse.Namespace(
            backend_port=8000, frontend_port=5173, host=argument_host, no_reload=True,
            initialize_settings=False,
        )
        records = [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (resolved_host, 0))]
        output = io.StringIO()
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, {"CORS_ORIGINS": "https://custom.example"}, clear=True))
            stack.enter_context(mock.patch("run.parse_args", return_value=arguments))
            stack.enter_context(mock.patch("run.select_runtime", return_value=Path(sys.executable)))
            stack.enter_context(mock.patch("run.load_env_file"))
            initialize = stack.enter_context(mock.patch("run.initialize_port_settings", return_value={
                "backend_port": 8000, "frontend_port": 5173,
            }))
            load_settings = stack.enter_context(mock.patch("run.load_settings", return_value=AppSettings(
                settings_path=Path("test-settings.json"), data_directory=Path("test-data"),
            )))
            lookup = stack.enter_context(mock.patch("run.socket.getaddrinfo", return_value=records))
            ports = stack.enter_context(mock.patch("run.available_port", side_effect=[8001, 5174]))
            lan = stack.enter_context(mock.patch("run.lan_urls_for_host", return_value=[
                f"http://{host}:5174" for host in lan_hosts
            ]))
            stack.enter_context(mock.patch("run.shutil.which", return_value="npm"))
            stack.enter_context(mock.patch.object(Path, "is_dir", return_value=True))
            processes = [mock.Mock(), mock.Mock()]
            for process in processes:
                process.poll.return_value = 0
            spawn = stack.enter_context(mock.patch("run.subprocess.Popen", side_effect=processes))
            stack.enter_context(redirect_stdout(output))
            self.assertEqual(run.main(), 0)
        initialize.assert_called_once_with(run.ROOT / "port_mapping.json")
        load_settings.assert_called_once_with()
        lookup.assert_called_once_with(argument_host or "0.0.0.0", 0, type=socket.SOCK_STREAM)
        self.assertEqual(ports.call_args_list, [
            mock.call(8000, host=resolved_host, family=socket.AF_INET),
            mock.call(5173, {8001}, host=resolved_host, family=socket.AF_INET),
        ])
        lan.assert_called_once_with(resolved_host, 5174)
        for call in spawn.call_args_list:
            command = call.args[0]
            self.assertEqual(command[command.index("--host") + 1], resolved_host)
            self.assertNotIn("--reload", command)
        self.assertIn("--strictPort", spawn.call_args_list[1].args[0])
        return output.getvalue(), spawn.call_args_list

    def test_default_wildcard_is_shared_by_children_and_banner_lists_multiple_adapters(self) -> None:
        output, calls = self.run_mocked_main(None, "0.0.0.0", ["192.168.1.156", "192.168.56.1"])
        self.assertIn("Backend:  http://127.0.0.1:8001", output)
        self.assertIn("Frontend: http://localhost:5174", output)
        for host in ("192.168.1.156", "192.168.56.1"):
            self.assertIn(f"LAN:      http://{host}:5174", output)
            self.assertIn(f"LAN API:  http://{host}:8001/docs", output)
        self.assertIn("Open a LAN URL on another device connected to the same network.", output)
        backend_env = calls[0].kwargs["env"]
        self.assertEqual(backend_env["CORS_ORIGINS"], ",".join([
            "https://custom.example", "http://localhost:5174", "http://127.0.0.1:5174",
            "http://192.168.1.156:5174", "http://192.168.56.1:5174",
        ]))
        self.assertEqual(calls[1].kwargs["env"]["VITE_BACKEND_URL"], "http://127.0.0.1:8001")

    def test_explicit_hostname_is_resolved_once_and_only_its_adapter_is_advertised(self) -> None:
        output, calls = self.run_mocked_main("desktop", "192.168.56.1", ["192.168.56.1"])
        self.assertIn("Frontend: http://192.168.56.1:5174", output)
        self.assertNotIn("LAN:      http://192.168.1.156", output)
        self.assertEqual(calls[1].kwargs["env"]["VITE_BACKEND_URL"], "http://192.168.56.1:8001")
        self.assertEqual(calls[0].kwargs["env"]["CORS_ORIGINS"].count("http://192.168.56.1:5174"), 1)

    def test_loopback_override_does_not_print_lan_access_instructions(self) -> None:
        output, _calls = self.run_mocked_main("127.0.0.1", "127.0.0.1", [])
        self.assertIn("Frontend: http://127.0.0.1:5174", output)
        self.assertNotIn("LAN:", output)
        self.assertNotIn("LAN API:", output)
        self.assertNotIn("Open a LAN URL", output)

    def test_saved_ports_environment_and_cli_precedence(self) -> None:
        saved_ports = {"backend_port": 4320, "frontend_port": 4310}
        cases = (
            ({}, None, None, 4320, 4310),
            ({"BACKEND_PORT": "4420", "FRONTEND_PORT": "4410"}, None, None, 4420, 4410),
            ({"BACKEND_PORT": "4420", "FRONTEND_PORT": "4410"}, 4520, 4510, 4520, 4510),
            ({"BACKEND_PORT": "4420"}, None, 4510, 4420, 4510),
        )
        for environment, backend, frontend, expected_backend, expected_frontend in cases:
            with self.subTest(environment=environment, backend=backend, frontend=frontend):
                arguments = argparse.Namespace(
                    backend_port=backend, frontend_port=frontend, host=None,
                    no_reload=True, initialize_settings=False,
                )
                with ExitStack() as stack:
                    stack.enter_context(mock.patch.dict(os.environ, environment, clear=True))
                    stack.enter_context(mock.patch("run.parse_args", return_value=arguments))
                    stack.enter_context(mock.patch("run.select_runtime", return_value=Path(sys.executable)))
                    stack.enter_context(mock.patch("run.load_env_file"))
                    stack.enter_context(mock.patch("run.initialize_port_settings", return_value=saved_ports))
                    stack.enter_context(mock.patch("run.load_settings", return_value=AppSettings(
                        settings_path=Path("test-settings.json"), data_directory=Path("test-data"),
                    )))
                    stack.enter_context(mock.patch("run.resolve_host", return_value=(socket.AF_INET, "0.0.0.0")))
                    ports = stack.enter_context(mock.patch("run.available_port", side_effect=lambda port, *args, **kwargs: port))
                    stack.enter_context(mock.patch("run.lan_urls_for_host", return_value=[]))
                    stack.enter_context(mock.patch("run.shutil.which", return_value="npm"))
                    stack.enter_context(mock.patch.object(Path, "is_dir", return_value=True))
                    processes = [mock.Mock(), mock.Mock()]
                    for process in processes:
                        process.poll.return_value = 0
                    spawn = stack.enter_context(mock.patch("run.subprocess.Popen", side_effect=processes))
                    stack.enter_context(redirect_stdout(io.StringIO()))
                    self.assertEqual(run.main(), 0)
                self.assertEqual(ports.call_args_list, [
                    mock.call(expected_backend, host="0.0.0.0", family=socket.AF_INET),
                    mock.call(expected_frontend, {expected_backend}, host="0.0.0.0", family=socket.AF_INET),
                ])
                for call, expected in zip(spawn.call_args_list, (expected_backend, expected_frontend)):
                    command = call.args[0]
                    self.assertEqual(command[command.index("--port") + 1], str(expected))

    def test_initialize_settings_only_does_not_start_services(self) -> None:
        arguments = run.parse_args(["--initialize-settings"])
        with ExitStack() as stack:
            stack.enter_context(mock.patch("run.parse_args", return_value=arguments))
            stack.enter_context(mock.patch("run.select_runtime", return_value=Path(sys.executable)))
            stack.enter_context(mock.patch("run.load_env_file"))
            initialize = stack.enter_context(mock.patch("run.initialize_port_settings", return_value={
                "backend_port": 4320, "frontend_port": 4310,
            }))
            load = stack.enter_context(mock.patch("run.load_settings"))
            resolve = stack.enter_context(mock.patch("run.resolve_host"))
            spawn = stack.enter_context(mock.patch("run.subprocess.Popen"))
            self.assertEqual(run.main(), 0)
        initialize.assert_called_once_with(run.ROOT / "port_mapping.json")
        load.assert_called_once_with()
        resolve.assert_not_called()
        spawn.assert_not_called()

    def test_invalid_settings_stop_startup_with_readable_error(self) -> None:
        for failing_tool in ("initialize_port_settings", "load_settings"):
            with self.subTest(failing_tool=failing_tool), ExitStack() as stack:
                stack.enter_context(mock.patch("run.parse_args", return_value=run.parse_args([])))
                stack.enter_context(mock.patch("run.select_runtime", return_value=Path(sys.executable)))
                stack.enter_context(mock.patch("run.load_env_file"))
                initialize = stack.enter_context(mock.patch("run.initialize_port_settings", return_value={
                    "backend_port": 4320, "frontend_port": 4310,
                }))
                load = stack.enter_context(mock.patch("run.load_settings"))
                (initialize if failing_tool == "initialize_port_settings" else load).side_effect = SettingsError(
                    "Invalid configuration at test-settings.json"
                )
                spawn = stack.enter_context(mock.patch("run.subprocess.Popen"))
                with self.assertRaisesRegex(run.RunError, "test-settings.json"):
                    run.main()
                spawn.assert_not_called()

    def test_duplicate_overridden_ports_and_zero_cli_port_fail_before_binding(self) -> None:
        for cli in (["--backend-port", "5173"], ["--backend-port", "0"]):
            with self.subTest(cli=cli), ExitStack() as stack:
                arguments = run.parse_args(cli)
                stack.enter_context(mock.patch("run.parse_args", return_value=arguments))
                stack.enter_context(mock.patch.dict(os.environ, {}, clear=True))
                stack.enter_context(mock.patch("run.select_runtime", return_value=Path(sys.executable)))
                stack.enter_context(mock.patch("run.load_env_file"))
                stack.enter_context(mock.patch("run.initialize_port_settings", return_value={
                    "backend_port": 8000, "frontend_port": 5173,
                }))
                stack.enter_context(mock.patch("run.load_settings"))
                ports = stack.enter_context(mock.patch("run.available_port"))
                spawn = stack.enter_context(mock.patch("run.subprocess.Popen"))
                with self.assertRaises(run.RunError):
                    run.main()
                ports.assert_not_called()
                spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()

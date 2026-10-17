import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]


class RunningServer:
    def __init__(self, database, log_path):
        self.database = database
        self.log_path = log_path
        self.process = None
        self.log = None
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.url = f'http://127.0.0.1:{self.port}'
        self.ws_url = f'ws://127.0.0.1:{self.port}/ws'
        self.client = httpx.Client(base_url=self.url, timeout=5, trust_env=False)

    def start(self):
        self.log = open(self.log_path, 'a', encoding='utf-8')
        env = {**os.environ, 'ARHAM_DB': str(self.database)}
        self.process = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'arham.app:app', '--host', '127.0.0.1', '--port', str(self.port)],
            cwd=ROOT, env=env, stdout=self.log, stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                if self.client.get('/api/health').status_code == 200:
                    return self
            except httpx.HTTPError:
                pass
            if self.process.poll() is not None:
                break
            time.sleep(.1)
        self.stop()
        raise AssertionError(self.log_path.read_text())

    def stop(self):
        if self.process and self.process.poll() is None:
            # End only this fixture's process tree, including its child worker.
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(self.process.pid), '/T', '/F'], capture_output=True)
            else:
                self.process.terminate()
            self.process.wait(timeout=10)
        if self.log:
            self.log.close()
            self.log = None


@pytest.fixture
def server(tmp_path):
    instance = RunningServer(tmp_path / 'trades.sqlite3', tmp_path / 'server.log')
    instance.start()
    try:
        yield instance
    finally:
        instance.stop()
        instance.client.close()

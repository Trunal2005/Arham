import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import time

import httpx
import pytest
import websockets

from arham.app import create_app
from arham.db import connect, get_job, initialize, now, snapshot
from arham import worker
from test_flow import pull, receive_until


def test_broken_completion_pipe_does_not_turn_committed_job_into_failure(tmp_path, monkeypatch):
    path = tmp_path / 'pipe.sqlite3'
    initialize(path)
    with connect(path) as db:
        db.execute("INSERT INTO jobs(id,status,delay_seconds,record_count,seed,created_at) VALUES ('pipe','queued',0,100,42,?)", (now(),))
    notifications = []
    def broken_notify(eid):
        notifications.append(eid)
        if len(notifications) == 2:
            raise BrokenPipeError('simulated post-commit IPC failure')
    monkeypatch.setattr(worker, 'notify', broken_notify)
    with pytest.raises(BrokenPipeError):
        worker.execute(path, 'pipe')
    assert get_job(path, 'pipe')['status'] == 'completed'
    with connect(path) as db:
        assert db.execute('SELECT count(*) FROM trades').fetchone()[0] == 100
        assert db.execute("SELECT count(*) FROM events WHERE type='pull.failed'").fetchone()[0] == 0


def test_real_concurrent_requests_allow_exactly_one_pull(server):
    async def scenario():
        async with websockets.connect(server.ws_url) as ws:
            await receive_until(ws, 'connected')
            with ThreadPoolExecutor(max_workers=10) as pool:
                responses = list(pool.map(lambda _: server.client.post('/api/pulls', json={'delay_seconds': 3, 'record_count': 100}), range(10)))
            assert sorted(r.status_code for r in responses) == [202] + [409] * 9
            accepted = next(r.json()['job_id'] for r in responses if r.status_code == 202)
            assert all(r.json()['detail']['job_id'] == accepted for r in responses if r.status_code == 409)
            await receive_until(ws, 'pull.completed', accepted)
    asyncio.run(scenario())


def test_fast_get_acceptance_is_always_202_and_events_stay_ordered(server):
    async def scenario():
        async with websockets.connect(server.ws_url) as ws:
            await receive_until(ws, 'connected')
            ids = []
            for seed in range(10):
                r = server.client.get('/getTrades', params={'delay_seconds': 0, 'record_count': 10, 'seed': seed})
                assert r.status_code == 202
                assert r.headers['cache-control'] == 'no-store'
                while True:
                    message = json.loads(await asyncio.wait_for(ws.recv(), 5))
                    ids.append(message['id'])
                    if message['type'] == 'pull.completed':
                        assert server.client.get(r.headers['location']).json()['total'] == 10
                        break
            assert ids == sorted(set(ids))
            assert len(ids) == 30
    asyncio.run(scenario())


def test_slow_subscriber_cannot_delay_http_acceptance(tmp_path):
    async def scenario():
        app = create_app(tmp_path / 'slow.sqlite3')
        sending = asyncio.Event()
        class SlowSocket:
            async def send_json(self, message):
                sending.set()
                await asyncio.Future()
            async def close(self, **kwargs):
                pass
        async with app.router.lifespan_context(app):
            app.state.bridge.clients[SlowSocket()] = 0
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test', trust_env=False) as client:
                started = time.monotonic()
                response = await client.get('/getTrades?delay_seconds=1&record_count=100')
                assert response.status_code == 202
                assert time.monotonic() - started < .75
                await asyncio.wait_for(sending.wait(), 2)
                assert (await client.get('/api/health')).status_code == 200
    asyncio.run(scenario())


def test_literal_provider_returns_same_seed_without_ingesting(server):
    started = time.monotonic()
    response = server.client.get('/mock-bse/getTrades?delay_seconds=0.2&record_count=2000&seed=7')
    assert response.status_code == 200
    assert time.monotonic() - started >= .2
    data = response.json()
    assert data['total'] == 2000
    assert data['items'][0]['trade_id'] == 'BSE-0000000007-000001'
    assert data['simulated_exchange_date'] == '2026-01-01'
    assert server.client.get('/api/trades').json()['total'] == 0
    job_id, _ = asyncio.run(pull(server, count=2000, seed=7))
    ingested = server.client.get('/getTrades', params={'job_id': job_id}).json()['items']
    assert [{k: v for k, v in t.items() if k != 'job_id'} for t in ingested] == data['items']


def test_consistent_read_transaction_and_dashboard_summary(server):
    asyncio.run(pull(server, count=3000, seed=42))
    with snapshot(server.database) as db:
        assert db.execute('SELECT count(*) FROM trades').fetchone()[0] == 3000
        asyncio.run(pull(server, count=3000, seed=43))
        assert db.execute('SELECT count(*) FROM trades').fetchone()[0] == 3000
    response = server.client.get('/api/dashboard?limit=10000').json()
    rows, summary = response['trades']['items'], response['summary']
    assert summary['trade_count'] == response['trades']['total'] == len(rows) == 6000
    assert summary['quantity'] == sum(t['quantity'] for t in rows) == 3032820
    assert summary['value_paise'] == sum(t['quantity'] * t['price_paise'] for t in rows) == 624969894595
    assert summary['client_count'] == len({t['client'] for t in rows}) == 80
    assert all(t['timestamp'].endswith('+00:00') for t in rows)
    expected = sorted(rows, key=lambda t: t['trade_id'])
    expected.sort(key=lambda t: t['timestamp'], reverse=True)
    assert [t['trade_id'] for t in expected] == [t['trade_id'] for t in rows]


def test_future_cursor_recovers_after_database_restore(server):
    async def scenario():
        async with websockets.connect(server.ws_url + '?after=999999') as ws:
            connected = await receive_until(ws, 'connected')
            assert connected['cursor'] == 0
            response = server.client.post('/api/pulls', json={'delay_seconds': 0, 'record_count': 10})
            await receive_until(ws, 'pull.completed', response.json()['job_id'])
    asyncio.run(scenario())


def test_failed_batch_preserves_previously_committed_trades(server):
    asyncio.run(pull(server, count=100, seed=1))
    before = server.client.get('/api/summary').json()
    with sqlite3.connect(server.database) as db:
        db.execute("CREATE TRIGGER reject_new BEFORE INSERT ON trades WHEN NEW.trade_id LIKE 'BSE-0000000002-%' BEGIN SELECT RAISE(ABORT,'injected failure'); END")
    async def scenario():
        async with websockets.connect(server.ws_url) as ws:
            await receive_until(ws, 'connected')
            response = server.client.post('/api/pulls', json={'seed': 2, 'delay_seconds': 0, 'record_count': 100})
            await receive_until(ws, 'pull.failed', response.json()['job_id'])
    asyncio.run(scenario())
    assert server.client.get('/api/summary').json() == before


def test_second_api_process_is_rejected_without_disturbing_first(server):
    from conftest import RunningServer
    other = RunningServer(server.database, server.log_path.with_name('second.log'))
    try:
        with pytest.raises(AssertionError, match='Database already owned'):
            other.start()
        asyncio.run(pull(server, count=100))
        assert server.client.get('/api/health').status_code == 200
    finally:
        other.stop()
        other.client.close()


@pytest.mark.slow
def test_measured_closed_request_to_commit_to_two_websockets(server):
    async def scenario():
        asyncio_task = pull(server, count=100, seed=1)
        await asyncio_task
        async with websockets.connect(server.ws_url) as first, websockets.connect(server.ws_url) as second:
            await receive_until(first, 'connected')
            await receive_until(second, 'connected')
            # A distinct HTTP client is closed immediately after acceptance.
            with httpx.Client(base_url=server.url, trust_env=False, timeout=2) as initiating:
                # Constructing an SSL context is client setup, not HTTP acceptance time.
                started = time.monotonic()
                r = initiating.get('/getTrades?delay_seconds=32&record_count=3000&seed=2')
                accepted = time.monotonic()
            assert r.status_code == 202 and accepted - started < 1
            job_id = r.json()['job_id']
            read_samples = []
            for seconds in (0, 10, 20, 30.5):
                await asyncio.sleep(max(0, started + seconds - time.monotonic()))
                before = time.monotonic()
                snapshot_data = server.client.get('/api/dashboard').json()
                duration = time.monotonic() - before
                assert snapshot_data['summary']['trade_count'] == 100
                assert snapshot_data['trades']['total'] == 100
                assert duration < 1
                read_samples.append({'elapsed_seconds': before - started, 'duration_seconds': duration, 'trades': 100})
            first_event = await receive_until(first, 'pull.completed', job_id)
            first_received = time.monotonic()
            second_event = await receive_until(second, 'pull.completed', job_id)
            second_received = time.monotonic()
            assert first_event['id'] == second_event['id']
            assert server.client.get('/api/trades').json()['total'] == 3100
            traces = [json.loads(line) for line in server.trace_path.read_text().splitlines()]
            traces = [t for t in traces if t['job_id'] == job_id]
            stages = {t['stage']: t['monotonic'] for t in traces if t['stage'] != 'websocket.notified'}
            assert stages['database.committed'] >= stages['worker.finished'] >= stages['worker.started']
            assert stages['worker.finished'] - stages['worker.started'] >= 32
            assert first_received >= stages['database.committed']
            report = {'clock': 'time.monotonic, same local OS boot; browser clock measured separately', 'job_id': job_id,
                      'http_acceptance_seconds': accepted - started, 'initiating_client_closed': True,
                      'worker_started': stages['worker.started'], 'worker_finished': stages['worker.finished'],
                      'database_committed': stages['database.committed'], 'first_client_received': first_received,
                      'second_client_received': second_received, 'total_elapsed_seconds': second_received - started,
                      'cached_read_samples': read_samples, 'trace': traces, 'status': 'passed'}
            out = Path('docs/evidence/timeout-backend.json')
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(report, indent=2))
    asyncio.run(scenario())

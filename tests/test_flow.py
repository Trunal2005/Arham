import asyncio
import json
import os
import signal
import sqlite3
import subprocess
import time

import pytest
import websockets

from arham.db import connect, event, initialize, now
from arham.provider import generate_trades


async def receive_until(ws, kind, job_id=None, timeout=10):
    async def read():
        while True:
            message = json.loads(await ws.recv())
            if message['type'] == kind and (not job_id or message.get('payload', {}).get('job_id') == job_id):
                return message
    return await asyncio.wait_for(read(), timeout)


async def pull(server, delay=0, count=3000, seed=42):
    async with websockets.connect(server.ws_url) as ws:
        await receive_until(ws, 'connected')
        started = time.monotonic()
        response = server.client.post('/api/pulls', json={'delay_seconds': delay, 'record_count': count, 'seed': seed})
        assert response.status_code == 202, response.text
        assert time.monotonic() - started < 2
        job_id = response.json()['job_id']
        message = await receive_until(ws, 'pull.completed', job_id, timeout=delay + 10)
        return job_id, message


def test_full_ingestion_and_websocket(server):
    async def scenario():
        async with websockets.connect(server.ws_url) as first, websockets.connect(server.ws_url) as second:
            await receive_until(first, 'connected')
            await receive_until(second, 'connected')
            result = server.client.post('/api/pulls', json={'delay_seconds': 1, 'record_count': 3000, 'seed': 42})
            assert result.status_code == 202
            job_id = result.json()['job_id']
            before = time.monotonic()
            assert server.client.get('/').status_code == 200
            assert server.client.get('/api/trades').json()['total'] == 0
            assert time.monotonic() - before < 1
            busy = server.client.post('/api/pulls', json={})
            assert busy.status_code == 409
            events = []
            while True:
                message = json.loads(await asyncio.wait_for(first.recv(), 10))
                events.append(message)
                if message['type'] == 'pull.completed':
                    break
            assert [e['type'] for e in events] == ['pull.queued', 'pull.started', 'pull.completed']
            assert [e['id'] for e in events] == sorted(e['id'] for e in events)
            other = await receive_until(second, 'pull.completed', job_id)
            assert other['id'] == events[-1]['id']
            assert other['payload']['inserted_count'] == 3000
            data = server.client.get('/api/trades').json()
            assert data['total'] == 3000 and len(data['items']) == 50
            assert set(['trade_id', 'client', 'symbol', 'quantity', 'price', 'timestamp']).issubset(data['items'][0])
            assert server.client.get(result.headers['location']).json()['status'] == 'completed'
            summary = server.client.get('/api/summary').json()
            assert summary['trade_count'] == 3000
            assert summary['client_count'] == 80
            assert len(summary['symbols']) == 8
            # Every summary amount matches the committed records, using integer paise.
            all_rows = server.client.get('/api/trades?limit=10000').json()['items']
            assert summary['value_paise'] == sum(t['quantity'] * t['price_paise'] for t in all_rows)
    asyncio.run(scenario())


def test_deduplication_and_new_dataset(server):
    async def scenario():
        _, first = await pull(server)
        _, repeated = await pull(server)
        _, newer = await pull(server, seed=43)
        assert first['payload']['inserted_count'] == 3000
        assert repeated['payload']['inserted_count'] == 0
        assert newer['payload']['inserted_count'] == 3000
        assert server.client.get('/api/trades').json()['total'] == 6000
    asyncio.run(scenario())


def test_mock_exchange_contract(server):
    async def scenario():
        async with websockets.connect(server.ws_url) as ws:
            await receive_until(ws, 'connected')
            started = time.monotonic()
            response = server.client.get('/getTrades?delay_seconds=1&record_count=2500&seed=7')
            assert response.status_code == 202 and time.monotonic() - started < 1
            await receive_until(ws, 'pull.completed', response.json()['job_id'])
            result = server.client.get(response.headers['location'])
            assert result.status_code == 200
            assert result.json()['total'] == 2500
            assert result.json()['items'][0]['trade_id'] == 'BSE-0000000007-000001'
    asyncio.run(scenario())


def test_pagination_search_and_validation(server):
    asyncio.run(pull(server))
    first = server.client.get('/api/trades?limit=25').json()
    second = server.client.get('/api/trades?limit=25&offset=25').json()
    assert len(first['items']) == 25
    assert set(t['trade_id'] for t in first['items']).isdisjoint(t['trade_id'] for t in second['items'])
    for query in ['RELIANCE', 'reliance', 'CL-0001', first['items'][0]['trade_id']]:
        result = server.client.get('/api/trades', params={'search': query}).json()
        assert result['total'] > 0
        assert all(any(query.lower() in t[key].lower() for key in ['trade_id', 'client', 'symbol']) for t in result['items'])
    assert server.client.get('/api/trades', params={'search': "' OR 1=1 --"}).json()['total'] == 0
    for path in ['/api/trades?limit=0', '/api/trades?offset=-1', '/getTrades?delay_seconds=901', '/getTrades?seed=-1']:
        assert server.client.get(path).status_code == 422
    for data in [{'delay_seconds': -1}, {'delay_seconds': 901}, {'record_count': 10001}, {'record_count': 0}, {'seed': -1}]:
        assert server.client.post('/api/pulls', json=data).status_code == 422
    assert server.client.get('/api/pulls/missing').status_code == 404
    assert server.client.get('/getTrades?job_id=missing').status_code == 404


def test_reconnect_replays_committed_completion(server):
    async def scenario():
        job_id, completed = await pull(server)
        async with websockets.connect(server.ws_url + '?after=' + str(completed['id'] - 1)) as ws:
            replay = await receive_until(ws, 'pull.completed', job_id)
            assert replay['id'] == completed['id']
            connected = await receive_until(ws, 'connected')
            assert connected['cursor'] == completed['id']
            await ws.send('ping')
            await receive_until(ws, 'pong')
        async with websockets.connect(server.ws_url + '?after=' + str(completed['id'])) as ws:
            message = json.loads(await ws.recv())
            assert message['type'] == 'connected'
    asyncio.run(scenario())


def test_restart_recovers_interrupted_job_and_keeps_trades(server):
    asyncio.run(pull(server, count=100, seed=1))
    response = server.client.post('/api/pulls', json={'delay_seconds': 2, 'record_count': 3000, 'seed': 2})
    job_id = response.json()['job_id']
    server.stop()
    server.start()
    async def scenario():
        async with websockets.connect(server.ws_url) as ws:
            await receive_until(ws, 'pull.completed', job_id)
        assert server.client.get('/api/trades').json()['total'] == 3100
        assert server.client.get('/api/pulls/' + job_id).json()['status'] == 'completed'
    asyncio.run(scenario())


def test_transaction_rolls_back_partial_ingestion(server):
    # Inject a real database failure in the middle of the worker's batch.
    with sqlite3.connect(server.database) as db:
        db.execute("CREATE TRIGGER reject_trade BEFORE INSERT ON trades WHEN NEW.trade_id LIKE '%-000015' BEGIN SELECT RAISE(ABORT,'injected failure'); END")
    async def scenario():
        async with websockets.connect(server.ws_url) as ws:
            await receive_until(ws, 'connected')
            response = server.client.post('/api/pulls', json={'delay_seconds': 0, 'record_count': 100})
            job_id = response.json()['job_id']
            await receive_until(ws, 'pull.failed', job_id)
            assert server.client.get('/api/trades').json()['total'] == 0
            assert server.client.get('/api/pulls/' + job_id).json()['status'] == 'failed'
    asyncio.run(scenario())
    with sqlite3.connect(server.database) as db:
        db.execute('DROP TRIGGER reject_trade')
    asyncio.run(pull(server, count=100))
    assert server.client.get('/api/trades').json()['total'] == 100


def test_full_fifteen_minute_configuration_returns_immediately(server):
    started = time.monotonic()
    response = server.client.get('/getTrades?delay_seconds=900')
    assert response.status_code == 202
    assert time.monotonic() - started < 1
    assert server.client.get('/api/pulls/' + response.json()['job_id']).json()['delay_seconds'] == 900
    assert server.client.get('/api/trades').status_code == 200


def test_worker_crash_fails_visibly_and_next_pull_restarts_worker(server):
    async def scenario():
        async with websockets.connect(server.ws_url) as ws:
            await receive_until(ws, 'connected')
            response = server.client.post('/api/pulls', json={'delay_seconds': 20, 'record_count': 100})
            job_id = response.json()['job_id']
            await receive_until(ws, 'pull.started', job_id)
            pid = server.client.get('/api/health').json()['worker_pid']
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(pid), '/F'], check=True, capture_output=True)
            else:
                os.kill(pid, signal.SIGKILL)
            await receive_until(ws, 'pull.failed', job_id)
        assert server.client.get('/api/pulls/' + job_id).json()['status'] == 'failed'
        assert server.client.get('/api/health').status_code == 503
        await pull(server, count=100)
        assert server.client.get('/api/health').status_code == 200
        assert server.client.get('/api/trades').json()['total'] == 100
    asyncio.run(scenario())


@pytest.mark.slow
def test_ingestion_outlives_thirty_second_http_limit(server):
    async def scenario():
        async with websockets.connect(server.ws_url) as ws:
            await receive_until(ws, 'connected')
            started = time.monotonic()
            response = server.client.post('/api/pulls', json={'delay_seconds': 32, 'record_count': 3000})
            assert response.status_code == 202
            assert time.monotonic() - started < 1
            # Only the test waits. No client request is kept open, no application polling.
            await asyncio.sleep(30.5)
            before = time.monotonic()
            assert server.client.get('/api/trades').json()['total'] == 0
            assert time.monotonic() - before < 1
            await receive_until(ws, 'pull.completed', response.json()['job_id'])
            assert time.monotonic() - started >= 32
            assert server.client.get('/api/trades').json()['total'] == 3000
    asyncio.run(scenario())


def test_provider_is_repeatable_and_prices_are_integer_paise():
    first = list(generate_trades(42, 3000))
    assert first == list(generate_trades(42, 3000))
    assert len({t['trade_id'] for t in first}) == 3000
    assert all(isinstance(t['price_paise'], int) and t['price_paise'] > 0 and t['quantity'] > 0 for t in first)


def test_active_pull_constraint_is_database_enforced(tmp_path):
    path = tmp_path / 'constraint.sqlite3'
    initialize(path)
    with connect(path) as db:
        db.execute("INSERT INTO jobs(id,status,delay_seconds,record_count,seed,created_at) VALUES ('a','queued',0,1,42,?)", (now(),))
    with pytest.raises(sqlite3.IntegrityError):
        with connect(path) as db:
            db.execute("INSERT INTO jobs(id,status,delay_seconds,record_count,seed,created_at) VALUES ('b','queued',0,1,43,?)", (now(),))

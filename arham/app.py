import asyncio
import json
import logging
import os
import sqlite3
import sys
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from arham.db import DatabaseOwner, connect, event, get_job, initialize, now, read_events, snapshot
from arham.provider import generate_trades
from arham.telemetry import trace

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("arham")


class PullRequest(BaseModel):
    delay_seconds: float = Field(default=5, ge=0, le=900, allow_inf_nan=False)
    record_count: int = Field(default=3000, ge=1, le=10000)
    seed: int = Field(default=42, ge=0, le=2147483647)


class WorkerBridge:
    def __init__(self, path):
        self.path = path
        self.process = None
        self.task = None
        self.clients = {}
        self.lock = asyncio.Lock()
        self.stopping = False
        self.wake = asyncio.Event()
        self.dispatch_task = None
        self.cursor = 0

    async def start(self):
        if self.dispatch_task is None:
            self.dispatch_task = asyncio.create_task(self.dispatch())
        self.process = await asyncio.create_subprocess_exec(
            sys.executable, "-u", "-m", "arham.worker", self.path,
            cwd=ROOT, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        )
        with connect(self.path) as db:
            # Interrupted work is safe to replay: trade IDs are unique and completion is atomic.
            db.execute("UPDATE jobs SET status='queued',started_at=NULL WHERE status='running'")
            pending = [r["id"] for r in db.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at")]
        self.task = asyncio.create_task(self.listen())
        for job_id in pending:
            await self.submit(job_id)

    async def submit(self, job_id):
        if self.process.returncode is not None:
            raise RuntimeError("Worker unavailable")
        self.process.stdin.write((json.dumps({"job_id": job_id}) + "\n").encode())
        await self.process.stdin.drain()

    async def listen(self):
        while line := await self.process.stdout.readline():
            message = json.loads(line)
            with connect(self.path) as db:
                row = db.execute("SELECT * FROM events WHERE id=?", (message["event_id"],)).fetchone()
            if row:
                self.wake.set()
        if not self.stopping:
            # Fail visibly on an unexpected exit; a new pull or server restart restarts the worker.
            with connect(self.path) as db:
                jobs = list(db.execute("SELECT id FROM jobs WHERE status IN ('queued','running')"))
                db.execute("UPDATE jobs SET status='failed',error='Worker exited unexpectedly',finished_at=? WHERE status IN ('queued','running')", (now(),))
                ids = [event(db, "pull.failed", {"job_id": r["id"], "error": "Worker exited unexpectedly; retry the pull."}) for r in jobs]
            self.wake.set()
            # Drain failure events before closing subscriptions.
            await self.deliver_pending()
            # A worker can exit after commit but before writing its IPC notification.
            # Reconnect forces durable replay/snapshot, recovering that narrow gap.
            async with self.lock:
                sockets = list(self.clients)
                self.clients.clear()
            for socket in sockets:
                with suppress(Exception):
                    await asyncio.wait_for(socket.close(code=1012), timeout=2)

    async def dispatch(self):
        while True:
            await self.wake.wait()
            self.wake.clear()
            await self.deliver_pending()

    async def deliver_pending(self):
        # One ordered drain for both API-created and worker-created events.
        async with self.lock:
            while batch := await asyncio.to_thread(read_events, self.path, self.cursor):
                for message in batch:
                    await self.broadcast(message)
                    self.cursor = message["id"]

    async def broadcast(self, message):
        # Caller owns lock. Acceptance never awaits these potentially slow sends.
        async def send(socket):
            if message["id"] <= self.clients.get(socket, message["id"]):
                return
            try:
                await asyncio.wait_for(socket.send_json(message), timeout=2)
                self.clients[socket] = message["id"]
                trace("websocket.notified", message["payload"].get("job_id"), event_id=message["id"], type=message["type"], client_id=str(id(socket)))
            except Exception:
                self.clients.pop(socket, None)
                with suppress(Exception):
                    await asyncio.wait_for(socket.close(code=1013), timeout=.5)
        await asyncio.gather(*(send(socket) for socket in list(self.clients)))

    async def close(self):
        self.stopping = True
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
        if self.task:
            with suppress(asyncio.CancelledError):
                await self.task
        if self.dispatch_task:
            self.dispatch_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.dispatch_task


def create_app(database_path=None):
    path = str(Path(database_path or os.getenv("ARHAM_DB", ROOT / "data" / "trades.sqlite3")).resolve())

    @asynccontextmanager
    async def lifespan(app):
        with DatabaseOwner(path):
            initialize(path)
            bridge = WorkerBridge(path)
            app.state.bridge = bridge
            app.state.pull_lock = asyncio.Lock()
            await bridge.start()
            try:
                yield
            finally:
                await bridge.close()

    app = FastAPI(title="Arham Trade Desk", version="1.0.0", lifespan=lifespan)

    @app.middleware("http")
    async def no_cached_jobs(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(("/api/", "/getTrades", "/mock-bse/")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(sqlite3.OperationalError)
    async def database_unavailable(request, exc):
        log.error("Database operation failed: %s", exc)
        return JSONResponse({"detail": "Database temporarily unavailable; retry this action."}, status_code=503)

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(ROOT / "static" / "index.html")

    @app.get("/api/health")
    def health():
        with connect(path) as db:
            db.execute("SELECT 1")
        alive = app.state.bridge.process.returncode is None
        return JSONResponse({"status": "ok" if alive else "degraded", "worker_alive": alive, "worker_pid": app.state.bridge.process.pid}, status_code=200 if alive else 503)

    def trade_page(db, limit, offset, search, job_id=None):
        clauses, args = [], []
        if search:
            clauses.append("(instr(lower(trade_id),lower(?))>0 OR instr(lower(client),lower(?))>0 OR instr(lower(symbol),lower(?))>0)")
            args.extend([search] * 3)
        if job_id:
            clauses.append("job_id=?")
            args.append(job_id)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        total = db.execute("SELECT count(*) FROM trades" + where, args).fetchone()[0]
        rows = db.execute("SELECT * FROM trades" + where + " ORDER BY timestamp DESC,trade_id LIMIT ? OFFSET ?", [*args, limit, offset]).fetchall()
        return {"items": [{**dict(r), "price": r["price_paise"] / 100} for r in rows], "total": total, "limit": limit, "offset": offset}

    def trade_summary(db):
        stats = dict(db.execute("SELECT count(*) AS trade_count,count(DISTINCT client) AS client_count,coalesce(sum(quantity),0) AS quantity,coalesce(sum(quantity*price_paise),0) AS value_paise FROM trades").fetchone())
        stats["symbols"] = [dict(r) for r in db.execute("SELECT symbol,count(*) AS trades,sum(quantity*price_paise) AS value_paise FROM trades GROUP BY symbol ORDER BY value_paise DESC")]
        return stats

    @app.get("/api/trades")
    def trades(limit: int = Query(50, ge=1, le=10000), offset: int = Query(0, ge=0),
               search: str = Query("", max_length=100), job_id: str | None = None):
        with snapshot(path) as db:
            return trade_page(db, limit, offset, search, job_id)

    @app.get("/api/summary")
    def summary():
        with snapshot(path) as db:
            return trade_summary(db)

    @app.get("/api/dashboard")
    def dashboard(limit: int = Query(50, ge=1, le=10000), offset: int = Query(0, ge=0),
                  search: str = Query("", max_length=100)):
        with snapshot(path) as db:
            return {"trades": trade_page(db, limit, offset, search), "summary": trade_summary(db),
                    "jobs": [dict(r) for r in db.execute("SELECT * FROM jobs ORDER BY created_at DESC,id LIMIT 20")], "server_time": now()}

    @app.get("/api/pulls")
    def pulls():
        with connect(path) as db:
            return {"items": [dict(r) for r in db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20")]}

    @app.get("/api/pulls/{job_id}")
    def pull_status(job_id: str):
        job = get_job(path, job_id)
        if not job:
            raise HTTPException(404, "Pull not found")
        return job

    async def enqueue(request):
        async with app.state.pull_lock:
            bridge = app.state.bridge
            if bridge.process.returncode is not None:
                if bridge.task:
                    await bridge.task
                await bridge.start()
            job_id = str(uuid4())
            def persist_job():
                with connect(path) as db:
                    db.execute("INSERT INTO jobs(id,status,delay_seconds,record_count,seed,created_at) VALUES (?,'queued',?,?,?,?)", (job_id, request.delay_seconds, request.record_count, request.seed, now()))
                    event(db, "pull.queued", {"job_id": job_id})
            try:
                await asyncio.to_thread(persist_job)
            except sqlite3.IntegrityError:
                with connect(path) as db:
                    active = db.execute("SELECT id FROM jobs WHERE status IN ('queued','running')").fetchone()
                raise HTTPException(409, {"message": "A pull is already in progress", "job_id": active["id"] if active else None})
            bridge.wake.set()
            try:
                await bridge.submit(job_id)
            except (RuntimeError, BrokenPipeError, ConnectionError):
                with connect(path) as db:
                    db.execute("UPDATE jobs SET status='failed',error='Worker unavailable',finished_at=? WHERE id=?", (now(), job_id))
                    eid = event(db, "pull.failed", {"job_id": job_id, "error": "Worker unavailable"})
                bridge.wake.set()
                raise HTTPException(503, "Worker unavailable; retry")
            trace("http.accepted", job_id, delay_seconds=request.delay_seconds)
            return job_id

    @app.post("/api/pulls", status_code=202)
    async def start_pull(request: PullRequest, response: Response):
        job_id = await enqueue(request)
        response.headers["Location"] = f"/api/pulls/{job_id}"
        return {"job_id": job_id, "status": "accepted", "status_url": f"/api/pulls/{job_id}"}

    @app.get("/getTrades")
    async def mock_exchange(
        delay_seconds: float = Query(5, ge=0, le=900, allow_inf_nan=False),
        record_count: int = Query(3000, ge=1, le=10000),
        seed: int = Query(42, ge=0, le=2147483647), job_id: str | None = None,
    ):
        """Async mock exchange contract: fast 202, then 200 seeded trade data."""
        if not job_id:
            job_id = await enqueue(PullRequest(delay_seconds=delay_seconds, record_count=record_count, seed=seed))
            # Always acknowledge a newly accepted command, even if delay=0 finished already.
            return JSONResponse({"job_id": job_id, "status": "accepted", "result_url": f"/getTrades?job_id={job_id}"}, status_code=202, headers={"Location": f"/getTrades?job_id={job_id}"})
        job = get_job(path, job_id)
        if not job:
            raise HTTPException(404, "Pull not found")
        if job["status"] == "failed":
            raise HTTPException(502, "Mock exchange pull failed")
        if job["status"] != "completed":
            return JSONResponse({"job_id": job_id, "status": job["status"], "result_url": f"/getTrades?job_id={job_id}"}, status_code=202, headers={"Location": f"/getTrades?job_id={job_id}"})
        # Deduplicated trades may belong to an earlier pull of the same seed.
        prefix = f"BSE-{job['seed']:010d}-"
        with connect(path) as db:
            rows = db.execute("SELECT * FROM trades WHERE trade_id LIKE ? ORDER BY trade_id LIMIT ?", (prefix + "%", job["record_count"])).fetchall()
        return {"job_id": job_id, "status": "completed", "items": [{**dict(r), "price": r["price_paise"] / 100} for r in rows], "total": len(rows)}

    @app.get("/mock-bse/getTrades")
    async def direct_provider(
        delay_seconds: float = Query(0, ge=0, le=900, allow_inf_nan=False),
        record_count: int = Query(3000, ge=1, le=10000), seed: int = Query(42, ge=0, le=2147483647),
    ):
        """Literal mock-provider demo: waits then returns 200; not the ingestion route.

        Delays >=30 seconds can fail behind the stipulated HTTP cutoff. The worker
        uses the same generator locally, not this long-lived network request.
        """
        await asyncio.sleep(delay_seconds)
        items = await asyncio.to_thread(lambda: [{**t, "price": t["price_paise"] / 100} for t in generate_trades(seed, record_count)])
        return {"items": items, "total": len(items), "simulated_exchange_date": "2026-01-01"}

    @app.websocket("/ws")
    async def websocket(socket: WebSocket, after: int = Query(0, ge=0)):
        await socket.accept()
        bridge = app.state.bridge
        try:
            # Register and replay under the broadcast lock to avoid lost completion events.
            async with bridge.lock:
                with connect(path) as db:
                    latest = db.execute("SELECT coalesce(max(id),0) FROM events").fetchone()[0]
                # A restored/replaced local DB may have fewer events than the old browser.
                cursor = min(after, latest)
                while batch := await asyncio.to_thread(read_events, path, cursor):
                    for item in batch:
                        await asyncio.wait_for(socket.send_json(item), timeout=2)
                        cursor = item["id"]
                await socket.send_json({"type": "connected", "cursor": cursor})
                bridge.clients[socket] = cursor
            while True:
                message = await socket.receive_text()
                if message == "ping":
                    await socket.send_json({"type": "pong"})
        except (WebSocketDisconnect, RuntimeError, asyncio.TimeoutError):
            pass
        finally:
            bridge.clients.pop(socket, None)

    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
    return app


app = create_app()

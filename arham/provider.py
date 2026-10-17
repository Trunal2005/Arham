"""Deterministic mock exchange data; no credentials or external network."""
import random
from datetime import datetime, timedelta, timezone

SYMBOLS = {"RELIANCE": 295000, "TCS": 410000, "INFY": 185000,
           "HDFCBANK": 172000, "ICICIBANK": 125000, "ITC": 48500,
           "LT": 355000, "SBIN": 81000}


def generate_trades(seed, count):
    rng = random.Random(seed)
    base = datetime(2026, 1, 1, 3, 45, tzinfo=timezone.utc)
    for index in range(count):
        symbol = rng.choice(list(SYMBOLS))
        yield {
            "trade_id": f"BSE-{seed:010d}-{index + 1:06d}",
            "client": f"CL-{rng.randint(1, 80):04d}",
            "symbol": symbol,
            "quantity": rng.randint(1, 200) * 5,
            "price_paise": max(1, SYMBOLS[symbol] + rng.randint(-1500, 1500)),
            "timestamp": (base + timedelta(seconds=index)).isoformat(),
        }

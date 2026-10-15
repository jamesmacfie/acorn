def backoff_delays(attempts: int, base: float = 0.5, cap: float = 30.0) -> list[float]:
    """Seconds to wait before each attempt: none before the first, then doubling up to `cap`."""
    return [0.0] + [min(cap, base * 2**n) for n in range(attempts - 1)]

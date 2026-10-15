import time

import httpx

from billing.webhooks.backoff import backoff_delays
from billing.webhooks.events import WebhookEvent, sign

MAX_ATTEMPTS = 5


def deliver(client: httpx.Client, url: str, event: WebhookEvent, sleep=time.sleep) -> bool:
    """Send one event to a customer's endpoint, retrying a server error with backoff.

    True when the endpoint accepted it. A 4xx answer is final: the customer's endpoint refused the
    event, and sending it again won't change that.
    """
    body = event.model_dump_json()
    headers = {"x-fernwood-signature": sign(body)}
    for delay in backoff_delays(MAX_ATTEMPTS):
        sleep(delay)
        try:
            response = client.post(url, content=body, headers=headers)
        except httpx.TransportError:
            continue
        if response.status_code < 500:
            return response.is_success
    return False

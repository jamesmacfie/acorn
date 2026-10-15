import httpx

from billing.webhooks.events import WebhookEvent, sign


def deliver(client: httpx.Client, url: str, event: WebhookEvent) -> bool:
    """Send one event to a customer's endpoint. True when the endpoint accepted it."""
    body = event.model_dump_json()
    response = client.post(url, content=body, headers={"x-fernwood-signature": sign(body)})
    return response.is_success

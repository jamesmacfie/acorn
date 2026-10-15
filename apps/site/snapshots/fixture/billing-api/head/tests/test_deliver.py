import httpx
import respx

from billing.webhooks.deliver import MAX_ATTEMPTS, deliver
from tests.factories import invoice_paid

URL = "https://hooks.example.com/fernwood"


@respx.mock
def test_delivers_an_event():
    respx.post(URL).respond(204)
    assert deliver(httpx.Client(), URL, invoice_paid(), sleep=lambda _: None)


@respx.mock
def test_retries_a_server_error():
    route = respx.post(URL).mock(side_effect=[httpx.Response(503), httpx.Response(204)])
    assert deliver(httpx.Client(), URL, invoice_paid(), sleep=lambda _: None)
    assert route.call_count == 2


@respx.mock
def test_gives_up_after_five_attempts():
    route = respx.post(URL).respond(502)
    assert not deliver(httpx.Client(), URL, invoice_paid(), sleep=lambda _: None)
    assert route.call_count == MAX_ATTEMPTS


@respx.mock
def test_does_not_retry_a_refusal():
    route = respx.post(URL).respond(410)
    assert not deliver(httpx.Client(), URL, invoice_paid(), sleep=lambda _: None)
    assert route.call_count == 1

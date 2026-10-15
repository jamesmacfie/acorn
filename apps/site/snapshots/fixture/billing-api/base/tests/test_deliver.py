import httpx
import respx

from billing.webhooks.deliver import deliver
from tests.factories import invoice_paid

URL = "https://hooks.example.com/fernwood"


@respx.mock
def test_delivers_an_event():
    respx.post(URL).respond(204)
    assert deliver(httpx.Client(), URL, invoice_paid())

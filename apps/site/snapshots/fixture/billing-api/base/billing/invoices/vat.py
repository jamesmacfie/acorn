from decimal import Decimal

# Standard rates, by country code. Reduced rates live with the product catalogue.
RATES = {
    "DE": Decimal("0.19"),
    "FR": Decimal("0.20"),
    "IE": Decimal("0.23"),
    "NL": Decimal("0.21"),
}


def vat_for(country: str, net: Decimal) -> Decimal:
    rate = RATES.get(country, Decimal("0"))
    return (net * rate).quantize(Decimal("0.01"))

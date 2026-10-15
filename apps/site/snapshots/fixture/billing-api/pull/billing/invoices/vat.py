from decimal import Decimal

# Standard rates, by country code. Reduced rates live with the product catalogue.
RATES = {
    "AT": Decimal("0.20"),
    "BE": Decimal("0.21"),
    "DE": Decimal("0.19"),
    "ES": Decimal("0.21"),
    "FR": Decimal("0.20"),
    "IE": Decimal("0.23"),
    "IT": Decimal("0.22"),
    "NL": Decimal("0.21"),
}


def vat_for(country: str, net: Decimal, *, business: bool = False) -> Decimal:
    """VAT on a net amount. A business customer in another EU country pays none: they account for it
    themselves under the reverse charge."""
    if business and country != "IE":
        return Decimal("0.00")
    rate = RATES.get(country, Decimal("0"))
    return (net * rate).quantize(Decimal("0.01"))

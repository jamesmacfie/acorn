from decimal import Decimal

from billing.invoices.vat import vat_for


def test_charges_the_standard_rate():
    assert vat_for("DE", Decimal("100.00")) == Decimal("19.00")


def test_reverse_charges_a_business_abroad():
    assert vat_for("FR", Decimal("100.00"), business=True) == Decimal("0.00")


def test_charges_an_irish_business():
    assert vat_for("IE", Decimal("100.00"), business=True) == Decimal("23.00")

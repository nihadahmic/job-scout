from collector.text import dedupe_key, html_to_text, iso_from_rfc822


def test_html_to_text_keeps_structure():
    text = html_to_text(
        "<h3>About</h3><p>We build&nbsp;tools.</p><ul><li>One</li><li>Two</li></ul>"
    )
    assert text == "About\n\nWe build tools.\n\n- One\n- Two"


def test_html_to_text_handles_escaped_html():
    assert html_to_text("&lt;p&gt;Hello &amp;amp; bye&lt;/p&gt;") == "Hello & bye"


def test_dedupe_key_ignores_noise():
    a = dedupe_key("Acme Inc.", "Senior Product Manager (Remote) (m/f/d)")
    b = dedupe_key("ACME", "Senior Product Manager - Remote")
    assert a == b


def test_dedupe_key_keeps_region_and_team_variants_apart():
    assert dedupe_key("Intel 471", "Enablement Manager (US, Remote)") != dedupe_key(
        "Intel 471", "Enablement Manager (Europe, Remote)"
    )
    assert dedupe_key("ThriveCart", "Product Manager (ThrivePages)") != dedupe_key(
        "ThriveCart", "Product Manager (ThriveStudio)"
    )


def test_dedupe_key_keeps_different_roles_apart():
    assert dedupe_key("Acme", "Product Manager") != dedupe_key("Acme", "Product Owner")


def test_rfc822():
    assert iso_from_rfc822("Wed, 25 Nov 2026 06:02:20 +0000") == "2026-11-25T06:02:20+00:00"
    assert iso_from_rfc822("not a date") is None

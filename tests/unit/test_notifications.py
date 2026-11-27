"""Notifications (TDD 20): push transport against published vectors, and copy.

The encryption test uses RFC 8291 Appendix A's published inputs and output, not
a round trip through our own code; the VAPID signature is checked with an
independent cryptography primitive. Every name is synthetic.
"""

import asyncio
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from accanto.domains import notifications as rules
from accanto.services.push import (
    PushResult,
    WebPushSender,
    decode_key,
    encrypt_payload,
    new_private_key,
    public_key_of,
)

PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
PUBLIC = (
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx"
    "aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
)
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
# Appendix A's application server public key, the pair of PRIVATE (as_public).
SERVER_PUBLIC = (
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK"
    "6PBru3jl7A8"
)
ORIGIN = "https://accanto.example.test"


def device(endpoint="https://web.push.apple.com/synthetic"):
    return {"uuid": "d", "endpoint": endpoint, "p256dh": PUBLIC, "auth": AUTH}


@pytest.mark.parametrize(
    "host",
    [
        "push.apple.com",
        "web.push.apple.com",
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "wns2.notify.windows.com",
    ],
)
def test_push_services_are_allowed(host):
    assert rules.is_allowed_endpoint(f"https://{host}/subscription")


@pytest.mark.parametrize(
    "url",
    [
        "http://push.apple.com/x",
        "https://evilpush.apple.com/x",
        "https://fcm.googleapis.com.evil.example/x",
        "https://push.apple.com:443/x",
        "https://:@push.apple.com/x",  # userinfo, even empty
        "https://127.0.0.1/x",
        "https://[::1]/x",
        "https://push.apple.com./x",
        "https://push.apple.com/x#fragment",
        "https://push.apple.com\\@evil.example/x",
        " https://push.apple.com/x",
        "https://push.apple.com",
        "",
    ],
)
def test_other_endpoints_are_refused(url):
    assert not rules.is_allowed_endpoint(url)


def test_rfc8291_appendix_a():
    private = ec.derive_private_key(int.from_bytes(decode_key(PRIVATE)), ec.SECP256R1())
    encrypted = encrypt_payload(
        b"When I grow up, I want to be a watermelon",
        decode_key(PUBLIC),
        decode_key(AUTH),
        private_key=private,
        salt=decode_key("DGv6ra1nlYgDCS1FRnbzlw"),
    )
    assert encrypted == decode_key(
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDl"
        "l6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2K"
        "s3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    )


def test_generated_key_pair_matches():
    key = new_private_key()
    public = decode_key(public_key_of(key))
    assert len(decode_key(key)) == 32 and len(public) == 65 and public[0] == 4


@pytest.mark.parametrize(
    ("status", "result"),
    [
        (201, PushResult.DELIVERED),
        (404, PushResult.GONE),
        (410, PushResult.GONE),
        (200, PushResult.ERROR),
        (307, PushResult.ERROR),
        (429, PushResult.ERROR),
        (500, PushResult.ERROR),
    ],
)
def test_send_signs_with_vapid_and_maps_responses(status, result):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(status, headers={"Location": "http://127.0.0.1/x"})

    async def run():
        transport = httpx.MockTransport(respond)
        async with httpx.AsyncClient(transport=transport) as client:
            sender = WebPushSender(PRIVATE, ORIGIN, client=client, clock=lambda: 1000)
            notice = rules.routines_due(["Saturday check"], "2026-11-28", "e")
            return await sender.send(device(), notice)

    assert asyncio.run(run()) == result
    assert len(requests) == 1  # no redirect followed and no retry
    request = requests[0]
    assert request.headers["TTL"] == "21600"
    assert request.headers["Content-Encoding"] == "aes128gcm"
    assert re.fullmatch(r"[A-Za-z0-9_-]{32}", request.headers["Topic"])
    token, key = request.headers["Authorization"].removeprefix("vapid t=").split(", k=")
    assert key == SERVER_PUBLIC
    header, claims, signature = token.split(".")
    assert json.loads(decode_key(header))["alg"] == "ES256"
    assert json.loads(decode_key(claims)) == {
        "aud": "https://web.push.apple.com",
        "exp": 1000 + 12 * 3600,
        "sub": ORIGIN,
    }
    raw = decode_key(signature)
    ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), decode_key(key)
    ).verify(
        encode_dss_signature(int.from_bytes(raw[:32]), int.from_bytes(raw[32:])),
        f"{header}.{claims}".encode(),
        ec.ECDSA(hashes.SHA256()),
    )
    assert request.content[16:21] == b"\0\0\x10\0\x41"


def test_refused_or_malformed_devices_are_never_contacted():
    def unexpected(request):
        pytest.fail("network attempted")

    async def run(stored):
        transport = httpx.MockTransport(unexpected)
        async with httpx.AsyncClient(transport=transport) as client:
            sender = WebPushSender(PRIVATE, ORIGIN, client=client)
            return await sender.send(stored, rules.confirmation())

    for stored in (
        device("https://evilpush.apple.com/x"),
        device("http://push.apple.com/x"),
        {**device(), "p256dh": "AAAA"},
        {**device(), "auth": "not base64url!"},
    ):
        assert asyncio.run(run(stored)) == PushResult.ERROR


def test_send_time_is_the_first_tick_at_or_after_the_hour():
    zone = ZoneInfo("America/New_York")
    assert not rules.is_send_time(datetime(2026, 11, 28, 8, 59, tzinfo=zone), 9)
    assert rules.is_send_time(datetime(2026, 11, 28, 9, 0, tzinfo=zone), 9)
    # A tick that drifted past the hour still sends that day.
    assert rules.is_send_time(datetime(2026, 11, 28, 11, 5, tzinfo=zone), 9)


def test_copy_carries_names_and_counts_only():
    on, entity = "2026-11-28", "e"
    assert rules.routines_due(["Saturday check"], on, entity).body == (
        "Saturday check is due today."
    )
    assert rules.routines_due(["A", "B", "C"], on, entity).body == (
        "A, B and C are due today."
    )
    assert rules.routines_due(["A", "B", "C", "D"], on, entity).body == (
        "A, B and 2 more routines are due today."
    )
    assert rules.scheduled_entries(1, on, entity).body == (
        "1 scheduled entry is waiting in your inbox."
    )
    assert rules.transactions_waiting(5, on, entity).body == (
        "5 transactions are waiting in your inbox."
    )
    hostile = rules.routines_due(["<b>Pay</b>\ncard\x07" + "x" * 200], on, entity)
    assert "\n" not in hostile.body and "\x07" not in hostile.body
    assert len(hostile.body) <= rules.NAME_LIMIT + len(" is due today.")
    payload = rules.scheduled_entries(2, on, entity).payload(ORIGIN + "/")
    assert payload["web_push"] == 8030
    assert payload["notification"]["navigate"] == ORIGIN + "/#/inbox"
    assert payload["notification"]["title"] == "Accanto"


def test_defaults_are_quiet():
    assert rules.DEFAULTS == {
        "hour": 9,
        "routines_due": True,
        "scheduled_entries": True,
        "transactions_waiting": False,
    }

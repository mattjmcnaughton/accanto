"""Web Push transport (TDD 20): RFC 8291 encryption and RFC 8292 VAPID.

After aleph's services/push.py. A Device's endpoint URL is a capability: it is
never logged, traced or put in an error. The sender never retries or follows
redirects; the tick tries again the next day.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
from collections.abc import Callable, Mapping
from enum import StrEnum
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit

import httpx
import logfire
import structlog
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from accanto.domains.notifications import Notice, is_allowed_endpoint

Device = Mapping  # a push_device row: uuid, endpoint, p256dh, auth
LOOPBACK = ("http://127.0.0.1:", "http://localhost:")
log = structlog.get_logger(__name__)


def encode_key(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def decode_key(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value):
        raise ValueError("Invalid base64url key")
    bare = value.rstrip("=")
    raw = base64.urlsafe_b64decode(bare + "=" * (-len(bare) % 4))
    if encode_key(raw) != bare:
        raise ValueError("Noncanonical base64url key")
    return raw


def subscription_keys(p256dh: str, auth: str) -> tuple[bytes, bytes]:
    """A subscription's uncompressed P-256 public key and 16-byte auth secret."""
    public, secret = decode_key(p256dh), decode_key(auth)
    if len(public) != 65 or public[0] != 4 or len(secret) != 16:
        raise ValueError("Expected an uncompressed P-256 key and 16-byte secret")
    ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
    return public, secret


def public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


def load_private_key(value: str) -> ec.EllipticCurvePrivateKey:
    """VAPID_PRIVATE_KEY: a raw base64url P-256 scalar, or a PEM key."""
    if value.startswith("-----BEGIN"):
        key = serialization.load_pem_private_key(value.encode(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(
            key.curve, ec.SECP256R1
        ):
            raise ValueError("VAPID requires a P-256 private key")
        return key
    raw = decode_key(value)
    if len(raw) != 32:
        raise ValueError("VAPID requires a 32-byte P-256 scalar")
    return ec.derive_private_key(int.from_bytes(raw), ec.SECP256R1())


def new_private_key() -> str:
    """A fresh VAPID private key, as `just vapid-keys` prints it."""
    key = ec.generate_private_key(ec.SECP256R1())
    return encode_key(key.private_numbers().private_value.to_bytes(32))


def public_key_of(private_key: str) -> str:
    return encode_key(public_bytes(load_private_key(private_key).public_key()))


def encrypt_payload(
    payload: bytes,
    public: bytes,
    auth: bytes,
    *,
    private_key: ec.EllipticCurvePrivateKey | None = None,
    salt: bytes | None = None,
) -> bytes:
    """One aes128gcm record of size 4096 (RFC 8291 §3.4 and §4, RFC 8188 §2).

    The key and salt are parameters only so RFC 8291 Appendix A can be checked;
    every send uses a fresh ephemeral key and salt.
    """
    if len(payload) > 3993:
        raise ValueError("Push payload exceeds one Web Push record")
    private_key = private_key or ec.generate_private_key(ec.SECP256R1())
    salt = salt if salt is not None else os.urandom(16)
    sender = public_bytes(private_key.public_key())
    receiver = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
    shared = private_key.exchange(ec.ECDH(), receiver)

    def hkdf(salt, info, length, key):
        return HKDF(hashes.SHA256(), length, salt, info).derive(key)

    ikm = hkdf(auth, b"WebPush: info\0" + public + sender, 32, shared)
    cek = hkdf(salt, b"Content-Encoding: aes128gcm\0", 16, ikm)
    nonce = hkdf(salt, b"Content-Encoding: nonce\0", 12, ikm)
    return (
        salt
        + (4096).to_bytes(4)
        + bytes([65])
        + sender
        + AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    )


def es256_jwt(claims: dict, key: ec.EllipticCurvePrivateKey) -> str:
    """A compact JWS with ES256 (RFC 7518 §3.4): r and s, 32 bytes each."""
    header = encode_key(b'{"typ":"JWT","alg":"ES256"}')
    body = encode_key(json.dumps(claims, separators=(",", ":")).encode())
    signing_input = f"{header}.{body}".encode()
    r, s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    return f"{header}.{body}.{encode_key(r.to_bytes(32) + s.to_bytes(32))}"


class PushResult(StrEnum):
    # Accepted by the push service; not proof the phone showed it.
    DELIVERED = "delivered"
    GONE = "gone"  # the push service no longer knows the subscription
    ERROR = "error"
    DISABLED = "disabled"  # no VAPID key: nothing was sent


class PushSender(Protocol):
    async def send(self, device: Device, notice: Notice) -> PushResult: ...


class NullPushSender:
    async def send(self, device: Device, notice: Notice) -> PushResult:
        return PushResult.DISABLED


class RecordingPushSender:
    """Local tests only: appends each payload to a file instead of sending it.

    The e2e journey and the trace privacy test run the server and the tick as
    separate processes; this file is how they see what would have been sent.
    """

    def __init__(self, path: str, origin: str):
        self.path, self.origin = Path(path), origin

    async def send(self, device: Device, notice: Notice) -> PushResult:
        payload = notice.payload(self.origin)
        line = {"device_id": str(device["uuid"]), "payload": payload}
        with self.path.open("a") as file:
            file.write(json.dumps(line) + "\n")
        return PushResult.DELIVERED


class WebPushSender:
    def __init__(
        self,
        private_key: str,
        origin: str,
        *,
        client: httpx.AsyncClient | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self._private = load_private_key(private_key)
        self.public_key = encode_key(public_bytes(self._private.public_key()))
        self._origin = origin
        self._client = client
        self._clock = clock
        self._tokens: dict[str, tuple[int, str]] = {}

    def _token(self, audience: str) -> str:
        now = int(self._clock())
        cached = self._tokens.get(audience)
        if cached is None or cached[0] - now <= 3600:
            expiry = now + 12 * 3600
            claims = {"aud": audience, "exp": expiry, "sub": self._origin}
            self._tokens[audience] = expiry, es256_jwt(claims, self._private)
        return self._tokens[audience][1]

    async def send(self, device: Device, notice: Notice) -> PushResult:
        # Stored rows are checked again before any crypto or network activity.
        if not is_allowed_endpoint(device["endpoint"]):
            return PushResult.ERROR
        try:
            public, auth = subscription_keys(device["p256dh"], device["auth"])
            payload = json.dumps(
                notice.payload(self._origin), separators=(",", ":")
            ).encode()
            audience = "https://" + str(urlsplit(device["endpoint"]).hostname)
            vapid = f"vapid t={self._token(audience)}, k={self.public_key}"
            headers = {
                "Authorization": vapid,
                "Content-Encoding": "aes128gcm",
                "Content-Type": "application/octet-stream",
                "TTL": str(notice.ttl),
                "Urgency": "normal",
                "Topic": encode_key(hashlib.sha256(notice.tag.encode()).digest()[:24]),
            }
            content = encrypt_payload(payload, public, auth)

            async def post(client: httpx.AsyncClient) -> httpx.Response:
                return await client.post(
                    device["endpoint"],
                    content=content,
                    headers=headers,
                    follow_redirects=False,
                    timeout=10,
                )

            # The endpoint URL is a capability, not trace metadata.
            with logfire.suppress_instrumentation():
                if self._client is not None:
                    response = await post(self._client)
                else:
                    async with httpx.AsyncClient(trust_env=False) as client:
                        response = await post(client)
        except (ValueError, httpx.HTTPError):
            # Never log the exception: httpx errors quote the endpoint URL.
            return PushResult.ERROR
        if response.status_code == 201:
            return PushResult.DELIVERED
        if response.status_code in (404, 410):
            return PushResult.GONE
        return PushResult.ERROR


def configured_key(config) -> str | None:
    """The VAPID public key, or None when push is off or the key is unusable."""
    key = config.vapid_private_key.get_secret_value()
    if not key:
        return None
    try:
        return public_key_of(key)
    except ValueError:
        log.warning("push_key_invalid")
        return None


def sender_for(config) -> PushSender:
    """The configured sender. Without a usable VAPID key nothing is sent."""
    if config.push_record_file:
        if not config.browser_origin.startswith(LOOPBACK):
            raise ValueError("PUSH_RECORD_FILE needs a loopback BROWSER_ORIGIN")
        return RecordingPushSender(config.push_record_file, config.browser_origin)
    if configured_key(config):
        return WebPushSender(
            config.vapid_private_key.get_secret_value(), config.browser_origin
        )
    return NullPushSender()

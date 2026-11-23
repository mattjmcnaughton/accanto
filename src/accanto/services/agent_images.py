"""Images attached to an assistant message: validated, normalised, never stored.

An image is untrusted data. It is checked by magic bytes, decoded under a pixel cap,
and re-encoded to a fresh JPEG of at most 1568 px on the long side, which drops EXIF
and any other metadata. Only the re-encoded bytes reach the model, and only for the
turn; messages keep an image count (TDD 03, Images).
"""

import io

from PIL import Image, UnidentifiedImageError

from accanto.services.access import RejectionError

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_EDGE = 1568
# Decoding more pixels than this is refused before any pixel data is read.
MAX_PIXELS = 40_000_000
_SIGNATURES = {
    "JPEG": (b"\xff\xd8\xff",),
    "PNG": (b"\x89PNG\r\n\x1a\n",),
}


def _format(data: bytes) -> str | None:
    for name, prefixes in _SIGNATURES.items():
        if data.startswith(prefixes):
            return name
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def _reject(message: str) -> RejectionError:
    return RejectionError("image_rejected", message, 422)


def normalise(data: bytes) -> bytes:
    """One attached image as re-encoded JPEG bytes, or image_rejected."""
    if len(data) > MAX_IMAGE_BYTES:
        raise _reject("Each image must be 5 MB or smaller.")
    kind = _format(data)
    if kind is None:
        raise _reject("Attach a JPEG, PNG or WebP image.")
    try:
        with Image.open(io.BytesIO(data), formats=[kind]) as image:
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise _reject("That image is too large to read.")
            image.load()
            image = image.convert("RGB")
            image.thumbnail((MAX_EDGE, MAX_EDGE))
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=85)
    except RejectionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise _reject("That image could not be read.") from None
    return out.getvalue()


def normalise_all(images: list[bytes]) -> list[bytes]:
    if len(images) > MAX_IMAGES:
        raise _reject("Attach at most 4 images.")
    return [normalise(data) for data in images]

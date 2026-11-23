"""Attached images: magic bytes, size and pixel caps, re-encoded without EXIF."""

import io

import pytest
from PIL import Image

from accanto.services import agent_images
from accanto.services.access import RejectionError


def encode(fmt: str, size=(40, 30), **save) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (200, 120, 40)).save(out, format=fmt, **save)
    return out.getvalue()


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_accepts_jpeg_png_and_webp_as_fresh_jpeg(fmt):
    result = agent_images.normalise(encode(fmt))
    with Image.open(io.BytesIO(result)) as image:
        assert image.format == "JPEG"
        assert image.size == (40, 30)


def test_drops_exif():
    exif = Image.Exif()
    exif[0x010F] = "Synthetic camera maker"  # Make
    exif[0x8825] = {2: (1.0, 2.0, 3.0)}  # GPSInfo
    data = encode("JPEG", exif=exif.tobytes())
    assert b"Synthetic camera maker" in data
    result = agent_images.normalise(data)
    assert b"Synthetic camera maker" not in result
    with Image.open(io.BytesIO(result)) as image:
        assert not image.getexif()


def test_scales_the_long_edge_to_1568_keeping_aspect():
    result = agent_images.normalise(encode("PNG", size=(3136, 1000)))
    with Image.open(io.BytesIO(result)) as image:
        # 3136 / 2 = 1568; 1000 / 2 = 500.
        assert image.size == (1568, 500)


def rejection(call) -> str:
    with pytest.raises(RejectionError) as caught:
        call()
    assert caught.value.status == 422
    return caught.value.message


def test_rejects_by_content_not_name():
    # A GIF, an SVG and text claiming to be an image all fail the magic-byte check.
    gif = io.BytesIO()
    Image.new("RGB", (4, 4)).save(gif, format="GIF")
    for data in (gif.getvalue(), b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"hi"):
        assert "JPEG, PNG or WebP" in rejection(
            lambda d=data: agent_images.normalise(d)
        )


def test_rejects_truncated_images():
    data = encode("PNG", size=(200, 200))
    assert "could not be read" in rejection(lambda: agent_images.normalise(data[:60]))


def test_rejects_oversized_files_and_too_many_pixels(monkeypatch):
    big = b"\xff\xd8\xff" + b"\0" * agent_images.MAX_IMAGE_BYTES
    assert "5 MB" in rejection(lambda: agent_images.normalise(big))
    monkeypatch.setattr(agent_images, "MAX_PIXELS", 100)
    assert "too large" in rejection(lambda: agent_images.normalise(encode("PNG")))


def test_rejects_more_than_four_images():
    one = encode("JPEG")
    assert len(agent_images.normalise_all([one] * 4)) == 4
    assert "at most 4" in rejection(lambda: agent_images.normalise_all([one] * 5))

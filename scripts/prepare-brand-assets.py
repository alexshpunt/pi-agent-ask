"""Build branding images from assets/logo.png. Requires Python 3 and Pillow.

Run from any directory: python3 scripts/prepare-brand-assets.py
The source stays unchanged. Only the two WebP files go into the npm package.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ASSETS = Path(__file__).resolve().parent.parent / "assets"
SOURCE = Image.open(ASSETS / "logo.png").convert("RGB")


def card(size):
    """Fit the complete robot and a short pitch onto a white landscape card."""
    width, height = size
    image = Image.new("RGB", size, "white")
    robot = ImageOps.contain(
        SOURCE, (int(width * 0.46), height - 48), Image.Resampling.LANCZOS
    )
    image.paste(robot, (24, (height - robot.height) // 2))
    draw = ImageDraw.Draw(image)
    x = int(width * 0.51)
    title = ImageFont.truetype("DejaVuSans-Bold.ttf", int(width * 0.043))
    slogan = ImageFont.truetype("DejaVuSans-Bold.ttf", int(width * 0.04))
    body = ImageFont.truetype("DejaVuSans.ttf", int(width * 0.022))
    draw.text((x, height * 0.29), "Pi Agent Ask", font=title, fill="#181818")
    draw.text((x, height * 0.43), "What the fuck?", font=slogan, fill="#181818")
    draw.multiline_text(
        (x, height * 0.60),
        "Ask. Keep working.\nGet the answer.",
        font=body,
        fill="#444444",
        spacing=12,
    )
    return image


if __name__ == "__main__":
    ImageOps.contain(SOURCE, (720, 800), Image.Resampling.LANCZOS).save(
        ASSETS / "ask.webp", quality=85, method=6
    )
    card((1200, 675)).save(ASSETS / "ask-gallery.webp", quality=85, method=6)
    card((1280, 640)).save(ASSETS / "social-preview.png", optimize=True)
    for name in ("ask.webp", "ask-gallery.webp", "social-preview.png"):
        path = ASSETS / name
        with Image.open(path) as image:
            print(f"{name}: {image.width}x{image.height}, {path.stat().st_size:,} bytes")

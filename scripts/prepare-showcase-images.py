"""Prepare credited demo photography (requires Pillow).

Run once to refresh the images: python3 scripts/prepare-showcase-images.py
Then run node scripts/generate-showcase-documents.mjs.
The aurora is an artistic blue color grade, not its original recorded color.
"""
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

OUTPUT = Path(__file__).resolve().parents[1] / 'apps/demo/public/samples/showcase'
OUTPUT.mkdir(parents=True, exist_ok=True)


def download(url):
    request = Request(url, headers={'User-Agent': 'filens-demo-assets/1.0'})
    with urlopen(request, timeout=90) as response:
        return Image.open(BytesIO(response.read())).convert('RGB')


def save(image, name, size, center=(.5, .5), quality=92):
    ImageOps.fit(image, size, centering=center).save(
        OUTPUT / name, quality=quality, optimize=True
    )


original = download('https://upload.wikimedia.org/wikipedia/commons/9/91/Aurora_Borealis_Norway_2013.jpg')
# Soft pale-blue grade selected for the showcase.
aurora = original.convert('RGB', (
    .74, 0, .06, 0, .08, .62, .18, 0, .08, .64, .78, 3
))
save(aurora, 'aurora.jpg', (1600, 900), (.5, .4))
save(aurora, 'aurora-banner.jpg', (1400, 630), (.5, .35))
save(aurora, 'aurora-portrait.jpg', (960, 900), (.48, .45))

nebula = download('https://upload.wikimedia.org/wikipedia/commons/4/44/NASA%E2%80%99s_Webb_Reveals_Cosmic_Cliffs%2C_Glittering_Landscape_of_Star_Birth.jpg')
save(nebula, 'cosmic-cliffs.jpg', (1600, 900), (.55, .5), quality=90)
save(nebula, 'cosmic-cliffs-square.jpg', (900, 900), (.6, .5), quality=91)

night = download('https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/rogland_clear_night.jpg')
assert night.width == night.height * 2, 'A full equirectangular panorama is required.'
night.resize((4096, 2048), Image.Resampling.LANCZOS).save(
    OUTPUT / 'milky-way-360.jpg', quality=89, optimize=True
)
Image.new('RGB', (1200, 675), '#07162e').save(OUTPUT / 'midnight.png', optimize=True)
print(f'Prepared showcase photography in {OUTPUT}')

"""Prepare lossless 1x/2x WebP assets after refresh-landing-assets.js.

Authoring dependencies: Poppler and Pillow. These are not app dependencies.
"""
from pathlib import Path
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / 'public/images'
subprocess.run([
    'pdftoppm', '-f', '1', '-singlefile', '-scale-to-x', '1800',
    '-scale-to-y', '-1', '-png',
    str(ROOT / 'public/examples/klyo-proposal.pdf'),
    str(IMAGES / 'proposal-pdf'),
], check=True)

for stem, logical_width in [('personal-workspace', 1440), ('personal-settings', 900), ('proposal-pdf', 900)]:
    with Image.open(IMAGES / (stem + '.png')) as source:
        image = source.convert('RGB')
        assert image.width == logical_width * 2
        image.save(IMAGES / (stem + '@2x.webp'), 'WEBP', lossless=True, method=6)
        normal = image.resize((logical_width, round(image.height / 2)), Image.Resampling.LANCZOS)
        normal.save(IMAGES / (stem + '.webp'), 'WEBP', lossless=True, method=6)
        print(stem, '1x:', normal.size, '2x:', image.size)

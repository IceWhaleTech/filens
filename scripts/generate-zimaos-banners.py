"""Generate compact README banners from the official logo, without network access.

Requires rsvg-convert (librsvg) and a Chinese sans-serif font, such as
PingFang SC or Noto Sans CJK SC. Run: python3 scripts/generate-zimaos-banners.py
"""
import base64
from pathlib import Path
import subprocess
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/assets/readme'
LOGO = base64.b64encode(
    (ROOT / 'apps/demo/public/brand/zimaos-logo.png').read_bytes()
).decode('ascii')
COPY = {
    'zh-CN': {
        'tagline': '个人云，更简单。',
        'integration': 'ZimaOS 深度使用了 FiLens 项目',
        'features': '文件管理 · RAW / 全景 · 备份 · 800+ 应用',
        'cta': '了解更多',
    },
    'en': {
        'tagline': 'Your personal cloud, made simple.',
        'integration': 'Deep FiLens integration',
        'features': 'Files · RAW / 360° · Backup · 800+ apps',
        'cta': 'Explore',
    },
}

OUTPUT.mkdir(parents=True, exist_ok=True)
for locale, copy in COPY.items():
    text = {key: escape(value) for key, value in copy.items()}
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink" width="640" height="128" viewBox="0 0 640 128">
      <defs>
        <linearGradient id="background" x2="1" y2="1">
          <stop stop-color="#eef3f8"/>
          <stop offset="1" stop-color="#f8fafc"/>
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="639" height="127" rx="12"
        fill="url(#background)" stroke="#d9e1e9"/>
      <image x="22" y="32" width="64" height="64"
        xlink:href="data:image/png;base64,{LOGO}"/>
      <g font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">
        <text x="108" y="44" fill="#243448" font-size="24" font-weight="700">ZimaOS</text>
        <text x="207" y="43" fill="#526782" font-size="14">{text['tagline']}</text>
        <text x="108" y="71" fill="#243448" font-size="15" font-weight="600">{text['integration']}</text>
        <text x="108" y="96" fill="#58697a" font-size="12">{text['features']}</text>
        <rect x="512" y="46" width="106" height="36" rx="7" fill="#243448"/>
        <text x="559" y="69" fill="#ffffff" font-size="13" font-weight="600"
          text-anchor="middle">{text['cta']}</text>
      </g>
      <path d="M594 68l7-7m-7 0h7v7" fill="none" stroke="#ffffff"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>'''
    target = OUTPUT / f'zimaos-banner.{locale}.png'
    subprocess.run(
        ['rsvg-convert', '--width', '1280', '--height', '256', '--output', str(target)],
        input=svg.encode('utf-8'), check=True,
    )
    print(f'Generated {target.relative_to(ROOT)}')

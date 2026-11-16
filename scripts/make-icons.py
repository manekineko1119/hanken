# 半券のアイコン（フィルムの帯に、ミシン目で切り取ったチケット）を PNG で書き出す。
# 使い方：python scripts/make-icons.py  → icons/ に書き出す。
# 「半」の字は Windows の游明朝（C:/Windows/Fonts/yumindb.ttf）で描く。
# 512 の座標で描いて、4倍の大きさで描いてから縮める（線をなめらかにするため）。
import pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'icons'
FONT = 'C:/Windows/Fonts/yumindb.ttf'

BG = (29, 28, 26, 255)        # 夜の会場の黒
FILM = (42, 41, 38, 255)      # フィルムの帯
PAPER = (233, 223, 200, 255)  # 半券の紙（生成り）
INK = (74, 70, 62, 255)       # 「半」の字
K = 4                          # 描くときの倍率
S = 512 * K


def p(v):
    return v * K


def ticket_layer():
    """回す前のフィルムの帯と半券（512 の座標で、中心は 256,256）。"""
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([p(76), p(160), p(436), p(352)], radius=p(6), fill=FILM)
    for i in range(9):
        x = 92 + 36 * i
        for y in (168, 330):
            d.rounded_rectangle([p(x), p(y), p(x + 18), p(y + 14)], radius=p(3), fill=BG)
    # 半券の本体
    d.rounded_rectangle([p(96), p(194), p(306), p(318)], radius=p(4), fill=PAPER)
    # ミシン目（点線）
    y = 194
    while y < 318:
        d.rounded_rectangle([p(312.5), p(y), p(315.5), p(y + 2)], radius=p(1.5), fill=PAPER)
        y += 10
    # 「半」
    font = ImageFont.truetype(FONT, p(90))
    d.text((p(200), p(290)), '半', font=font, fill=INK, anchor='ms')

    # 切り取ったほう（少し回してずらし、うすくする）
    stub = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ds = ImageDraw.Draw(stub)
    ds.rounded_rectangle([p(322), p(194), p(418), p(318)], radius=p(4), fill=PAPER[:3] + (140,))
    stub = stub.rotate(-8, resample=Image.BICUBIC, center=(p(370), p(256)))
    stub = stub.transform(stub.size, Image.AFFINE, (1, 0, -p(10), 0, 1, p(6)), resample=Image.BICUBIC)
    layer.alpha_composite(stub)
    return layer.rotate(8, resample=Image.BICUBIC, center=(p(256), p(256)))


def render(size, rounded, scale=1.0):
    """rounded：角を丸める（ブラウザのタブ用）。scale：中身の大きさ（maskable は小さめ）。"""
    base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    if rounded:
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=p(112), fill=255)
    else:
        md.rectangle([0, 0, S - 1, S - 1], fill=255)
    bg = Image.new('RGBA', (S, S), BG)
    base.paste(bg, (0, 0), mask)
    art = ticket_layer()
    if scale != 1.0:
        n = int(S * scale)
        art = art.resize((n, n), Image.LANCZOS)
        pad = (S - n) // 2
        canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        canvas.alpha_composite(art, (pad, pad))
        art = canvas
    base.alpha_composite(art)
    return base.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    # ホーム画面（iPhone は自分で角を丸めるので、四角のまま）
    render(180, rounded=False).save(OUT / 'apple-touch-icon.png')
    # manifest 用（any は角丸、maskable は中身を小さくして四角のまま）
    render(192, rounded=True).save(OUT / 'icon-192.png')
    render(512, rounded=True).save(OUT / 'icon-512.png')
    render(512, rounded=False, scale=0.8).save(OUT / 'icon-maskable-512.png')
    # ブラウザのタブ
    render(32, rounded=True, scale=1.2).save(OUT / 'favicon-32.png')
    for f in sorted(OUT.iterdir()):
        print(f.name, Image.open(f).size)


if __name__ == '__main__':
    main()

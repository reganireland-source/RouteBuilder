"""
One-off generator for ShipTracker's 16-bit-style pixel-art ship sprites.

Hand-authored side-profile cable-ship silhouette (hull, waterline boot-top
stripe, deckhouse with lit windows, funnel, a stern A-frame cable gantry and
a deck-mounted cable-reel drum — the two features that read as "cable ship"
rather than a generic container/cargo vessel) drawn at a tiny base
resolution and scaled up with NEAREST so it reads as a crisp pixel-art
sprite rather than a blurred photo.

Colours are deliberately loose, not photo-matched — see the ShipTracker plan
file's note on this: no confirmed photo with describable hull-colour detail
turned up for any of the three ships during research. ASN Marine's fleet is
the one documented in general fleet material as white-hulled with a dark
blue boot-top and orange deck gear, so Ile d'Aix's palette reflects that;
Teneo and Fu Tai get distinct, plausible, generic cable-ship palettes so the
three are visually distinguishable in the dialog list, not reversed once a
real reference photo is available.

Not run as part of the build — a dev tool only. Re-run and commit the PNGs
by hand when a palette needs adjusting:
    python3 generate_ship_sprites.py ../public/ships
"""
from PIL import Image, ImageDraw

BASE_W, BASE_H = 32, 20
SCALE = 8


def draw_ship(palette: dict) -> Image.Image:
    img = Image.new("RGBA", (BASE_W, BASE_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    hull = palette["hull"]
    boot = palette["boot_top"]
    deckhouse = palette["superstructure"]
    window = palette["window"]
    funnel = palette["funnel"]
    gear = palette["deck_equipment"]

    # Hull freeboard (rows 13-16), with a tapered bow on the right (x=28-30).
    d.rectangle([3, 13, 27, 16], fill=hull)
    d.polygon([(27, 13), (30, 15), (27, 16)], fill=hull)  # bow taper
    d.polygon([(3, 13), (1, 14), (3, 16)], fill=hull)     # stern taper (slight)

    # Boot-top waterline stripe — overlaid on the hull's own bottom edge so
    # it reads as a band on the hull, not a separate floating bar beneath it.
    d.line([(3, 16), (27, 16)], fill=boot, width=1)

    # Deckhouse / bridge block (toward the stern, left side — cable ships
    # keep the working deck clear amidships/aft for cable gear).
    d.rectangle([5, 8, 13, 12], fill=deckhouse)
    d.point([(7, 9)], fill=window)
    d.point([(9, 9)], fill=window)
    d.point([(11, 9)], fill=window)
    d.point([(7, 11)], fill=window)
    d.point([(11, 11)], fill=window)

    # Funnel.
    d.rectangle([9, 5, 11, 8], fill=funnel)

    # Cable-reel drum amidships — the single biggest "this is a cable ship,
    # not a cargo ship" visual cue.
    d.ellipse([15, 9, 20, 13], fill=gear)
    d.ellipse([16, 10, 19, 12], fill=hull)  # drum hub, punched out

    # Stern A-frame cable gantry.
    d.line([(21, 13), (24, 7)], fill=gear, width=1)
    d.line([(26, 13), (23, 7)], fill=gear, width=1)
    d.line([(23, 7), (24, 7)], fill=gear, width=1)

    # Small deck crane boom toward the bow.
    d.line([(26, 12), (29, 9)], fill=gear, width=1)

    return img.resize((BASE_W * SCALE, BASE_H * SCALE), Image.NEAREST)


PALETTES = {
    "teneo": dict(
        hull="#2b3a4a", boot_top="#13202b", superstructure="#e8e8e0",
        window="#ffd84d", funnel="#c0392b", deck_equipment="#e07b1f",
    ),
    "ile-daix": dict(
        hull="#f2f2ec", boot_top="#1c3f6e", superstructure="#ffffff",
        window="#ffd84d", funnel="#1c3f6e", deck_equipment="#e8660c",
    ),
    "fu-tai": dict(
        hull="#1b1b1b", boot_top="#b22222", superstructure="#f0f0f0",
        window="#ffd84d", funnel="#b22222", deck_equipment="#c9c9c9",
    ),
    "generic": dict(
        hull="#4a4a4a", boot_top="#2a2a2a", superstructure="#dcdcdc",
        window="#ffd84d", funnel="#4a4a4a", deck_equipment="#8a8a8a",
    ),
}

if __name__ == "__main__":
    import sys
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    for slug, palette in PALETTES.items():
        img = draw_ship(palette)
        path = f"{out_dir}/{slug}.png"
        img.save(path)
        print("wrote", path, img.size)

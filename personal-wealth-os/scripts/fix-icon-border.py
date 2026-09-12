"""Remove the visible ring/border around the app icon's rounded-square background.

The 'any' purpose icons (icon-192.png, icon-512.png, favicon.png) were generated
with a lighter gray ring baked in between the transparent corner and the dark
fill. This composites the clean edge-to-edge fill+logo from the maskable icons
(which have no ring) using the existing rounded-rect alpha silhouette, so the
corner radius and the logo mark itself are unchanged -- only the ring is removed.
"""
from PIL import Image

ICONS_DIR = "public/icons"


def clean(any_path, maskable_path, out_path):
    any_img = Image.open(any_path).convert("RGBA")
    mask_img = Image.open(maskable_path).convert("RGBA")
    if mask_img.size != any_img.size:
        mask_img = mask_img.resize(any_img.size, Image.LANCZOS)

    alpha = any_img.split()[3]
    result = Image.new("RGBA", any_img.size)
    result.paste(mask_img, (0, 0))
    result.putalpha(alpha)
    result.save(out_path)
    print(f"wrote {out_path}")


clean(f"{ICONS_DIR}/icon-192.png", f"{ICONS_DIR}/icon-192-maskable.png", f"{ICONS_DIR}/icon-192.png")
clean(f"{ICONS_DIR}/icon-512.png", f"{ICONS_DIR}/icon-512-maskable.png", f"{ICONS_DIR}/icon-512.png")

# favicon.png has no dedicated maskable source; derive fill+logo from the
# clean 512 maskable icon, downscaled, masked with favicon's own silhouette.
favicon = Image.open("public/favicon.png").convert("RGBA")
mask_512 = Image.open(f"{ICONS_DIR}/icon-512-maskable.png").convert("RGBA")
fill = mask_512.resize(favicon.size, Image.LANCZOS)
alpha = favicon.split()[3]
result = Image.new("RGBA", favicon.size)
result.paste(fill, (0, 0))
result.putalpha(alpha)
result.save("public/favicon.png")
print("wrote public/favicon.png")

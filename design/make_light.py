"""Derive the light-mode artboards from the dark ones.

Same structure, different hour: midday sky instead of dusk. Kept as an ordered
replacement table rather than freehand files so the two modes stay pixel-for-
pixel comparable — that is the whole point of showing them side by side.
"""
import re

# Order matters: longer / more specific patterns first.
SWAPS = [
    # --- surfaces -----------------------------------------------------------
    ("#0B1020", "#FBF7F2"),          # page ground
    ("#080C18", "#EDF1F6"),          # deep water -> cool paper
    ("#10182E", "#F4F7FA"),
    ("rgba(12,18,36,0.82)", "rgba(255,255,255,0.9)"),
    ("rgba(12,18,36,0.72)", "rgba(255,255,255,0.84)"),
    ("rgba(8,12,24,0)", "rgba(237,241,246,0)"),
    ("rgba(11,16,32,0)", "rgba(251,247,242,0)"),

    # --- sky: dusk -> late morning ------------------------------------------
    ("#4A2A55", "#CFE2F5"),
    ("rgba(74,42,85,0)", "rgba(207,226,245,0)"),
    ("#1E3A6B", "#DCEAF7"),
    ("rgba(30,58,107,0)", "rgba(220,234,247,0)"),
    ("rgba(196,99,58,0.55)", "rgba(251,220,192,0.85)"),
    ("#C4633A", "#FBDCC0"),
    ("rgba(196,99,58,0)", "rgba(251,220,192,0)"),
    ("#FFC876", "#FFD9A0"),
    ("#E8763C", "#F0A868"),
    ("rgba(232,118,60,0)", "rgba(240,168,104,0)"),
    ("#3B2A55", "#B9C6D6"),

    # --- ink ----------------------------------------------------------------
    ("#F2EFEA", "#171A21"),
    ("rgba(242,239,234,", "rgba(23,26,33,"),

    # --- accent: amber darkened so it still passes on paper -----------------
    ("#FFD5A3", "#8A421A"),
    ("#FFB35C", "#C2622A"),
    ("rgba(255,179,92,", "rgba(194,98,42,"),
]

# White veils split by alpha: <=0.07 was a raised surface, >=0.08 a hairline.
FILL = re.compile(r"rgba\(255,255,255,0\.0[0-7]5?\)")
LINE = re.compile(r"rgba\(255,255,255,0\.(08|1|11|13|2)\)")

def fix_home_sky(s):
    """The home screen's sky needs designing for daylight, not swapping.

    On the dark artboard the sun sits in a dusk gradient and the horizon reads
    against near-black water. Recoloured naively it became an orange blob over
    the countdown with no horizon at all, so sky, sea, seam and sun are
    rebuilt here for midday.
    """
    old_sky_start = s.index("<!-- Dusk sky")
    old_sky_end = s.index("<!-- Header -->")
    return s[:old_sky_start] + """<!-- Midday sky: cool above, warm at the seam -->
  <div style="position: absolute; inset: 0; background:
      radial-gradient(120% 62% at 78% 2%, #CFE2F5 0%, rgba(207,226,245,0) 64%),
      radial-gradient(96% 46% at 14% 14%, #DCEAF7 0%, rgba(220,234,247,0) 70%),
      radial-gradient(150% 40% at 50% 38%, #FBE6CE 0%, rgba(251,230,206,0) 60%),
      #FBF7F2;"></div>

  <!-- Sea: cool enough that the horizon actually reads on paper -->
  <div style="position: absolute; inset-inline: 0; top: 336px; height: 508px; background: linear-gradient(180deg, #E4EDF6 0%, #EFF3F7 100%);"></div>
  <div style="position: absolute; inset-inline: 0; top: 335px; height: 1px; background: linear-gradient(90deg, rgba(194,98,42,0) 0%, #C2622A 50%, rgba(194,98,42,0) 100%); opacity: 0.55;"></div>

  <!-- Sun: pale, low, and behind the numeral rather than across it -->
  <div style="position: absolute; inset-inline-end: 64px; top: 288px; width: 108px; height: 108px; border-radius: 50%; background: radial-gradient(circle, rgba(255,199,133,0.85) 0%, rgba(240,168,104,0.42) 58%, rgba(240,168,104,0) 72%);"></div>

  """ + s[old_sky_end:]


SCREENS = {
    "Main.dc.html": "HomeLight.dc.html",
    "Itinerary.dc.html": "ItineraryLight.dc.html",
    "Suggestions.dc.html": "SuggestionsLight.dc.html",
    "AgentChat.dc.html": "AgentChatLight.dc.html",
}

for src, dst in SCREENS.items():
    s = open(src, encoding="utf-8").read()
    for a, b in SWAPS:
        s = s.replace(a, b)
    s = FILL.sub("rgba(255,255,255,0.92)", s)
    s = LINE.sub("rgba(23,26,33,0.1)", s)
    # A glow reads as smudge on paper; lift panels with a shadow instead.
    s = re.sub(r"text-shadow: 0 0 \d+px rgba\([^)]*\);", "text-shadow: none;", s)
    s = s.replace("box-shadow: 0 0 12px #C2622A;", "box-shadow: none;")
    s = s.replace("box-shadow: 0 0 14px rgba(194,98,42,0.8);", "box-shadow: none;")
    s = s.replace(
        "border: 1px solid rgba(23,26,33,0.1); backdrop-filter: blur(22px);",
        "border: 1px solid rgba(23,26,33,0.08); backdrop-filter: blur(22px); box-shadow: 0 6px 22px -12px rgba(23,26,33,0.3);",
    )
    # Raised surfaces go fully white: a translucent veil over a warm ground
    # turned every panel the same beige as the page.
    s = s.replace("rgba(255,255,255,0.92)", "#FFFFFF")
    # Secondary ink needs more weight on paper than it did on a dark ground.
    for dark_a, light_a in [("0.4)", "0.52)"), ("0.42)", "0.54)"), ("0.45)", "0.56)"),
                            ("0.5)", "0.6)"), ("0.55)", "0.63)"), ("0.6)", "0.66)")]:
        s = s.replace("rgba(23,26,33," + dark_a, "rgba(23,26,33," + light_a)
    if dst == "HomeLight.dc.html":
        s = fix_home_sky(s)
    open(dst, "w", encoding="utf-8").write(s)
    print("wrote", dst)

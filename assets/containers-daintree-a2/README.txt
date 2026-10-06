CONTAINERS FOR DAINTREE — A2 ICON PACK
Refined modular C / 6 October 2026

START HERE
  svg/containers-toolbar.svg              Default inline toolbar icon (24 px).
  svg/containers-toolbar-16.svg           Optical 16 px toolbar variant.
  svg/containers-toolbar-20.svg           Optical 20 px toolbar variant.
  svg/containers-toolbar-24.svg           Optical 24 px toolbar variant.
  svg/containers-mark.svg                 Forest-teal brand master.
  svg/containers-mark-currentcolor.svg    Scalable brand master with currentColor.
  svg/containers-mark-black.svg           Solid black master.
  svg/containers-mark-white.svg           Solid white master.
  svg/containers-wordmark.svg             Outlined horizontal wordmark.
  svg/containers-wordmark-white.svg       Wordmark for dark backgrounds.
  preview/containers-toolbar-proof.html   Self-contained proof at actual CSS sizes.

DESIGN
The selected A2's broad, slightly wide silhouette is preserved. The master has
a 24 x 24 viewBox with visible bounds x2–22 and y3–21 (20 x 18 units).
The top and bottom modules are 5 units thick. Only the outer top-left and
bottom-left shoulders use the full 5-unit curve. The centre is 5 units wide:
exactly one-quarter of the full visible width. Both master gaps are 1.5 units.
Subtle 0.35-unit softening is used on the right terminals and centre corners.

The earlier 12 x 14 px construction was a starting suggestion. The final master
uses wider proportions to retain the A2 silhouette chosen in the visual study.

TOOLBAR VARIANTS
The 16, 20 and 24 px variants preserve the same visual construction with small
optical adjustments to width, bar heights and gaps. Their straight edges sit on
integer pixel boundaries and their right terminals are square. At 1x, the 16
and 20 px files have one completely transparent row in each gap; the 24 px
file has two. The 16 px centre is snapped to 3 px for crispness; the brand
master and other optical variants keep a quarter-width centre.

Use the corresponding SVG at its intended CSS size. For high-DPI displays,
keep the same CSS size; SVG rendering handles the device scale. The matching
@2x PNGs have twice the physical width and height and should be displayed at
the size in their base filename.

COLOUR
  Forest teal: #096B5A
  Black:       #000000
  White:       #FFFFFF
Preview foreground ink is #172126; it is context, not a required brand colour.

IMPLEMENTATION
Inline SVGs with fill="currentColor" inherit the surrounding CSS text colour.
For example, place the SVG markup inside the toolbar button and apply the
normal foreground colour to that button. Give the button its accessible name
and tooltip, "Containers for Daintree"; when appropriate, mark its child SVG
aria-hidden="true" to avoid repeating the same accessible label.

An SVG loaded through an HTML img element does not inherit the surrounding
page's currentColor. For that case, use the fixed black, white or teal assets,
or apply the SVG as a CSS mask. Use the host's existing custom-icon hook;
this pack does not assume or change the Daintree plugin manifest API.

The icon SVGs contain paths/rectangles only: no raster images, filters,
external dependencies, backgrounds, or embedded fonts. The wordmark text is
outlined from Rubik Bold and Rubik Regular so the supplied wordmarks require
no font installation. The pack does not distribute font files.

PNGS
  png/mark/      Teal, black and white at 32/64/128/256/512/1024 px.
  png/toolbar/   Optical 16/20/24 px icons in teal, black and white, at 1x/2x.
  png/wordmark/  Horizontal wordmarks with transparent backgrounds.

PREVIEWS
The PNG preview uses actual exported geometry at enlarged display sizes.
The HTML proof displays the optical toolbar icons at native CSS sizes.
It has no scripts, network requests, external fonts or external images.
Its neighbouring terminal/search symbols are illustrative size context.

This pack has been checked for valid SVG structure, transparent PNGs, the
three-component construction and open gaps at the target raster sizes. The
preview is an asset proof; the files have not been installed into your app.

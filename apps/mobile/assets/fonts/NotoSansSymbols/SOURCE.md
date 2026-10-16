# Noto Sans Symbols / Symbols 2 (terminal subsets)

- Sources (hinted TTF, via jsDelivr from `notofonts/notofonts.github.io`):
  - `fonts/NotoSansSymbols2/hinted/ttf/NotoSansSymbols2-Regular.ttf` v2.008, SHA-256 `c4a0a80f0041ce4be81e2478faad22776d23edb98ae3f0d19bd37044820ecf9d`
  - `fonts/NotoSansSymbols/hinted/ttf/NotoSansSymbols-Regular.ttf`, SHA-256 `d0e98e9a2c046594c5021437273943be7e79e0fd980fde125279e22302212595`
- License: SIL Open Font License 1.1, see `OFL.txt`. Subsetted (allowed by OFL; Noto declares no Reserved Font Name):
  - `python3 -m fontTools.subset NotoSansSymbols2-Regular.ttf --unicodes="U+2300-23FF,U+25A0-25FF,U+2800-28FF,U+2B00-2BFF"`
  - `python3 -m fontTools.subset NotoSansSymbols-Regular.ttf --unicodes="U+2190-21FF,U+2300-23FF"`
- Android only: glyph fallback for the Termux terminal after DejaVu Sans Mono (2026-10-15) — Claude Code's `⏺ ⏵ ⏸ ⎿`
  and the braille spinners are missing from DejaVu and from the phone's system fonts (they showed as boxes).

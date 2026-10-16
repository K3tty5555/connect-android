/**
 * Terminal symbols that Unicode lets render either way — ⏺ ⚠ ▶ ✔ — default to
 * text, but the terminal fonts do not carry them, so iOS falls back to Apple
 * Color Emoji and Claude Code's tool bullet turns into a blue button. Appending
 * the text presentation selector keeps them monochrome in the run's colour.
 *
 * Only characters that are text by default are touched: real emoji (✅ 🎉) stay
 * emoji, and an explicit selector from the program wins. The selector has no
 * width, so this is applied at display time, after column-based wrapping.
 */
const TEXT_DEFAULT_PICTOGRAPH = /(?=\p{Extended_Pictographic})\P{Emoji_Presentation}(?![\uFE0E\uFE0F])/gu;

export function forceTextPresentation(text: string): string {
  return text.replace(TEXT_DEFAULT_PICTOGRAPH, '$&\uFE0E');
}

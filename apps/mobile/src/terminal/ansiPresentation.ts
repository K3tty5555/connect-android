const ESC = '\x1b';
const C1_CSI = '\x9b';
const MAX_INCOMPLETE_CSI_CHARS = 128;
// Codex rust-v0.147.0 (be6e8eac, Apache-2.0) derives its user-message
// surface from the OSC 11 background reported at startup. Older Connect
// builds produced the first dark tuple; current dark/light themes produce
// the other two. Map only these known surfaces to ANSI black so xterm can
// recolor existing history when Connect changes theme.
const CODEX_INPUT_BACKGROUNDS = new Set([
  '55;56;62',
  '55;57;63',
  '244;244;244',
]);

function isCodexInputBackground(values: readonly string[]): boolean {
  if (values.length < 3) return false;
  if (CODEX_INPUT_BACKGROUNDS.has(values.slice(-3).join(';'))) return true;
  const rgb = values.slice(-3).map((value) => Number(value));
  return rgb.every((value) => Number.isInteger(value) && value >= 235)
    && Math.max(...rgb) - Math.min(...rgb) <= 3;
}

function rewriteSgrParameters(body: string): string {
  if (!/^[\d:;]*$/u.test(body)) return body;
  const parameters = body.length === 0 ? ['0'] : body.split(';');
  const rewritten: string[] = [];

  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index] ?? '';
    const numeric = Number.parseInt(parameter.split(':', 1)[0] ?? '', 10);
    if (numeric === 48) {
      if (parameter.includes(':')) {
        const color = parameter.split(':');
        rewritten.push(
          color[1] === '2' && isCodexInputBackground(color.slice(2)) ? '40' : parameter,
        );
        continue;
      }
      const colorMode = parameters[index + 1];
      if (colorMode === '2') {
        const color = parameters.slice(index + 2, index + 5);
        if (isCodexInputBackground(color)) rewritten.push('40');
        else rewritten.push(...parameters.slice(index, index + 5));
        index += 4;
        continue;
      }
      if (colorMode === '5') {
        rewritten.push(...parameters.slice(index, index + 3));
        index += 2;
        continue;
      }
    }
    rewritten.push(parameter);
  }

  return rewritten.join(';');
}

function updateCodexSurfaceState(body: string, active: boolean): boolean {
  if (!/^[\d:;]*$/u.test(body)) return active;
  const parameters = body.length === 0 ? ['0'] : body.split(';');
  let next = active;

  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index] ?? '';
    const numeric = Number.parseInt(parameter.split(':', 1)[0] ?? '', 10);
    if (numeric === 0 || numeric === 49) {
      next = false;
      continue;
    }
    if ((numeric >= 40 && numeric <= 47) || (numeric >= 100 && numeric <= 107)) {
      next = false;
      continue;
    }
    if (numeric !== 38 && numeric !== 48) continue;

    if (parameter.includes(':')) {
      const color = parameter.split(':');
      if (numeric === 48) {
        next = color[1] === '2' && isCodexInputBackground(color.slice(2));
      }
      continue;
    }

    const colorMode = parameters[index + 1];
    if (colorMode === '2') {
      if (numeric === 48) {
        next = isCodexInputBackground(parameters.slice(index + 2, index + 5));
      }
      index += 4;
    } else if (colorMode === '5') {
      if (numeric === 48) next = false;
      index += 2;
    } else if (numeric === 48) {
      next = false;
    }
  }

  return next;
}

/** Rewrites only Codex's known user-message surfaces; all other ANSI state passes through. */
export class MobileAnsiPresentation {
  private carry = '';
  private codexInputSurfaceActive = false;

  reset(): void {
    this.carry = '';
    this.codexInputSurfaceActive = false;
  }

  write(chunk: string, rewriteCodexSurface: boolean): string {
    const source = this.carry + chunk;
    this.carry = '';
    if (!rewriteCodexSurface) return source;

    let rendered = '';
    for (let index = 0; index < source.length;) {
      const csiLength = source[index] === C1_CSI
        ? 1
        : source[index] === ESC && source[index + 1] === '['
          ? 2
          : 0;
      if (csiLength === 0) {
        if (source[index] === ESC && index === source.length - 1) {
          this.carry = source.slice(index);
          break;
        }
        rendered += source[index];
        index += 1;
        continue;
      }

      let finalIndex = index + csiLength;
      while (finalIndex < source.length) {
        const code = source.charCodeAt(finalIndex);
        if (code >= 0x40 && code <= 0x7e) break;
        finalIndex += 1;
      }
      if (finalIndex === source.length) {
        const incomplete = source.slice(index);
        if (incomplete.length <= MAX_INCOMPLETE_CSI_CHARS) this.carry = incomplete;
        else rendered += incomplete;
        break;
      }

      const sequence = source.slice(index, finalIndex + 1);
      const final = source[finalIndex];
      if (final !== 'm') {
        if (
          this.codexInputSurfaceActive
          && (final === 'J' || final === 'K' || final === 'X')
        ) {
          rendered += `${ESC}[49m${sequence}${ESC}[40m`;
        } else {
          rendered += sequence;
        }
      } else {
        const body = source.slice(index + csiLength, finalIndex);
        this.codexInputSurfaceActive = updateCodexSurfaceState(
          body,
          this.codexInputSurfaceActive,
        );
        const rewritten = rewriteSgrParameters(body);
        rendered += `${source.slice(index, index + csiLength)}${rewritten}m`;
      }
      index = finalIndex + 1;
    }
    return rendered;
  }
}

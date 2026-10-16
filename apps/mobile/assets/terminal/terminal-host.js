(() => {
  'use strict';

  const bridge = globalThis.ReactNativeWebView;
  const host = document.getElementById('terminal');
  const watchHost = document.getElementById('terminal-watch');
  const canvasScroll = document.getElementById('terminal-canvas-scroll');
  const canvasSpacer = document.getElementById('terminal-canvas-spacer');
  const canvas = document.getElementById('terminal-canvas');
  const canvasContext = canvas?.getContext('2d', { alpha: false });
  if (!bridge || !host || !watchHost || !canvasScroll || !canvasSpacer || !canvas || !canvasContext) return;

  const send = (message) => bridge.postMessage(JSON.stringify(message));
  const sendRenderStage = (operationId, stage) => {
    if (operationId !== undefined) send({ kind: 'renderStage', operationId, stage });
  };
  const Terminal = globalThis.Terminal;
  const FitAddon = globalThis.FitAddon?.FitAddon;
  if (typeof Terminal !== 'function' || typeof FitAddon !== 'function') {
    send({ kind: 'error', code: 'terminal_modules_unavailable' });
    return;
  }
  const SCROLLBACK_ROWS = 10000;
  const MAX_WRITE_QUEUE_CHARS = 2 * 1024 * 1024;
  const WRITE_BATCH_CHARS = 8 * 1024;
  const WRITE_SLICE_BUDGET_MS = 6;
  const INTERACTIVE_WRITE_CHARS = 2 * 1024;
  const WATCH_MAX_ROWS = 2_000;
  const WATCH_MIN_MUTABLE_ROWS = 48;
  const WATCH_MUTABLE_ROW_MARGIN = 8;
  const CANVAS_FONT_SIZE_PX = 12;
  const CANVAS_LINE_HEIGHT_PX = 17;
  const CANVAS_HORIZONTAL_PADDING_PX = 10;
  const CANVAS_OVERSCAN_ROWS = 2;
  const MIN_LOGICAL_TAIL_COLUMNS = 24;
  const DEFAULT_MINIMUM_CONTRAST_RATIO = 1;
  const MINIMUM_CONTRAST_RATIO = 4.5;
  const ANSI_THEME_KEYS = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
    'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
  ];
  const DEFAULT_WATCH_THEME = {
    background: '#1c1f25',
    foreground: '#e6e8ec',
    black: '#22262e',
    brightBlack: '#6e7683',
    red: '#e0685c',
    brightRed: '#e0685c',
    green: '#5cb874',
    brightGreen: '#5cb874',
    yellow: '#d6a23e',
    brightYellow: '#d6a23e',
    blue: '#7fa7d9',
    brightBlue: '#7fa7d9',
    magenta: '#c08fd9',
    brightMagenta: '#c08fd9',
    cyan: '#3ba79e',
    brightCyan: '#3ba79e',
    white: '#a2a9b4',
    brightWhite: '#e6e8ec',
  };
  let terminal;
  let fit;
  try {
    terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.4,
      minimumContrastRatio: DEFAULT_MINIMUM_CONTRAST_RATIO,
      screenReaderMode: false,
      scrollback: SCROLLBACK_ROWS,
      theme: {
        background: '#1c1f25',
        foreground: '#e6e8ec',
        cursor: '#e6e8ec',
      },
    });
    fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
  } catch {
    send({ kind: 'error', code: 'terminal_init_failed' });
    return;
  }

  let frame = 0;
  let lastCols = 0;
  let lastRows = 0;
  let watchMode = true;
  let watchRenderer = 'canvas';
  const fitTerminal = () => {
    frame = 0;
    try {
      const proposed = fit.proposeDimensions();
      if (!proposed) return;
      if (!watchMode) fit.fit();
      if (proposed.cols !== lastCols || proposed.rows !== lastRows) {
        lastCols = proposed.cols;
        lastRows = proposed.rows;
        send({ kind: 'resize', cols: lastCols, rows: lastRows });
      }
    } catch {
      send({ kind: 'error', code: 'terminal_fit_failed' });
    }
  };
  const scheduleFit = () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fitTerminal);
  };

  new ResizeObserver(scheduleFit).observe(host);
  terminal.onResize(({ cols, rows }) => {
    if (watchMode) return;
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols;
    lastRows = rows;
    send({ kind: 'resize', cols, rows });
  });
  // This WebView is a read-only mirror. Text and IME input are owned by the
  // native composer, which also keeps terminal geometry authoritative.

  // xterm 6's DOM viewport handles wheel input but does not translate a WebView
  // touch drag into terminal scrollback. Keep the gesture local to the terminal
  // and scroll rows directly, including a short decelerating tail for iOS feel.
  const TOUCH_LINE_PX = 17;
  const TOUCH_DRAG_THRESHOLD_PX = 4;
  let touchIdentifier = null;
  let touchLastY = 0;
  let touchLastAt = 0;
  let touchRemainder = 0;
  let touchVelocity = 0;
  let momentumFrame = 0;

  const stopMomentum = () => {
    if (momentumFrame !== 0) cancelAnimationFrame(momentumFrame);
    momentumFrame = 0;
  };
  const scrollPixels = (pixels) => {
    touchRemainder += pixels;
    const lines = touchRemainder > 0
      ? Math.floor(touchRemainder / TOUCH_LINE_PX)
      : Math.ceil(touchRemainder / TOUCH_LINE_PX);
    if (lines === 0) return;
    terminal.scrollLines(lines);
    touchRemainder -= lines * TOUCH_LINE_PX;
  };
  const findTouch = (touches, identifier) => {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch && touch.identifier === identifier) return touch;
    }
    return null;
  };
  host.addEventListener('touchstart', (event) => {
    if (watchMode) return;
    if (event.touches.length !== 1) {
      touchIdentifier = null;
      return;
    }
    stopMomentum();
    const touch = event.touches.item(0);
    if (!touch) return;
    touchIdentifier = touch.identifier;
    touchLastY = touch.clientY;
    touchLastAt = performance.now();
    touchRemainder = 0;
    touchVelocity = 0;
  }, { passive: true });
  host.addEventListener('touchmove', (event) => {
    if (watchMode) return;
    if (touchIdentifier === null) return;
    const touch = findTouch(event.changedTouches, touchIdentifier);
    if (!touch) return;
    const now = performance.now();
    const delta = touchLastY - touch.clientY;
    const elapsed = Math.max(1, now - touchLastAt);
    touchLastY = touch.clientY;
    touchLastAt = now;
    touchVelocity = delta / elapsed;
    if (Math.abs(delta) < TOUCH_DRAG_THRESHOLD_PX && touchRemainder === 0) return;
    event.preventDefault();
    scrollPixels(delta);
  }, { passive: false });
  const finishTouch = () => {
    if (touchIdentifier === null) return;
    touchIdentifier = null;
    let velocity = touchVelocity * 16;
    const coast = () => {
      if (Math.abs(velocity) < 0.35) {
        momentumFrame = 0;
        return;
      }
      scrollPixels(velocity);
      velocity *= 0.92;
      momentumFrame = requestAnimationFrame(coast);
    };
    if (Math.abs(velocity) >= 0.35) momentumFrame = requestAnimationFrame(coast);
  };
  host.addEventListener('touchend', finishTouch, { passive: true });
  host.addEventListener('touchcancel', () => {
    touchIdentifier = null;
    touchVelocity = 0;
  }, { passive: true });

  let writeQueue = [];
  let queuedChars = 0;
  let writing = false;
  let drainFrame = 0;
  let drainSliceStartedAt = 0;
  let pendingReplacement = null;
  let pendingEmptyReplacementBatchId = null;
  let pendingEmptyReplacementOperationId = null;
  let scrollAfterDrain = false;
  let restoreViewportDistance = null;
  let followLatest = true;
  let reportedAtLatest = null;
  let trimmedLines = 0;
  let trimReportTimer = 0;
  let scrollbackFull = false;
  let recoveryPending = false;
  let watchRenderFrame = 0;
  let watchOmittedRows = 0;
  let watchTheme = { ...DEFAULT_WATCH_THEME };
  let watchRows = [];
  let watchRenderedStart = 0;
  let watchRenderedEnd = 0;
  let watchBufferType = null;
  let watchFullRender = true;
  let watchPendingBufferShifts = 0;
  let canvasVisualRows = [];
  const pendingWatchPaints = [];
  const pendingWatchDrains = [];

  const reportScrollState = (atLatest) => {
    followLatest = atLatest;
    if (reportedAtLatest === atLatest) return;
    reportedAtLatest = atLatest;
    send({ kind: 'scrollState', atLatest });
  };
  const terminalAtLatest = () => (
    terminal.buffer.active.viewportY >= terminal.buffer.active.baseY
  );
  terminal.onScroll(() => {
    if (!watchMode) reportScrollState(terminalAtLatest());
  });
  watchHost.addEventListener('scroll', () => {
    // Only the visible watch renderer owns scroll state. The hidden DOM host can
    // still emit a delayed scroll event after switching to canvas and must not
    // flip the native "latest" button back on.
    if (!watchMode || watchRenderer === 'canvas') return;
    reportScrollState(
      watchHost.scrollHeight - watchHost.scrollTop - watchHost.clientHeight < 40,
    );
  }, { passive: true });
  canvasScroll.addEventListener('scroll', () => {
    if (!watchMode || watchRenderer !== 'canvas') return;
    reportScrollState(
      canvasScroll.scrollHeight - canvasScroll.scrollTop - canvasScroll.clientHeight < 40,
    );
    scheduleWatchRender();
  }, { passive: true });

  const reportTrimmed = (lines) => {
    trimmedLines += Math.max(1, lines);
    if (trimReportTimer !== 0) return;
    trimReportTimer = setTimeout(() => {
      trimReportTimer = 0;
      send({ kind: 'outputTrimmed', lines: trimmedLines });
    }, 250);
  };
  const safeSplitIndex = (value, requested) => {
    if (requested <= 0) return 0;
    if (requested >= value.length) return value.length;
    const code = value.charCodeAt(requested);
    return code >= 0xdc00 && code <= 0xdfff ? requested + 1 : requested;
  };
  const trimWriteQueue = () => {
    if (queuedChars <= MAX_WRITE_QUEUE_CHARS || recoveryPending) return;
    writeQueue = [];
    queuedChars = 0;
    recoveryPending = true;
    send({ kind: 'recoveryNeeded' });
  };
  const applyPendingReplacement = () => {
    if (pendingReplacement === null || writing) return;
    const replacement = pendingReplacement;
    pendingReplacement = null;
    const emptyReplacementBatchId = pendingEmptyReplacementBatchId;
    pendingEmptyReplacementBatchId = null;
    const emptyReplacementOperationId = pendingEmptyReplacementOperationId;
    pendingEmptyReplacementOperationId = null;
    writeQueue = [];
    queuedChars = 0;
    const followAfterReplacement = followLatest;
    restoreViewportDistance = followAfterReplacement
      ? null
      : Math.max(0, terminal.buffer.active.baseY - terminal.buffer.active.viewportY);
    terminal.reset();
    canvasVisualRows = [];
    watchFullRender = true;
    watchPendingBufferShifts = 0;
    reportScrollState(followAfterReplacement);
    scrollbackFull = false;
    recoveryPending = false;
    watchOmittedRows = 0;
    scrollAfterDrain = followAfterReplacement;
    for (const segment of replacement) enqueueWrite(segment);
    if (writeQueue.length === 0) {
      scrollAfterDrain = false;
      if (followAfterReplacement) terminal.scrollToBottom();
      else if (restoreViewportDistance !== null) {
        terminal.scrollToLine(Math.max(0, terminal.buffer.active.baseY - restoreViewportDistance));
        restoreViewportDistance = null;
      }
      if (emptyReplacementBatchId !== null) {
        if (watchMode) pendingWatchDrains.push(emptyReplacementBatchId);
        else send({ kind: 'drained', batchId: emptyReplacementBatchId });
      }
      if (emptyReplacementOperationId !== null) {
        sendRenderStage(emptyReplacementOperationId, 'vt_parsed');
        if (watchMode) {
          pendingWatchPaints.push(emptyReplacementOperationId);
        } else requestAnimationFrame(() => {
          sendRenderStage(emptyReplacementOperationId, 'frame_committed');
          requestAnimationFrame(() => send({
            kind: 'painted',
            operationId: emptyReplacementOperationId,
          }));
        });
      }
      if (watchMode) scheduleWatchRender();
    }
  };
  const scheduleDrain = (continueSlice = false) => {
    if (drainFrame !== 0 || writing) return;
    const interactive = !continueSlice && queuedChars <= INTERACTIVE_WRITE_CHARS;
    if (interactive || (
      continueSlice
      && performance.now() - drainSliceStartedAt < WRITE_SLICE_BUDGET_MS
    )) {
      if (interactive) drainSliceStartedAt = performance.now();
      drainFrame = -1;
      queueMicrotask(() => {
        drainFrame = 0;
        drainWriteQueue();
      });
      return;
    }
    drainFrame = requestAnimationFrame(() => {
      drainFrame = 0;
      drainSliceStartedAt = performance.now();
      drainWriteQueue();
    });
  };
  const colorFromPalette = (index) => {
    if (index < ANSI_THEME_KEYS.length) {
      return watchTheme[ANSI_THEME_KEYS[index]] ?? watchTheme.foreground;
    }
    if (index >= 16 && index <= 231) {
      const offset = index - 16;
      const levels = [0, 95, 135, 175, 215, 255];
      const red = levels[Math.floor(offset / 36)] ?? 0;
      const green = levels[Math.floor((offset % 36) / 6)] ?? 0;
      const blue = levels[offset % 6] ?? 0;
      return `rgb(${red}, ${green}, ${blue})`;
    }
    if (index >= 232 && index <= 255) {
      const level = 8 + ((index - 232) * 10);
      return `rgb(${level}, ${level}, ${level})`;
    }
    return watchTheme.foreground;
  };
  const rgbFromNumber = (value) => (
    `rgb(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff})`
  );
  const cellColor = (cell, side) => {
    const foreground = side === 'foreground';
    if (foreground ? cell.isFgRGB() : cell.isBgRGB()) {
      return rgbFromNumber(foreground ? cell.getFgColor() : cell.getBgColor());
    }
    if (foreground ? cell.isFgPalette() : cell.isBgPalette()) {
      let index = foreground ? cell.getFgColor() : cell.getBgColor();
      if (foreground && cell.isBold() && index < 8) index += 8;
      return colorFromPalette(index);
    }
    return foreground ? watchTheme.foreground : watchTheme.background;
  };
  const cssColorChannels = (value) => {
    const hex = /^#([\da-f]{6})$/iu.exec(value);
    if (hex) {
      const encoded = Number.parseInt(hex[1], 16);
      return [(encoded >> 16) & 0xff, (encoded >> 8) & 0xff, encoded & 0xff];
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/iu.exec(value);
    return rgb ? rgb.slice(1, 4).map(Number) : null;
  };
  const relativeLuminance = (value) => {
    const channels = cssColorChannels(value);
    if (channels === null) return null;
    const [red, green, blue] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  };
  const contrastRatio = (foreground, background) => {
    const foregroundLuminance = relativeLuminance(foreground);
    const backgroundLuminance = relativeLuminance(background);
    if (foregroundLuminance === null || backgroundLuminance === null) return 0;
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  };
  const ensureWatchContrast = (foreground) => (
    contrastRatio(foreground, watchTheme.background) >= MINIMUM_CONTRAST_RATIO
      ? foreground
      : watchTheme.foreground
  );
  const compositeWatchColor = (foreground, opacity) => {
    const foregroundChannels = cssColorChannels(foreground);
    const backgroundChannels = cssColorChannels(watchTheme.background);
    if (foregroundChannels === null || backgroundChannels === null) return foreground;
    return `rgb(${foregroundChannels.map((channel, index) => (
      Math.round((channel * opacity) + ((backgroundChannels[index] ?? 0) * (1 - opacity)))
    )).join(', ')})`;
  };
  const cellAppearance = (cell) => {
    const inverseForeground = cell.isInverse() && !cell.isBgDefault();
    const rawForeground = inverseForeground
      ? cellColor(cell, 'background')
      : cellColor(cell, 'foreground');
    const foreground = ensureWatchContrast(rawForeground);
    const dim = cell.isDim() && contrastRatio(
      compositeWatchColor(foreground, 0.5),
      watchTheme.background,
    ) >= MINIMUM_CONTRAST_RATIO;
    const decorations = [];
    if (cell.isUnderline()) decorations.push('underline');
    if (cell.isStrikethrough()) decorations.push('line-through');
    if (cell.isOverline()) decorations.push('overline');
    return {
      key: [
        foreground,
        cell.isBold(),
        dim,
        cell.isItalic(),
        cell.isInvisible(),
        decorations.join(' '),
      ].join('|'),
      foreground,
      bold: Boolean(cell.isBold()),
      dim: Boolean(dim),
      italic: Boolean(cell.isItalic()),
      invisible: Boolean(cell.isInvisible()),
      decorations: decorations.join(' '),
    };
  };
  const cellHasWatchContent = (cell) => (
    (cell.getChars() !== '' && cell.getChars() !== ' ')
    || cell.isUnderline()
    || cell.isStrikethrough()
    || cell.isOverline()
  );
  const lineHasWatchContent = (buffer, line) => {
    const cell = buffer.getNullCell();
    for (let column = 0; column < Math.min(terminal.cols, line.length); column += 1) {
      const current = line.getCell(column, cell);
      if (current && current.getWidth() > 0 && cellHasWatchContent(current)) return true;
    }
    return false;
  };
  const appendRun = (fragment, text, appearance) => {
    if (text.length === 0) return;
    const span = document.createElement('span');
    span.textContent = text;
    span.style.color = appearance.foreground;
    if (appearance.bold) span.style.fontWeight = '700';
    if (appearance.dim) span.style.opacity = '0.5';
    if (appearance.italic) span.style.fontStyle = 'italic';
    if (appearance.invisible) span.style.visibility = 'hidden';
    if (appearance.decorations) span.style.textDecoration = appearance.decorations;
    fragment.append(span);
  };
  const appendWatchLine = (container, buffer, line) => {
    const cell = buffer.getNullCell();
    const cells = [];
    let lastVisible = -1;
    for (let column = 0; column < Math.min(terminal.cols, line.length); column += 1) {
      const current = line.getCell(column, cell);
      if (!current || current.getWidth() === 0) continue;
      const chars = current.getChars();
      const appearance = cellAppearance(current);
      cells.push({
        text: chars || ' ',
        appearance,
        hasContent: cellHasWatchContent(current),
      });
    }
    for (let index = 0; index < cells.length; index += 1) {
      const current = cells[index];
      if (!current) continue;
      if (current.hasContent) lastVisible = index;
    }
    let run = '';
    let previous = null;
    for (let index = 0; index <= lastVisible; index += 1) {
      const current = cells[index];
      if (!current) continue;
      if (previous && previous.key !== current.appearance.key) {
        appendRun(container, run, previous);
        run = '';
      }
      previous = current.appearance;
      run += current.text;
    }
    if (previous) appendRun(container, run, previous);
  };
  const commitPendingWatchFrame = () => {
    const painted = pendingWatchPaints.splice(0);
    const drained = pendingWatchDrains.splice(0);
    for (const operationId of painted) sendRenderStage(operationId, 'frame_committed');
    for (const batchId of drained) send({ kind: 'drained', batchId });
    if (painted.length === 0) return;
    requestAnimationFrame(() => {
      for (const operationId of painted) send({ kind: 'painted', operationId });
    });
  };
  const canvasFont = (appearance) => (
    `${appearance.italic ? 'italic ' : ''}${appearance.bold ? '700 ' : '400 '}`
    + `${CANVAS_FONT_SIZE_PX}px "SF Mono", ui-monospace, Menlo, monospace`
  );
  const configureCanvas = () => {
    const width = Math.max(1, canvasScroll.clientWidth);
    const height = Math.max(1, canvasScroll.clientHeight);
    const scale = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    const pixelWidth = Math.ceil(width * scale);
    const pixelHeight = Math.ceil(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    canvasContext.setTransform(scale, 0, 0, scale, 0, 0);
    canvasContext.textBaseline = 'alphabetic';
    return { width, height };
  };
  const canvasCellWidth = () => {
    canvasContext.font = canvasFont({ bold: false, italic: false });
    return Math.max(1, canvasContext.measureText('M').width);
  };
  const drawCanvasLine = (
    buffer,
    line,
    y,
    cellWidth,
    segmentStartColumn,
    segmentEndColumn,
    outputStartColumn,
  ) => {
    const cell = buffer.getNullCell();
    const cells = [];
    let lastVisible = -1;
    for (let column = 0; column < Math.min(terminal.cols, line.length); column += 1) {
      const current = line.getCell(column, cell);
      if (!current || current.getWidth() === 0) continue;
      if (column < segmentStartColumn || column >= segmentEndColumn) continue;
      const appearance = cellAppearance(current);
      const item = {
        column,
        width: Math.max(1, current.getWidth()),
        text: current.getChars() || ' ',
        appearance,
        hasContent: cellHasWatchContent(current),
      };
      cells.push(item);
      if (item.hasContent) lastVisible = cells.length - 1;
    }
    let run = '';
    let runColumn = 0;
    let runColumns = 0;
    let previous = null;
    const flushRun = () => {
      if (previous === null || run.length === 0) return;
      const x = CANVAS_HORIZONTAL_PADDING_PX
        + ((outputStartColumn + runColumn - segmentStartColumn) * cellWidth);
      canvasContext.font = canvasFont(previous);
      canvasContext.globalAlpha = previous.dim ? 0.5 : 1;
      canvasContext.fillStyle = previous.foreground;
      if (!previous.invisible) canvasContext.fillText(run, x, y);
      canvasContext.globalAlpha = 1;
      if (!previous.invisible && previous.decorations) {
        canvasContext.strokeStyle = previous.foreground;
        canvasContext.lineWidth = 1;
        const width = runColumns * cellWidth;
        for (const decoration of previous.decorations.split(' ')) {
          const offset = decoration === 'overline'
            ? -CANVAS_FONT_SIZE_PX + 2
            : decoration === 'line-through'
              ? -Math.round(CANVAS_FONT_SIZE_PX * 0.4)
              : 2;
          canvasContext.beginPath();
          canvasContext.moveTo(x, y + offset + 0.5);
          canvasContext.lineTo(x + width, y + offset + 0.5);
          canvasContext.stroke();
        }
      }
      run = '';
      runColumns = 0;
    };
    for (let index = 0; index <= lastVisible; index += 1) {
      const current = cells[index];
      if (!current) continue;
      const contiguous = previous !== null && current.column === runColumn + runColumns;
      if (previous !== null && (previous.key !== current.appearance.key || !contiguous)) flushRun();
      if (run.length === 0) runColumn = current.column;
      previous = current.appearance;
      run += current.text;
      runColumns += current.width;
    }
    flushRun();
  };
  const canvasLineColumns = (buffer, line) => {
    const cell = buffer.getNullCell();
    let columns = 0;
    for (let column = 0; column < Math.min(terminal.cols, line.length); column += 1) {
      const current = line.getCell(column, cell);
      if (!current || current.getWidth() === 0 || !cellHasWatchContent(current)) continue;
      columns = column + Math.max(1, current.getWidth());
    }
    return Math.max(1, columns);
  };
  const canvasListContinuationIndent = (line, visibleColumns) => {
    const text = line.translateToString(true);
    const prefix = /^\s*(?:[-*+•●▪]|\d{1,4}[.)])\s+/u.exec(text)?.[0] ?? '';
    return Math.min(prefix.length, Math.max(0, visibleColumns - 2));
  };
  const canvasPhysicalRowColumns = (buffer, line, next) => {
    const columns = Math.min(terminal.cols, line.length);
    if (!next?.isWrapped || columns < 1) return canvasLineColumns(buffer, line);
    const last = line.getCell(columns - 1, buffer.getNullCell());
    const first = next.getCell(0, buffer.getNullCell());
    if (
      last
      && first
      && last.getWidth() === 1
      && last.getChars() === ''
      && !cellHasWatchContent(last)
      && first.getWidth() === 2
    ) return columns - 1;
    return columns;
  };
  const canvasLogicalCellChars = (buffer, logicalRow, logicalColumn) => {
    for (const part of logicalRow.parts) {
      const partEnd = part.logicalStart + part.columns;
      if (logicalColumn < part.logicalStart || logicalColumn >= partEnd) continue;
      const line = buffer.getLine(part.bufferIndex);
      const cell = line?.getCell(logicalColumn - part.logicalStart, buffer.getNullCell());
      return cell?.getChars() ?? '';
    }
    return '';
  };
  const canvasLogicalBreakAtToken = (buffer, logicalRow, startColumn, requestedEnd) => {
    const characterAt = (column) => canvasLogicalCellChars(buffer, logicalRow, column);
    const next = characterAt(requestedEnd);
    let cursor = requestedEnd - 1;
    let digits = 0;
    while (cursor >= startColumn && digits < 3 && /^[0-7]$/u.test(characterAt(cursor))) {
      digits += 1;
      cursor -= 1;
    }
    if (
      digits < 3
      && characterAt(cursor) === '\\'
      && /^[0-7]$/u.test(next)
    ) return cursor;
    return requestedEnd;
  };
  const alignCanvasLogicalBreak = (buffer, logicalRow, startColumn, requestedEnd) => {
    if (requestedEnd >= logicalRow.columns) return logicalRow.columns;
    const cell = buffer.getNullCell();
    for (const part of logicalRow.parts) {
      const partEnd = part.logicalStart + part.columns;
      if (requestedEnd <= part.logicalStart || requestedEnd >= partEnd) continue;
      const column = requestedEnd - part.logicalStart;
      const line = buffer.getLine(part.bufferIndex);
      const current = line?.getCell(column, cell);
      if (current?.getWidth() === 0 && requestedEnd - 1 > startColumn) {
        return requestedEnd - 1;
      }
      break;
    }
    const tokenBoundary = canvasLogicalBreakAtToken(
      buffer,
      logicalRow,
      startColumn,
      requestedEnd,
    );
    if (tokenBoundary > startColumn && tokenBoundary < requestedEnd) return tokenBoundary;
    const pathStart = Math.max(startColumn + 8, requestedEnd - 12);
    for (let column = requestedEnd - 1; column >= pathStart; column -= 1) {
      if (canvasLogicalCellChars(buffer, logicalRow, column) !== '/') continue;
      const pathBoundary = column + 1;
      if (pathBoundary > startColumn && pathBoundary < requestedEnd) return pathBoundary;
      break;
    }
    const identifierStart = Math.max(startColumn + 8, requestedEnd - 10);
    for (let column = requestedEnd - 1; column >= identifierStart; column -= 1) {
      if (canvasLogicalCellChars(buffer, logicalRow, column) !== '-') continue;
      const identifierBoundary = column + 1;
      if (identifierBoundary > startColumn && identifierBoundary < requestedEnd) {
        return identifierBoundary;
      }
      break;
    }
    return requestedEnd;
  };
  const buildCanvasVisualRows = (buffer, start, end, visibleColumns) => {
    const logicalRows = [];
    for (let index = start; index < end; index += 1) {
      const line = buffer.getLine(index);
      if (!line) continue;
      if (!line.isWrapped || logicalRows.length === 0) {
        logicalRows.push({
          columns: 0,
          continuationIndent: canvasListContinuationIndent(line, visibleColumns),
          parts: [],
        });
      }
      const logicalRow = logicalRows.at(-1);
      const next = buffer.getLine(index + 1);
      const columns = canvasPhysicalRowColumns(buffer, line, next);
      logicalRow.parts.push({
        bufferIndex: index,
        columns,
        logicalStart: logicalRow.columns,
      });
      logicalRow.columns += columns;
    }

    const visualRows = [];
    for (const logicalRow of logicalRows) {
      let logicalColumn = 0;
      let visualIndex = 0;
      do {
        const indentColumns = visualIndex === 0 ? 0 : logicalRow.continuationIndent;
        const capacity = Math.max(2, visibleColumns - indentColumns);
        const remaining = logicalRow.columns - logicalColumn;
        const availableAfterCapacity = remaining - capacity;
        const tailAdjustment = availableAfterCapacity > 0
          && availableAfterCapacity < MIN_LOGICAL_TAIL_COLUMNS
          ? MIN_LOGICAL_TAIL_COLUMNS - availableAfterCapacity
          : 0;
        const requestedEnd = Math.min(
          logicalRow.columns,
          logicalColumn + Math.max(1, capacity - tailAdjustment),
        );
        const logicalEnd = alignCanvasLogicalBreak(
          buffer,
          logicalRow,
          logicalColumn,
          requestedEnd,
        );
        const pieces = [];
        for (const part of logicalRow.parts) {
          const partEnd = part.logicalStart + part.columns;
          const overlapStart = Math.max(logicalColumn, part.logicalStart);
          const overlapEnd = Math.min(logicalEnd, partEnd);
          if (overlapEnd <= overlapStart) continue;
          pieces.push({
            bufferIndex: part.bufferIndex,
            startColumn: overlapStart - part.logicalStart,
            endColumn: overlapEnd - part.logicalStart,
            outputStartColumn: indentColumns + overlapStart - logicalColumn,
          });
        }
        visualRows.push({ pieces });
        logicalColumn = logicalEnd;
        visualIndex += 1;
      } while (logicalColumn < logicalRow.columns);
    }
    return visualRows;
  };
  const renderCanvasView = () => {
    watchRenderFrame = 0;
    if (!watchMode || watchRenderer !== 'canvas') return;
    const buffer = terminal.buffer.active;
    const start = Math.max(0, buffer.length - WATCH_MAX_ROWS);
    let targetEnd = buffer.length;
    while (targetEnd > start) {
      const line = buffer.getLine(targetEnd - 1);
      if (line && (line.translateToString(true) || lineHasWatchContent(buffer, line))) break;
      targetEnd -= 1;
    }
    targetEnd = Math.min(buffer.length, Math.max(start + 1, targetEnd));
    if (start > watchOmittedRows) reportTrimmed(start - watchOmittedRows);
    watchOmittedRows = start;
    const pinned = followLatest;
    const previousScrollTop = canvasScroll.scrollTop;
    const shiftedBufferRows = watchPendingBufferShifts;
    watchPendingBufferShifts = 0;
    const previousAnchorIndex = Math.max(
      0,
      Math.floor(previousScrollTop / CANVAS_LINE_HEIGHT_PX),
    );
    const previousAnchorRow = canvasVisualRows[previousAnchorIndex];
    const previousAnchorPiece = previousAnchorRow?.pieces[0];
    const anchor = previousAnchorPiece === undefined ? null : {
      bufferIndex: previousAnchorPiece.bufferIndex - shiftedBufferRows,
      column: previousAnchorPiece.startColumn,
      offset: previousScrollTop - (previousAnchorIndex * CANVAS_LINE_HEIGHT_PX),
    };
    const { width, height } = configureCanvas();
    const cellWidth = canvasCellWidth();
    const visibleColumns = Math.max(
      2,
      Math.floor((width - (CANVAS_HORIZONTAL_PADDING_PX * 2)) / cellWidth),
    );
    const visualRows = buildCanvasVisualRows(buffer, start, targetEnd, visibleColumns);
    if (visualRows.length === 0) {
      visualRows.push({
        pieces: [{
          bufferIndex: start,
          startColumn: 0,
          endColumn: visibleColumns,
          outputStartColumn: 0,
        }],
      });
    }
    canvasVisualRows = visualRows;
    canvasSpacer.style.height = `${Math.max(
      height,
      visualRows.length * CANVAS_LINE_HEIGHT_PX,
    )}px`;
    if (pinned) canvasScroll.scrollTop = canvasScroll.scrollHeight;
    else if (anchor !== null && anchor.bufferIndex >= start) {
      const anchorIndex = visualRows.findIndex((row) => row.pieces.some((piece) => (
        piece.bufferIndex === anchor.bufferIndex
        && piece.startColumn <= anchor.column
        && piece.endColumn > anchor.column
      )));
      canvasScroll.scrollTop = anchorIndex < 0
        ? previousScrollTop
        : (anchorIndex * CANVAS_LINE_HEIGHT_PX) + anchor.offset;
    } else canvasScroll.scrollTop = previousScrollTop;
    canvasContext.globalAlpha = 1;
    canvasContext.fillStyle = watchTheme.background;
    canvasContext.fillRect(0, 0, width, height);
    const visibleStart = Math.max(
      0,
      Math.floor(canvasScroll.scrollTop / CANVAS_LINE_HEIGHT_PX) - CANVAS_OVERSCAN_ROWS,
    );
    const visibleEnd = Math.min(
      visualRows.length,
      visibleStart + Math.ceil(height / CANVAS_LINE_HEIGHT_PX) + (CANVAS_OVERSCAN_ROWS * 2),
    );
    for (let index = visibleStart; index < visibleEnd; index += 1) {
      const visualRow = visualRows[index];
      if (!visualRow) continue;
      const y = (index * CANVAS_LINE_HEIGHT_PX)
        - canvasScroll.scrollTop
        + CANVAS_FONT_SIZE_PX
        + CANVAS_OVERSCAN_ROWS;
      for (const piece of visualRow.pieces) {
        const line = buffer.getLine(piece.bufferIndex);
        if (!line) continue;
        drawCanvasLine(
          buffer,
          line,
          y,
          cellWidth,
          piece.startColumn,
          piece.endColumn,
          piece.outputStartColumn,
        );
      }
    }
    reportScrollState(
      canvasScroll.scrollHeight - canvasScroll.scrollTop - canvasScroll.clientHeight < 40,
    );
    commitPendingWatchFrame();
  };
  const removeWatchRow = (row) => {
    row.node.remove();
    row.separator?.remove();
  };
  const clearWatchRows = () => {
    watchHost.replaceChildren();
    watchRows = [];
  };
  const appendWatchRow = (fragment, buffer, line, next) => {
    const node = document.createElement('span');
    node.className = 'terminal-watch-row';
    appendWatchLine(node, buffer, line);
    const separator = next && !next.isWrapped ? document.createTextNode('\n') : null;
    fragment.append(node);
    if (separator) fragment.append(separator);
    watchRows.push({ node, separator });
  };
  const renderDomWatchView = () => {
    watchRenderFrame = 0;
    if (!watchMode) return;
    const buffer = terminal.buffer.active;
    const start = Math.max(0, buffer.length - WATCH_MAX_ROWS);
    const end = buffer.length;
    if (start > watchOmittedRows) reportTrimmed(start - watchOmittedRows);
    watchOmittedRows = start;
    let targetEnd = end;
    while (targetEnd > start) {
      const line = buffer.getLine(targetEnd - 1);
      if (line && (line.translateToString(true) || lineHasWatchContent(buffer, line))) break;
      targetEnd -= 1;
    }
    targetEnd = Math.min(end, Math.max(start + 1, targetEnd));
    const pinned = followLatest;
    const previousScrollTop = watchHost.scrollTop;
    const anchorRow = pinned ? undefined : watchRows.find(({ node }) => (
      node.offsetTop + node.offsetHeight > previousScrollTop
    ));
    const anchorOffset = anchorRow === undefined
      ? 0
      : anchorRow.node.offsetTop - previousScrollTop;
    const bufferChanged = watchBufferType !== buffer.type;
    if (
      watchFullRender
      || bufferChanged
      || targetEnd < watchRenderedStart
      || start < watchRenderedStart
      || watchRenderedEnd < watchRenderedStart
    ) {
      clearWatchRows();
      watchRenderedStart = start;
      watchRenderedEnd = start;
      watchFullRender = false;
      watchPendingBufferShifts = 0;
    } else if (watchPendingBufferShifts > 0) {
      const remove = Math.min(watchPendingBufferShifts, watchRows.length);
      for (let index = 0; index < remove; index += 1) {
        const row = watchRows.shift();
        if (row) removeWatchRow(row);
      }
      watchRenderedStart = start;
      watchRenderedEnd = start + watchRows.length;
      watchPendingBufferShifts = 0;
    }
    watchBufferType = buffer.type;
    if (start > watchRenderedStart) {
      const remove = Math.min(start - watchRenderedStart, watchRows.length);
      for (let index = 0; index < remove; index += 1) {
        const row = watchRows.shift();
        if (row) removeWatchRow(row);
      }
      watchRenderedStart = start;
      watchRenderedEnd = watchRenderedStart + watchRows.length;
    }
    const mutableRows = Math.min(
      WATCH_MAX_ROWS,
      Math.max(WATCH_MIN_MUTABLE_ROWS, terminal.rows + WATCH_MUTABLE_ROW_MARGIN),
    );
    const tailStart = Math.max(start, targetEnd - mutableRows - 1);
    const retainedRows = Math.max(0, Math.min(watchRows.length, tailStart - watchRenderedStart));
    while (watchRows.length > retainedRows) {
      const row = watchRows.pop();
      if (row) removeWatchRow(row);
    }
    watchRenderedEnd = watchRenderedStart + watchRows.length;
    const fragment = document.createDocumentFragment();
    for (let index = watchRenderedEnd; index < targetEnd; index += 1) {
      const line = buffer.getLine(index);
      if (!line) continue;
      appendWatchRow(fragment, buffer, line, buffer.getLine(index + 1));
    }
    watchHost.append(fragment);
    watchRenderedEnd = watchRenderedStart + watchRows.length;
    if (pinned) watchHost.scrollTop = watchHost.scrollHeight;
    else if (anchorRow?.node.isConnected) {
      watchHost.scrollTop = anchorRow.node.offsetTop - anchorOffset;
    } else watchHost.scrollTop = previousScrollTop;
    reportScrollState(pinned);
    commitPendingWatchFrame();
  };
  const scheduleWatchRender = () => {
    if (!watchMode || watchRenderFrame !== 0) return;
    watchRenderFrame = requestAnimationFrame(
      watchRenderer === 'canvas' ? renderCanvasView : renderDomWatchView,
    );
  };
  new ResizeObserver(scheduleWatchRender).observe(canvasScroll);
  const validGeometry = (geometry) => (
    geometry
    && typeof geometry === 'object'
    && Number.isInteger(geometry.cols)
    && geometry.cols >= 2
    && geometry.cols <= 500
    && Number.isInteger(geometry.rows)
    && geometry.rows >= 1
    && geometry.rows <= 200
  );
  const applyGeometry = (geometry) => {
    if (!watchMode || !validGeometry(geometry)) return;
    if (terminal.cols !== geometry.cols || terminal.rows !== geometry.rows) {
      terminal.resize(geometry.cols, geometry.rows);
      watchFullRender = true;
      canvasVisualRows = [];
    }
  };
  const drainWriteQueue = () => {
    if (writing || writeQueue.length === 0) return;
    const first = writeQueue[0];
    const take = safeSplitIndex(first.data, Math.min(first.data.length, WRITE_BATCH_CHARS));
    if (take === 0) return;
    const data = first.data.slice(0, take);
    const geometry = first.geometry;
    const completed = take === first.data.length;
    const renderOperationId = completed ? first.renderOperationId : undefined;
    const batchId = completed ? first.batchId : undefined;
    queuedChars -= take;
    if (completed) writeQueue.shift();
    else first.data = first.data.slice(take);
    applyGeometry(geometry);
    writing = true;
    terminal.write(data, () => {
      writing = false;
      if (renderOperationId !== undefined) {
        sendRenderStage(renderOperationId, 'vt_parsed');
        if (watchMode) pendingWatchPaints.push(renderOperationId);
        else requestAnimationFrame(() => {
          sendRenderStage(renderOperationId, 'frame_committed');
          requestAnimationFrame(() => send({ kind: 'painted', operationId: renderOperationId }));
        });
      }
      if (batchId !== undefined) {
        if (watchMode) pendingWatchDrains.push(batchId);
        else send({ kind: 'drained', batchId });
      }
      const commitInteractiveCanvas = renderOperationId !== undefined
        && watchMode
        && watchRenderer === 'canvas'
        && data.length <= INTERACTIVE_WRITE_CHARS
        && queuedChars === 0;
      if (commitInteractiveCanvas) {
        if (watchRenderFrame !== 0) cancelAnimationFrame(watchRenderFrame);
        watchRenderFrame = 0;
        renderCanvasView();
      } else {
        scheduleWatchRender();
      }
      if (pendingReplacement !== null) {
        applyPendingReplacement();
        return;
      }
      if (!writing && writeQueue.length === 0 && scrollAfterDrain) {
        scrollAfterDrain = false;
        terminal.scrollToBottom();
      } else if (!writing && writeQueue.length === 0 && restoreViewportDistance !== null) {
        terminal.scrollToLine(Math.max(0, terminal.buffer.active.baseY - restoreViewportDistance));
        restoreViewportDistance = null;
      }
      if (writeQueue.length > 0) scheduleDrain(true);
    });
  };
  const enqueueWrite = (segment) => {
    if (!segment || typeof segment.data !== 'string' || segment.data.length === 0) return;
    if (recoveryPending && pendingReplacement === null) return;
    const geometry = validGeometry(segment.geometry) ? {
      cols: segment.geometry.cols,
      rows: segment.geometry.rows,
    } : undefined;
    if (pendingReplacement !== null) {
      pendingReplacement.push({ data: segment.data, geometry });
      return;
    }
    const last = writeQueue[writeQueue.length - 1];
    if (
      last
      && last.geometry?.cols === geometry?.cols
      && last.geometry?.rows === geometry?.rows
      && last.renderOperationId === undefined
      && segment.renderOperationId === undefined
      && last.batchId === undefined
      && segment.batchId === undefined
    ) {
      last.data += segment.data;
      last.renderOperationId ??= segment.renderOperationId;
    }
    else writeQueue.push({
      data: segment.data,
      geometry,
      ...(segment.renderOperationId === undefined
        ? {}
        : { renderOperationId: segment.renderOperationId }),
      ...(segment.batchId === undefined ? {} : { batchId: segment.batchId }),
    });
    queuedChars += segment.data.length;
    trimWriteQueue();
    scheduleDrain();
  };

  const parseSegments = (value) => {
    if (!Array.isArray(value) || value.length > 4096) return null;
    const parsed = [];
    let chars = 0;
    for (const segment of value) {
      if (!segment || typeof segment !== 'object' || typeof segment.data !== 'string') return null;
      if (segment.geometry !== undefined && !validGeometry(segment.geometry)) return null;
      chars += segment.data.length;
      if (chars > MAX_WRITE_QUEUE_CHARS) return null;
      if (segment.data.length === 0) continue;
      parsed.push({
        data: segment.data,
        ...(segment.geometry === undefined ? {} : {
          geometry: { cols: segment.geometry.cols, rows: segment.geometry.rows },
        }),
      });
    }
    return parsed;
  };
  const parseBatchId = (value) => (
    value === undefined
      ? undefined
      : Number.isSafeInteger(value) && value >= 1
        ? value
        : null
  );

  terminal.onLineFeed(() => {
    const full = terminal.buffer.normal.baseY >= SCROLLBACK_ROWS;
    if (full && scrollbackFull && terminal.buffer.active.type === 'normal') {
      reportTrimmed(1);
      watchPendingBufferShifts += 1;
    }
    scrollbackFull = full;
  });

  const accept = (event) => {
    if (typeof event.data !== 'string') return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'scrollToBottom' && Object.keys(message).length === 1) {
      reportScrollState(true);
      if (watchMode && watchRenderer === 'canvas') {
        canvasScroll.scrollTop = canvasScroll.scrollHeight;
      }
      else if (watchMode) watchHost.scrollTop = watchHost.scrollHeight;
      else terminal.scrollToBottom();
      return;
    }
    if (message.kind === 'write') {
      if (!Object.keys(message).every((key) => (
        ['kind', 'segments', 'renderOperationId', 'batchId'].includes(key)
      ))) return;
      const segments = parseSegments(message.segments);
      if (segments === null) return;
      const batchId = parseBatchId(message.batchId);
      if (batchId === null) return;
      const renderOperationId = typeof message.renderOperationId === 'string'
        && /^(?:req|perf)_[a-zA-Z0-9_-]{8,64}$/u.test(message.renderOperationId)
        ? message.renderOperationId
        : null;
      if (message.renderOperationId !== undefined && renderOperationId === null) return;
      if (renderOperationId !== null) sendRenderStage(renderOperationId, 'webview_received');
      if (renderOperationId !== null && segments.length > 0) {
        segments[segments.length - 1].renderOperationId = renderOperationId;
      }
      if (batchId !== undefined) {
        if (segments.length === 0) send({ kind: 'drained', batchId });
        else segments[segments.length - 1].batchId = batchId;
      }
      for (const segment of segments) enqueueWrite(segment);
      return;
    }
    if (message.kind === 'replace') {
      if (!Object.keys(message).every((key) => (
        ['kind', 'segments', 'renderOperationId', 'batchId'].includes(key)
      ))) return;
      const segments = parseSegments(message.segments);
      if (segments === null) return;
      const batchId = parseBatchId(message.batchId);
      if (batchId === null) return;
      const renderOperationId = typeof message.renderOperationId === 'string'
        && /^(?:req|perf)_[a-zA-Z0-9_-]{8,64}$/u.test(message.renderOperationId)
        ? message.renderOperationId
        : null;
      if (message.renderOperationId !== undefined && renderOperationId === null) return;
      if (renderOperationId !== null) sendRenderStage(renderOperationId, 'webview_received');
      if (renderOperationId !== null && segments.length > 0) {
        segments[segments.length - 1].renderOperationId = renderOperationId;
      }
      if (batchId !== undefined && segments.length > 0) {
        segments[segments.length - 1].batchId = batchId;
      }
      pendingReplacement = segments;
      pendingEmptyReplacementBatchId = segments.length === 0 ? (batchId ?? null) : null;
      pendingEmptyReplacementOperationId = segments.length === 0 ? renderOperationId : null;
      writeQueue = [];
      queuedChars = 0;
      applyPendingReplacement();
      return;
    }
    if (
      message.kind === 'geometry'
      && validGeometry(message)
      && Object.keys(message).every((key) => ['kind', 'cols', 'rows'].includes(key))
    ) {
      applyGeometry(message);
      scheduleWatchRender();
      return;
    }
    if (message.kind === 'config' && typeof message.inputEnabled === 'boolean') {
      terminal.options.disableStdin = true;
      terminal.options.cursorBlink = false;
      if (
        message.minimumContrastRatio === DEFAULT_MINIMUM_CONTRAST_RATIO
        || message.minimumContrastRatio === MINIMUM_CONTRAST_RATIO
      ) {
        terminal.options.minimumContrastRatio = message.minimumContrastRatio;
      }
      if (
        typeof message.screenReaderEnabled === 'boolean'
        && terminal.options.screenReaderMode !== message.screenReaderEnabled
      ) {
        terminal.options.screenReaderMode = message.screenReaderEnabled;
      }
      if (message.rendererMode === 'canvas' || message.rendererMode === 'dom') {
        watchRenderer = message.screenReaderEnabled ? 'dom' : message.rendererMode;
        document.body.classList.toggle('canvas-renderer', watchRenderer === 'canvas');
        watchFullRender = true;
      }
      if (message.theme && typeof message.theme === 'object') {
        terminal.options.theme = message.theme;
        watchTheme = { ...watchTheme, ...message.theme };
        watchFullRender = true;
      }
      if (typeof message.background === 'string') {
        document.documentElement.style.setProperty('--terminal-background', message.background);
        document.documentElement.style.background = message.background;
        document.body.style.background = message.background;
        host.style.background = message.background;
      }
      if (message.theme && typeof message.theme.foreground === 'string') {
        document.documentElement.style.setProperty('--terminal-foreground', message.theme.foreground);
      }
      if (message.colorScheme === 'dark' || message.colorScheme === 'light') {
        document.documentElement.style.colorScheme = message.colorScheme;
      }
      terminal.refresh(0, terminal.rows - 1);
      scheduleWatchRender();
      scheduleFit();
    }
  };
  globalThis.addEventListener('message', accept);
  document.addEventListener('message', accept);

  scheduleFit();
  document.body.classList.add('watch-mode');
  document.body.classList.add('canvas-renderer');
  reportScrollState(true);
  send({ kind: 'ready' });
})();

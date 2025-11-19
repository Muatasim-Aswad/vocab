export const ansi = {
  // Reset
  reset: "\x1b[0m",

  // Text styles
  style: {
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    italic: "\x1b[3m",
    underline: "\x1b[4m",
    blink: "\x1b[5m",
    blinkFast: "\x1b[6m",
    inverse: "\x1b[7m",
    hidden: "\x1b[8m",
    strikethrough: "\x1b[9m",
    doubleUnderline: "\x1b[21m",
    framed: "\x1b[51m",
    encircled: "\x1b[52m",
    overline: "\x1b[53m",
  },

  // Style resets (turn off specific styles)
  resetStyle: {
    bold: "\x1b[22m", // normal intensity
    italic: "\x1b[23m",
    underline: "\x1b[24m",
    blink: "\x1b[25m",
    inverse: "\x1b[27m",
    hidden: "\x1b[28m",
    strikethrough: "\x1b[29m",
    framed: "\x1b[54m",
    overline: "\x1b[55m",
  },

  // Foreground colors (normal)
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    default: "\x1b[39m", // reset to default
    gray: "\x1b[90m",
    brightBlack: "\x1b[90m",
    brightRed: "\x1b[91m",
    brightGreen: "\x1b[92m",
    brightYellow: "\x1b[93m",
    brightBlue: "\x1b[94m",
    brightMagenta: "\x1b[95m",
    brightCyan: "\x1b[96m",
    brightWhite: "\x1b[97m",
  },

  // Background colors
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
    default: "\x1b[49m", // reset to default
    gray: "\x1b[100m",
    brightBlack: "\x1b[100m",
    brightRed: "\x1b[101m",
    brightGreen: "\x1b[102m",
    brightYellow: "\x1b[103m",
    brightBlue: "\x1b[104m",
    brightMagenta: "\x1b[105m",
    brightCyan: "\x1b[106m",
    brightWhite: "\x1b[107m",
  },

  // 256-color support (use with template functions)
  fg256: (n: number) => `\x1b[38;5;${n}m`,
  bg256: (n: number) => `\x1b[48;5;${n}m`,

  // RGB/Truecolor support (use with template functions)
  fgRgb: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
  bgRgb: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,

  // Cursor controls
  cursor: {
    up: (n = 1) => `\x1b[${n}A`,
    down: (n = 1) => `\x1b[${n}B`,
    forward: (n = 1) => `\x1b[${n}C`,
    back: (n = 1) => `\x1b[${n}D`,
    nextLine: (n = 1) => `\x1b[${n}E`,
    prevLine: (n = 1) => `\x1b[${n}F`,
    toColumn: (n: number) => `\x1b[${n}G`,
    to: (row: number, col: number) => `\x1b[${row};${col}H`,
    save: "\x1b[s",
    restore: "\x1b[u",
    hide: "\x1b[?25l",
    show: "\x1b[?25h",
  },

  // Screen controls
  screen: {
    clear: "\x1b[2J",
    clearDown: "\x1b[0J",
    clearUp: "\x1b[1J",
    clearLine: "\x1b[2K",
    clearLineRight: "\x1b[0K",
    clearLineLeft: "\x1b[1K",
    scrollUp: (n = 1) => `\x1b[${n}S`,
    scrollDown: (n = 1) => `\x1b[${n}T`,
  },
};

import { theme } from './theme.js';

export function text(content: string, color?: string): string {
  return `${color || theme.fg.white}${content}${theme.reset}`;
}

export function bold(content: string): string {
  return `${theme.bold}${content}${theme.reset}`;
}

export function dim(content: string): string {
  return `${theme.dim}${content}${theme.reset}`;
}

export function color(content: string, fg?: string): string {
  if (!fg) return content;
  return `${fg}${content}${theme.reset}`;
}

export function spinner(label?: string): { stop: () => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let interval: ReturnType<typeof setInterval>;

  const stop = () => {
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
  };

  interval = setInterval(() => {
    process.stdout.write(`\r${frames[i % frames.length]} ${label || ''}`);
    i++;
  }, 80);

  return { stop };
}

export function progress(current: number, total: number, label?: string): string {
  const width = 30;
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${bar} ${Math.round((current / total) * 100)}% ${label || ''}`;
}

export function box(content: string, title?: string): string {
  const lines = content.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length), title?.length || 0);
  const border = '─'.repeat(maxLen + 2);

  let result = `┌${border}┐\n`;
  if (title) {
    result += `│ ${title.padEnd(maxLen)} │\n`;
    result += `├${border}┤\n`;
  }
  for (const line of lines) {
    result += `│ ${line.padEnd(maxLen)} │\n`;
  }
  result += `└${border}┘`;
  return result;
}

export function success(msg: string): string {
  return text(msg, theme.fg.green);
}

export function error(msg: string): string {
  return text(msg, theme.fg.red);
}

export function warning(msg: string): string {
  return text(msg, theme.fg.yellow);
}

export function info(msg: string): string {
  return text(msg, theme.fg.cyan);
}

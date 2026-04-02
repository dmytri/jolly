import { box, success, error, warning, info, bold } from './components.js';
import { theme } from './theme.js';

export function render(content: string): void {
  console.log(content);
}

export function renderBox(content: string, title?: string): void {
  console.log(box(content, title));
}

export function renderSuccess(msg: string): void {
  console.log(success(msg));
}

export function renderError(msg: string): void {
  console.error(error(msg));
}

export function renderWarning(msg: string): void {
  console.log(warning(msg));
}

export function renderInfo(msg: string): void {
  console.log(info(msg));
}

export function renderHeader(text: string): void {
  console.log(`\n${bold(text)}\n`);
}

export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[0f');
}

export {};

declare global {
  namespace jest {
    interface Each {
      given: (name: string, fn: () => void) => void;
      when: (name: string, fn: () => void) => void;
      then: (name: string, fn: () => void) => void;
    }
  }
}

export function Given(name: string, fn: () => void): void {
  describe(`Given ${name}`, fn);
}

export function When(name: string, fn: () => void): void {
  describe(`When ${name}`, fn);
}

export function Then(name: string, fn: () => void): void {
  it(`Then ${name}`, fn);
}

export function And(name: string, fn: () => void): void {
  describe(`And ${name}`, fn);
}

export function But(name: string, fn: () => void): void {
  describe(`But ${name}`, fn);
}

export async function GivenAsync(name: string, fn: () => Promise<void>): Promise<void> {
  describe(`Given ${name}`, async () => {
    await fn();
  });
}

export async function WhenAsync(name: string, fn: () => Promise<void>): Promise<void> {
  describe(`When ${name}`, async () => {
    await fn();
  });
}

export async function ThenAsync(name: string, fn: () => Promise<void>): Promise<void> {
  it(`Then ${name}`, async () => {
    await fn();
  });
}

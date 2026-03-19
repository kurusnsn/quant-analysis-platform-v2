const noop = (...args: unknown[]): void => {
  void args;
};

const silentConsole = {
  debug: noop,
  error: noop,
  info: noop,
  log: noop,
  trace: noop,
  warn: noop,
};

export const devConsole =
  process.env.NODE_ENV === "development" ? console : silentConsole;

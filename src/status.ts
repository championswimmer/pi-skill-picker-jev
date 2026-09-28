const STATUS_KEY = "skill-picker";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface StatusContext {
  hasUI: boolean;
  ui: { setStatus(key: string, text: string | undefined): void };
}

/** Animate a Pi footer status only while a decision request is in flight. */
export async function withPickerStatus<T>(ctx: StatusContext, operation: () => Promise<T>): Promise<T> {
  if (!ctx.hasUI) return operation();
  let frame = 0;
  const show = () => ctx.ui.setStatus(STATUS_KEY, `${SPINNER[frame++ % SPINNER.length]} Picking the right skills…`);
  show();
  const timer = setInterval(show, 100);
  timer.unref();
  try {
    return await operation();
  } finally {
    clearInterval(timer);
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

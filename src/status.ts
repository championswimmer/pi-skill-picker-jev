const WIDGET_KEY = "skill-picker-loading";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface StatusContext {
  hasUI: boolean;
  isIdle(): boolean;
  ui: {
    setWidget(key: string, content: string[] | undefined, options?: { placement: "aboveEditor" }): void;
    setWorkingMessage(message?: string): void;
  };
}

/** Override Pi's Working row; before streaming starts, show a temporary row above the editor. */
export async function withPickerStatus<T>(ctx: StatusContext, operation: () => Promise<T>): Promise<T> {
  if (!ctx.hasUI) return operation();
  ctx.ui.setWorkingMessage("Picking Skills");
  let timer: ReturnType<typeof setInterval> | undefined;
  if (ctx.isIdle()) {
    let frame = 0;
    const show = () => ctx.ui.setWidget(WIDGET_KEY, [`${SPINNER[frame++ % SPINNER.length]} Picking Skills`], { placement: "aboveEditor" });
    show();
    timer = setInterval(show, 100);
    timer.unref();
  }
  try {
    return await operation();
  } finally {
    if (timer) {
      clearInterval(timer);
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
    ctx.ui.setWorkingMessage();
  }
}

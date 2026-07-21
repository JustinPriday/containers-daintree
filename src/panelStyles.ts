export const dockerPanelStyles = String.raw`
  .dc-root {
    --dc-bg: var(--theme-background-primary, #0d141b);
    --dc-surface: var(--theme-background-secondary, #111a23);
    --dc-elevated: var(--theme-background-tertiary, #18232e);
    --dc-console: #080f16;
    --dc-border: var(--theme-border, #2b3946);
    --dc-border-subtle: color-mix(in srgb, var(--dc-border) 58%, transparent);
    --dc-text: var(--theme-text-primary, #e6edf3);
    --dc-muted: var(--theme-text-secondary, #8b9aaa);
    --dc-faint: var(--theme-text-tertiary, #647382);
    --dc-accent: var(--theme-accent, #58a6ff);
    --dc-running: var(--theme-status-success, #3fb950);
    --dc-paused: var(--theme-status-warning, #d29922);
    --dc-error: var(--theme-status-error, #f85149);
    box-sizing: border-box;
    display: flex;
    height: 100%;
    min-height: 0;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    color: var(--dc-text);
    background: var(--dc-bg);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .dc-root *, .dc-root *::before, .dc-root *::after { box-sizing: border-box; }
  .dc-toolbar {
    display: flex; min-height: 48px; flex: 0 0 auto; align-items: center; gap: 10px;
    padding: 7px 10px 7px 12px; border-bottom: 1px solid var(--dc-border); background: var(--dc-surface);
  }
  .dc-project { min-width: 0; flex: 1; }
  .dc-project-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; }
  .dc-project-kind { border: 1px solid color-mix(in srgb, var(--dc-accent) 35%, var(--dc-border)); border-radius: 999px; padding: 1px 5px; color: var(--dc-accent); background: color-mix(in srgb, var(--dc-accent) 9%, transparent); font-size: 8px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
  .dc-project-path { overflow: hidden; color: var(--dc-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .dc-project-context { color: var(--dc-faint); font-size: 8px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
  .dc-project-separator { margin-inline: 5px; color: var(--dc-border); }
  .dc-status-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 999px; background: var(--dc-faint); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dc-faint) 18%, transparent); }
  .dc-status-dot.running { background: var(--dc-running); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dc-running) 18%, transparent); }
  .dc-status-dot.paused, .dc-status-dot.restarting { background: var(--dc-paused); }
  .dc-status-dot.error, .dc-status-dot.dead { background: var(--dc-error); }
  .dc-toolbar-actions, .dc-row-actions, .dc-console-actions { display: flex; align-items: center; gap: 3px; }
  .dc-button {
    display: inline-flex; height: 28px; align-items: center; justify-content: center; gap: 5px;
    border: 1px solid var(--dc-border-subtle); border-radius: 6px; padding: 0 8px; color: var(--dc-text);
    background: var(--dc-elevated); box-shadow: 0 1px 1px rgb(0 0 0 / 18%); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
  }
  .dc-button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--dc-accent) 48%, var(--dc-border)); background: color-mix(in srgb, var(--dc-accent) 10%, var(--dc-elevated)); }
  .dc-button:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
  .dc-button:focus-visible { outline: 2px solid var(--dc-accent); outline-offset: 1px; }
  .dc-button:disabled { cursor: default; opacity: .42; box-shadow: none; }
  .dc-button.icon { width: 28px; padding: 0; }
  .dc-button.primary { color: var(--dc-running); }
  .dc-button.danger { color: #ff8c8c; }
  .dc-button.active { color: var(--dc-accent); background: color-mix(in srgb, var(--dc-accent) 12%, transparent); }
  .dc-icon { width: 14px; height: 14px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
  .dc-binding {
    display: flex; flex: 0 0 auto; align-items: center; gap: 6px; padding: 7px 10px;
    border-bottom: 1px solid var(--dc-border); background: var(--dc-bg);
  }
  .dc-binding input { min-width: 0; flex: 1; height: 28px; border: 1px solid var(--dc-border); border-radius: 6px; padding: 0 8px; color: var(--dc-text); background: var(--dc-console); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
  .dc-body { display: flex; height: 0; min-height: 0; min-width: 0; flex: 1 1 0; overflow: hidden; }
  .dc-services { display: flex; width: 210px; min-width: 150px; flex: 0 0 auto; flex-direction: column; border-right: 1px solid var(--dc-border); background: var(--dc-surface); }
  .dc-services-heading { display: flex; min-height: 34px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 5px 4px 10px; color: var(--dc-faint); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .dc-services-heading .dc-button { width: 25px; height: 25px; padding: 0; }
  .dc-service-scroll { height: 0; min-height: 0; flex: 1 1 0; overflow-x: hidden; overflow-y: scroll; padding: 0 5px 8px; scrollbar-color: var(--dc-faint) transparent; scrollbar-width: thin; }
  .dc-service {
    display: flex; width: 100%; min-width: 0; flex-direction: column; gap: 4px; margin-bottom: 3px;
    border: 1px solid transparent; border-radius: 7px; padding: 5px; color: var(--dc-muted); background: transparent;
  }
  .dc-service:hover { color: var(--dc-text); border-color: var(--dc-border-subtle); background: color-mix(in srgb, var(--dc-elevated) 62%, transparent); }
  .dc-service.selected { color: var(--dc-text); border-color: color-mix(in srgb, var(--dc-accent) 42%, var(--dc-border)); background: var(--dc-elevated); box-shadow: inset 3px 0 var(--dc-accent); }
  .dc-service-select { display: flex; width: 100%; min-width: 0; align-items: center; gap: 7px; border: 0; padding: 2px 1px; color: inherit; background: transparent; font: inherit; text-align: left; cursor: pointer; }
  .dc-service-select:focus-visible { border-radius: 4px; outline: 2px solid var(--dc-accent); outline-offset: 1px; }
  .dc-service-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }
  .dc-service-name { display: block; overflow: hidden; font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .dc-service-detail { display: block; overflow: hidden; color: var(--dc-faint); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
  .dc-open-console { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 1px; border-radius: 4px; padding: 3px 4px; color: var(--dc-accent); background: color-mix(in srgb, var(--dc-accent) 11%, transparent); font-size: 9px; font-weight: 700; }
  .dc-open-console .dc-icon { width: 10px; height: 10px; }
  .dc-row-actions { display: flex; min-height: 24px; flex: 0 0 auto; align-items: center; gap: 4px; padding-left: 21px; }
  .dc-row-actions .dc-button { width: 25px; height: 23px; padding: 0; }
  .dc-console { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; background: var(--dc-console); }
  .dc-console-head { display: flex; min-height: 34px; flex: 0 0 auto; align-items: center; gap: 8px; padding: 0 9px; border-bottom: 1px solid var(--dc-border-subtle); background: var(--dc-surface); }
  .dc-console-title { min-width: 0; flex: 1; overflow: hidden; font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .dc-console-kicker { margin-right: 7px; border-radius: 4px; padding: 2px 5px; color: var(--dc-accent); background: color-mix(in srgb, var(--dc-accent) 12%, transparent); font-size: 9px; letter-spacing: .04em; text-transform: uppercase; }
  .dc-console-subtitle { color: var(--dc-faint); font-size: 9px; font-weight: 400; }
  .dc-log-viewport { height: 0; min-height: 0; flex: 1 1 0; overflow-x: auto; overflow-y: scroll; overscroll-behavior: contain; padding: 7px 0 14px; scrollbar-color: var(--dc-faint) transparent; scrollbar-gutter: stable; scrollbar-width: thin; }
  .dc-service-scroll::-webkit-scrollbar, .dc-log-viewport::-webkit-scrollbar { width: 10px; height: 10px; }
  .dc-service-scroll::-webkit-scrollbar-thumb, .dc-log-viewport::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background: var(--dc-faint); background-clip: padding-box; }
  .dc-service-scroll::-webkit-scrollbar-thumb:hover, .dc-log-viewport::-webkit-scrollbar-thumb:hover { background: var(--dc-muted); background-clip: padding-box; }
  .dc-log-empty { display: grid; height: 100%; place-items: center; padding: 24px; color: var(--dc-faint); font-size: 11px; text-align: center; }
  .dc-log-row { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 10px; padding: 2px 12px; border-left: 3px solid transparent; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.45; }
  .dc-log-row:hover { background: color-mix(in srgb, var(--dc-elevated) 65%, transparent); }
  .dc-log-service { overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .dc-log-message { min-width: 0; color: #c8d1da; overflow-wrap: anywhere; white-space: pre-wrap; }
  .dc-log-message.stderr { color: #ff9b9b; }
  .dc-log-time { margin-right: 8px; color: var(--dc-faint); user-select: none; }
  .dc-console-status { display: flex; min-height: 28px; flex: 0 0 auto; align-items: center; gap: 8px; padding: 0 8px 0 10px; border-top: 1px solid var(--dc-border); color: var(--dc-faint); background: var(--dc-surface); font-size: 9px; }
  .dc-live { display: inline-flex; align-items: center; gap: 5px; color: var(--dc-muted); }
  .dc-live::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: var(--dc-running); }
  .dc-status-spacer { flex: 1; }
  .dc-alert { flex: 0 0 auto; padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, var(--dc-error) 35%, var(--dc-border)); color: #ffabab; background: color-mix(in srgb, var(--dc-error) 8%, var(--dc-bg)); font-size: 10px; }
  .dc-empty-project { display: grid; min-height: 0; flex: 1; place-items: center; padding: 24px; color: var(--dc-muted); text-align: center; }
  .dc-empty-project strong { display: block; margin-bottom: 5px; color: var(--dc-text); font-size: 13px; }
  @media (max-width: 720px) {
    .dc-services { width: 156px; }
    .dc-service-detail { display: none; }
    .dc-open-console { padding-inline: 3px; }
    .dc-open-console:not(:first-child) { font-size: 0; }
    .dc-open-console .dc-icon { width: 12px; height: 12px; }
    .dc-log-row { grid-template-columns: 62px minmax(0, 1fr); padding-inline: 8px; font-size: 10px; }
    .dc-toolbar { gap: 6px; }
    .dc-toolbar-actions { gap: 2px; }
    .dc-toolbar .dc-button { padding-inline: 6px; }
  }
  @media (max-width: 500px) {
    .dc-body { flex-direction: column; }
    .dc-services { width: 100%; min-width: 0; max-height: 112px; border-right: 0; border-bottom: 1px solid var(--dc-border); }
    .dc-services-heading > span { display: none; }
    .dc-service-scroll { display: flex; height: auto; overflow-x: auto; overflow-y: hidden; padding: 5px; }
    .dc-service { width: auto; min-width: 100px; flex: 0 0 auto; }
  }
`;

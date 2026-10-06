/** Only product-specific layout and log content; standard controls belong to the host kit. */
export const dockerPanelStyles = String.raw`
  .dc-root { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; overflow:hidden; container-type:inline-size; color:var(--theme-text-primary); background:var(--theme-surface-panel); }
  .dc-context { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--theme-surface-toolbar); border-bottom:1px solid var(--theme-border-divider); }
  .dc-target { flex:1; min-width:0; }
  .dc-target-label { display:flex; align-items:center; gap:6px; font-size:12px; }
  .dc-target-path { margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--theme-text-secondary); font-size:11px; }
  .dc-binding { display:flex; align-items:end; gap:12px; padding:12px; border-bottom:1px solid var(--theme-border-divider); }
  .dc-actions,.dc-project-actions,.dc-resource-actions { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
  .dc-project-actions { padding:4px 12px; border-bottom:1px solid var(--theme-border-divider); background:var(--theme-surface-toolbar); }
  .dc-project-actions>span { margin-right:auto; }
  .dc-body { display:flex; flex:1; min-height:0; min-width:0; overflow:hidden; }
  .dc-services { display:flex; flex-direction:column; width:240px; min-height:0; min-width:0; border-right:1px solid var(--theme-border-divider); background:var(--theme-surface-panel); }
  .dc-section { display:flex; align-items:center; gap:4px; flex-wrap:wrap; padding:4px 8px; min-height:32px; border-bottom:1px solid var(--theme-border-divider); color:var(--theme-text-secondary); background:var(--theme-surface-toolbar); font-size:11px; }
  .dc-section>span:first-child { margin-right:auto; }
  .dc-service-scroll { flex:1; min-height:0; overflow:auto; }
  .dc-service { border-bottom:1px solid var(--theme-border-divider); }
  .dc-resource-actions { padding:0 8px 4px; }
  .dc-console { display:flex; flex:1; min-height:0; min-width:0; flex-direction:column; }
  .dc-console-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--theme-text-primary); }
  .dc-log-content { flex:1; min-height:0; min-width:0; overflow:hidden; }
  .dc-log-viewport { flex:1; min-height:0; min-width:0; color:var(--theme-terminal-foreground, var(--theme-text-primary)); background:var(--theme-terminal-background, var(--theme-surface-inset)); overscroll-behavior:contain; }
  .dc-log-row { display:grid; grid-template-columns:86px minmax(0,1fr); gap:8px; padding:3px 10px; border-left:2px solid transparent; font-family:var(--font-mono, monospace); font-size:11px; line-height:18px; }
  .dc-log-service { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dc-log-message { min-width:0; white-space:pre-wrap; overflow-wrap:anywhere; }
  .dc-log-message.stderr { color:var(--theme-terminal-red, var(--theme-terminal-foreground)); }
  .dc-log-time { color:var(--theme-terminal-muted, var(--theme-terminal-foreground)); }
  .dc-log-empty { display:grid; flex:1; place-items:center; padding:24px; color:var(--theme-terminal-foreground, var(--theme-text-secondary)); background:var(--theme-terminal-background, var(--theme-surface-inset)); font-size:12px; }
  .dc-empty { display:flex; flex:1; align-items:center; justify-content:center; flex-direction:column; gap:12px; padding:24px; }
  @container (max-width:600px) { .dc-services { width:190px; } .dc-binding { flex-direction:column; align-items:stretch; } .dc-console-tools { gap:2px; } .dc-log-row { grid-template-columns:64px minmax(0,1fr); padding-inline:6px; } }
  @container (max-width:440px) { .dc-body { flex-direction:column; } .dc-services { width:100%; max-height:140px; border-right:0; border-bottom:1px solid var(--theme-border-divider); } .dc-context { flex-wrap:wrap; } .dc-target { flex-basis:70%; } }
`;

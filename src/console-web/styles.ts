export const LIVE_CONSOLE_CSS = `
.mco-shell {
  color: #f4f1ed;
  background: #090909;
  min-height: 100%;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.mco-shell * { box-sizing: border-box; }
.mco-shell button,
.mco-shell input,
.mco-shell select,
.mco-shell textarea { font: inherit; }
.mco-topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid #2d2d2d;
  background: #101010;
}
.mco-title { margin: 0; font-size: 22px; }
.mco-subtle { color: #aaa49d; font-size: 12px; }
.mco-operator { text-align: right; }
.mco-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.mco-button {
  min-height: 38px;
  border: 1px solid #444;
  border-radius: 9px;
  padding: 0 12px;
  color: #f4f1ed;
  background: #181818;
  cursor: pointer;
}
.mco-button:hover { border-color: #777; }
.mco-button:disabled {
  opacity: .45;
  cursor: default;
}
.mco-button-primary {
  background: #781522;
  border-color: #963243;
}
.mco-button-danger {
  border-color: #6d2730;
  color: #f1b0b8;
}
.mco-banner {
  margin: 16px 20px 0;
  padding: 12px 14px;
  border: 1px solid #4d4242;
  border-radius: 10px;
  color: #d8d1ca;
  background: #151313;
}
.mco-banner-error {
  border-color: #6d2730;
  background: #241014;
  color: #f2b4bd;
}
.mco-banner-warn {
  border-color: #6c5828;
  background: #221c0e;
  color: #e3cd8b;
}
.mco-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 16px 20px;
}
.mco-metric {
  padding: 14px;
  border: 1px solid #2d2d2d;
  border-radius: 12px;
  background: #121212;
}
.mco-metric strong {
  display: block;
  margin-top: 6px;
  font-size: 24px;
}
.mco-grid {
  display: grid;
  grid-template-columns: minmax(260px, .8fr) minmax(420px, 1.4fr) minmax(320px, 1fr);
  min-height: 620px;
  border-top: 1px solid #2d2d2d;
}
.mco-panel {
  min-width: 0;
  border-right: 1px solid #2d2d2d;
}
.mco-panel:last-child { border-right: 0; }
.mco-panel-head {
  padding: 16px;
  border-bottom: 1px solid #2d2d2d;
}
.mco-panel-head h2 {
  margin: 0;
  font-size: 16px;
}
.mco-list { padding: 10px; }
.mco-card {
  display: block;
  width: 100%;
  margin: 0 0 8px;
  padding: 12px;
  border: 1px solid #282828;
  border-radius: 11px;
  color: #f4f1ed;
  background: #121212;
  text-align: left;
  cursor: pointer;
}
.mco-card-selected {
  border-color: #7c2b36;
  background: #1e1114;
}
.mco-card-breach { box-shadow: inset 3px 0 #d94b5a; }
.mco-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.mco-stack {
  display: grid;
  gap: 10px;
  padding: 16px;
}
.mco-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid #2d2d2d;
  border-radius: 11px;
  background: #2d2d2d;
}
.mco-fact {
  padding: 12px;
  background: #121212;
}
.mco-label {
  color: #9e9892;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.mco-value {
  display: block;
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.mco-tag {
  display: inline-flex;
  padding: 3px 7px;
  border: 1px solid #484848;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
}
.mco-tag-breach {
  color: #f0afb8;
  border-color: #6e2731;
}
.mco-actions {
  display: grid;
  gap: 10px;
  padding: 16px;
}
.mco-action {
  padding: 12px;
  border: 1px solid #303030;
  border-radius: 11px;
  background: #121212;
}
.mco-action h3 {
  margin: 0 0 10px;
  font-size: 14px;
}
.mco-field {
  display: grid;
  gap: 5px;
  margin: 8px 0;
}
.mco-field input,
.mco-field select,
.mco-field textarea {
  width: 100%;
  border: 1px solid #3b3b3b;
  border-radius: 8px;
  padding: 9px 10px;
  color: #f4f1ed;
  background: #0d0d0d;
}
.mco-field textarea { min-height: 80px; resize: vertical; }
.mco-timeline {
  list-style: none;
  margin: 0;
  padding: 16px;
}
.mco-timeline li {
  padding: 0 0 14px 14px;
  border-left: 1px solid #4b262b;
}
.mco-timeline strong,
.mco-timeline small { display: block; }
.mco-timeline small {
  margin-top: 3px;
  color: #99938d;
}
.mco-empty {
  padding: 24px 16px;
  color: #918c86;
  text-align: center;
}
.mco-history {
  color: #e2ca83;
  border-color: #6d5a2d;
}
@media (max-width: 980px) {
  .mco-grid { grid-template-columns: 1fr; }
  .mco-panel { border-right: 0; border-bottom: 1px solid #2d2d2d; }
}
@media (max-width: 620px) {
  .mco-topbar { flex-direction: column; }
  .mco-operator { text-align: left; }
  .mco-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mco-facts { grid-template-columns: 1fr; }
}`;

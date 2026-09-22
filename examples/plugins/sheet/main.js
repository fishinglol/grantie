// Sheet: makes the editor look like a real ruled index card (pale paper, blue rules, bold heading),
// after the "real notecards" look in r/ObsidianMD. It only sets colours and sizes; it never reads or
// changes a note. The look is removed automatically when the plugin is switched off.

const CSS = `
.live-editor {
  --text: #202124;
  --h: #202124;
  --text-dim: #59616d;
  --text-faint: #9399a2;
  --accent: #145ac4;
  --bg: #eceff4;
  --panel: #e6eaf1;
  --panel-hover: #d6dce8;
  background: #e4e1da;
}
.live-editor .cm-scroller {
  font-size: 15px;
  line-height: 24px;
  padding: 0 0 40px;
}
/* The note's name is the top of the sheet: same width and paper as the card below, ruled off like a report's header. */
.live-editor .note-title {
  box-sizing: border-box;
  width: min(800px, calc(100% - 28px));
  max-width: none;
  height: 48px;
  margin: 24px auto 0;
  padding: 0 18px;
  border-radius: 4px 4px 0 0;
  border-bottom: 1px solid #72aaff;
  background: #fafafa;
  color: #202124;
  font: 700 20px/47px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 -1px 2px rgba(0, 0, 0, 0.12);
}
.live-editor .note-title:focus { box-shadow: 0 -1px 2px rgba(0, 0, 0, 0.12), inset 0 -2px 0 #145ac4; }
.live-editor .cm-content {
  flex: 0 0 auto;
  box-sizing: border-box;
  width: min(800px, calc(100% - 28px));
  max-width: none;
  min-height: auto;
  margin: 0 auto;
  padding: 0 18px 24px;
  aspect-ratio: 8 / 5;
  border-radius: 0 0 4px 4px;
  background-color: #fafafa;
  background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 23px, #72aaff 23px, #72aaff 24px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 10px 28px rgba(0, 0, 0, 0.14);
  caret-color: #202124;
}
.live-editor .cm-line { line-height: 24px; }
.live-editor .cm-h1, .live-editor .cm-h2, .live-editor .cm-h3,
.live-editor .cm-h4, .live-editor .cm-h5, .live-editor .cm-h6 {
  font-size: 18px;
  line-height: 24px;
  padding-top: 0;
  color: #202124;
}
.live-editor .cm-li, .live-editor .cm-quote { line-height: 24px; }
/* The properties box is a whole number of 24px lines, so the rules below it still line up with the text. */
.live-editor .cm-props { padding: 0 16px; margin: 0; border-radius: 0; background: rgba(20, 90, 196, 0.06); }
.live-editor .cm-props-row { height: 24px; padding: 0; align-items: center; line-height: 24px; }
.live-editor .cm-props-chip { padding: 0 10px; line-height: 18px; }
`;

let on = true;
granite.editor.setStyle(CSS);

granite.commands.add({
  id: "toggle",
  name: "Turn the paper look on / off",
  run: async () => {
    on = !on;
    await granite.editor.setStyle(on ? CSS : "");
    granite.notice(on ? "Sheet paper on" : "Sheet paper off");
  },
});

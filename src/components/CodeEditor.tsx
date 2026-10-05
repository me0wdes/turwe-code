import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { syntaxHighlighting } from "@codemirror/language";
export function CodeEditor({
  value,
  onChange,
  path,
}: {
  value: string;
  onChange: (value: string) => void;
  path: string;
}) {
  const root = useRef<HTMLDivElement>(null),
    callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!root.current) return;
    const view = new EditorView({
      doc: value,
      parent: root.current,
      extensions: [
        basicSetup,
        syntaxHighlighting(oneDarkHighlightStyle),
        EditorState.lineSeparator.of(value.includes("\r\n") ? "\r\n" : "\n"),
        javascript({
          typescript: /\.[cm]?tsx?$/.test(path),
          jsx: /[jt]sx$/.test(path),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callback.current(update.state.sliceDoc());
        }),
        EditorView.theme(
          {
            "&": {
              height: "100%",
              backgroundColor: "var(--canvas)",
              color: "var(--text)",
            },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "Consolas,monospace",
              fontSize: "12px",
            },
            ".cm-gutters": {
              backgroundColor: "var(--canvas)",
              color: "var(--muted)",
              border: "none",
            },
            ".cm-activeLine,.cm-activeLineGutter": {
              backgroundColor: "var(--surface-hover)",
            },
            ".cm-cursor": { borderLeftColor: "var(--text)" },
            ".cm-content": { padding: "4px 0" },
          },
          { dark: true },
        ),
      ],
    });
    return () => view.destroy();
  }, [path]);
  return (
    <div className="code-editor" ref={root} aria-label={`Редактор ${path}`} />
  );
}

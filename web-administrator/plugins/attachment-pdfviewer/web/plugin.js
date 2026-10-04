// plugins/attachment-pdfviewer/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
function typeOf(att) {
  const t = att && att.type;
  return String(typeof t === "string" ? t : t && (t._ || t.$) || "").trim();
}
function register(platform2) {
  function PdfViewer({ attachment, channelId, messageId, platform: platform3 }) {
    const key = JSON.stringify([channelId, messageId, attachment.id]);
    const [state, setState] = React.useState({ status: "loading", key });
    const [attempt, retry] = React.useReducer((value) => value + 1, 0);
    React.useEffect(() => {
      let cancelled = false;
      setState({ status: "loading", key });
      (async () => {
        try {
          const full = await platform3.api.messages.attachment(channelId, messageId, attachment.id);
          const b64 = String(full?.content ?? "").replace(/\s+/g, "");
          if (cancelled) return;
          setState({ status: "ready", key, src: `data:application/pdf;base64,${b64}` });
        } catch (e) {
          if (cancelled) return;
          setState({ status: "error", key, message: e.message });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [channelId, messageId, attachment.id, key, platform3.api.messages, attempt]);
    if (state.key !== key || state.status === "loading") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt-[13px]" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-faint text-[10px] mb-1" }, "\u6B63\u5728\u52A0\u8F7D PDF\u2026"));
    }
    if (state.status === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "mt-[13px]" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, `\u65E0\u6CD5\u52A0\u8F7D PDF\uFF1A${state.message}`), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: () => retry() }, "\u91CD\u8BD5"));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "mt-[13px]" }, /* @__PURE__ */ React.createElement(
      "iframe",
      {
        title: "PDF \u9644\u4EF6",
        sandbox: "allow-same-origin",
        src: state.src,
        className: "w-full h-[576px] border border-[var(--bg3)] rounded-[4px]"
      }
    ));
  }
  platform2.registerAttachmentViewer({
    id: "pdfviewer",
    canHandle: (att) => /pdf/i.test(typeOf(att)),
    component: PdfViewer
  });
}
export {
  register
};

/*
 * Connector framework — registers the generic JSON fallback ('*') used for any
 * connector type without a dedicated panel (e.g. a third-party connector with
 * no web UI yet).
 *
 * The bundled transports now load as plugins (plugins/connector-*); their panel
 * implementations live in this shared client connector library (./vm.jsx,
 * ./tcp.jsx, …) and build on the shared React form layer (./react-forms.jsx,
 * which re-exports the pure ./forms.js helpers) — the web equivalent of Mirth's
 * client-core that connector extensions depend on.
 *
 * React port: the generic fallback panel's render(host, ctx) becomes
 * component(ctx) => JSX (a raw-properties JSON editor + Apply). The 'Basic' TCP
 * transmission mode stays imperative (its settings dialog is a modal); the
 * frame helpers live in ./forms.js and ship to the mllpmode plugin too.
 */

import { React, useRef, useEffect } from './react-platform.js';
import { toast, createCodeEditor } from '@oie/web-ui';
import { frameModeSampleFrame, frameModeSettingsDialog } from './forms.js';

/* Raw-JSON fallback panel: a code editor over the connector properties with an
   Apply button. Mutates `properties` in place (preserving '@class'/'@version')
   and calls onChange — identical semantics to the imperative version. */
function GenericPanel({ properties, onChange }: any) {
    const hostRef = useRef<any>(null);
    const editorRef = useRef<any>(null);
    useEffect(() => {
        const host = hostRef.current;
        const editor = createCodeEditor({
            value: JSON.stringify(properties, null, 2),
            language: 'text',
            minHeight: '320px'
        });
        editorRef.current = editor;
        host.appendChild(editor.el);
        return () => { try { editor.dispose && editor.dispose(); } catch { /* baseline no-op */ } editorRef.current = null; if (host) host.replaceChildren(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const apply = () => {
        let parsed: any;
        try {
            parsed = JSON.parse(editorRef.current.getValue());
        } catch (e: any) {
            toast('JSON 无效：' + e.message, 'error');
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            toast('属性必须是一个 JSON 对象', 'error');
            return;
        }
        for (const key of Object.keys(properties)) {
            if (!(key in parsed)) delete properties[key];
        }
        Object.assign(properties, parsed);
        onChange();
        toast('属性已应用');
    };
    return (
        <div>
            <div className="hint mb-1.5">
                此连接器类型没有专用编辑器 —— 请直接编辑原始属性 JSON。必须保留 "@class" 与 "@version"。
            </div>
            <div ref={hostRef} />
            <div className="mt-2">
                <button className="btn btn-primary" onClick={apply}>应用</button>
            </div>
        </div>
    );
}

function genericPanel() {
    return {
        defaults(version: any) {
            return { '@version': version };
        },
        component: GenericPanel
    };
}

export function register(platform: any) {
    platform.registerConnectorPanel('*', 'SOURCE', genericPanel());
    platform.registerConnectorPanel('*', 'DESTINATION', genericPanel());

    // Basic TCP transmission mode (no framing) — the built-in TransmissionMode;
    // MLLP framing ships as the mllpmode plugin.
    platform.registerTransmissionMode('Basic', {
        label: '基本 TCP', order: 20,
        apply(tm: any) {
            tm['@class'] = 'com.mirth.connect.model.transmission.framemode.FrameModeProperties';
            tm.pluginPointName = 'Basic';
            tm.startOfMessageBytes = '';
            tm.endOfMessageBytes = '';
            // Drop MLLP-only fields when switching away from MLLP.
            delete tm.useMLLPv2; delete tm.ackBytes; delete tm.nackBytes; delete tm.maxRetries;
        },
        sampleFrame: frameModeSampleFrame,
        openSettings: frameModeSettingsDialog
    });
}

/*
 * JMS Listener (JmsReceiverProperties) / JMS Sender (JmsDispatcherProperties).
 * Field names and defaults mirror server/src/com/mirth/connect/connectors/jms
 * (both extend JmsConnectorProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. The shared
 * connection-field schema and defaults are reused VERBATIM.
 */

import { React } from './react-platform.js';
import { h, clear, select, icon, checkbox, toast, confirmDialog, promptDialog } from '@oie/web-ui';
import * as api from '../core/api.js';
import {
    ConnectorForm, asBool, YES_NO, writeMapEntries, apiErrorMessage,
    defaultSourceProperties, defaultDestinationProperties, requireFields
} from './react-forms.js';

/* JmsConnectorProperties constructor defaults (shared by listener/sender). */
function jmsConnectorDefaults() {
    return {
        useJndi: false,
        jndiProviderUrl: '',
        jndiInitialContextFactory: '',
        jndiConnectionFactoryName: '',
        connectionFactoryClass: '',
        connectionProperties: { '@class': 'linked-hash-map' },
        username: '',
        password: '',
        destinationName: '',
        topic: false,
        clientId: ''
    };
}

const usingJndi = (p: any) => asBool(p.useJndi);

/* ---- Connection Templates (Swing JmsTemplateListModel + /connectors/jms/templates) ----
   ActiveMQ + JBoss are predefined/read-only; user templates persist server-side.
   A template carries ONLY the connection fields (JNDI + factory class + the
   connection-properties map); Load leaves credentials/destination untouched,
   matching JmsConnectorPanel.loadTemplateButtonActionPerformed. */
const TEMPLATE_CLASS = 'com.mirth.connect.connectors.jms.JmsConnectorProperties';
const PREDEFINED_TEMPLATES: Record<string, any> = {
    'ActiveMQ': {
        useJndi: false, jndiProviderUrl: '', jndiInitialContextFactory: '', jndiConnectionFactoryName: '',
        connectionFactoryClass: 'org.apache.activemq.ActiveMQConnectionFactory',
        connectionProperties: writeMapEntries({ '@class': 'linked-hash-map' }, [
            ['brokerURL', 'failover:(tcp://localhost:61616)?maxReconnectAttempts=0'],
            ['closeTimeout', '15000'],
            ['useCompression', 'no']
        ], 'string')
    },
    'JBoss Messaging / MQ': {
        useJndi: true,
        jndiProviderUrl: 'jnp://localhost:1099',
        jndiInitialContextFactory: 'org.jnp.interfaces.NamingContextFactory',
        jndiConnectionFactoryName: 'java:/ConnectionFactory',
        connectionFactoryClass: '',
        connectionProperties: { '@class': 'linked-hash-map' }
    }
};
const PREDEFINED_NAMES = Object.keys(PREDEFINED_TEMPLATES);
const isPredefined = (name: any) => Object.prototype.hasOwnProperty.call(PREDEFINED_TEMPLATES, name);
const cloneMap = (m: any) => (m && typeof m === 'object' ? JSON.parse(JSON.stringify(m)) : { '@class': 'linked-hash-map' });

/* Server templates fetched once and cached for the editor's lifetime; the cache
   is invalidated on save/delete so the dropdown reflects the change. */
let templatesPromise: any = null;
function loadServerTemplates() {
    if (!templatesPromise) {
        templatesPromise = api.get('/connectors/jms/templates')
            .then((list: any) => (list && typeof list === 'object' && !Array.isArray(list) ? list : {}))
            .catch(() => ({}));   // servlet absent / unreachable -> predefined only
    }
    return templatesPromise;
}

/* "Connection Templates" control: a template dropdown + Load / Save / Delete. */
function connectionTemplatesField() {
    let selected = '';          // persists across form repaints (field built once)
    let serverTemplates: Record<string, any> = {};
    return {
        label: '连接模板', type: 'custom', span: true,
        render: (p: any, ctx: any) => {
            const wrap = h('div', { class: 'flex items-center gap-1.5 flex-wrap' });
            const names = () => [...PREDEFINED_NAMES, ...Object.keys(serverTemplates).filter((n: any) => !isPredefined(n))];
            const templateFor = (name: any) => (isPredefined(name) ? PREDEFINED_TEMPLATES[name] : serverTemplates[name]);

            function paint() {
                clear(wrap);
                const sel = select(
                    [{ value: '', label: '— 请选择模板 —' }, ...names().map((n: any) => ({ value: n, label: n }))],
                    selected, { onChange: (e: any) => { selected = e.target.value; paint(); } });
                sel.style.width = '240px';
                wrap.append(
                    sel,
                    h('button.btn', { type: 'button', disabled: !selected, onClick: applyTemplate }, '载入'),
                    h('button.btn', { type: 'button', onClick: saveTemplate }, '保存'),
                    h('button.btn', { type: 'button', disabled: !selected || isPredefined(selected), onClick: deleteTemplate }, icon('x'), '删除'));
            }

            function applyTemplate() {
                const tpl = templateFor(selected);
                if (!tpl) { toast('该模板在服务端已不存在。', 'warn'); return; }
                p.useJndi = asBool(tpl.useJndi);
                p.jndiProviderUrl = String(tpl.jndiProviderUrl ?? '');
                p.jndiInitialContextFactory = String(tpl.jndiInitialContextFactory ?? '');
                p.jndiConnectionFactoryName = String(tpl.jndiConnectionFactoryName ?? '');
                p.connectionFactoryClass = String(tpl.connectionFactoryClass ?? '');
                p.connectionProperties = cloneMap(tpl.connectionProperties);
                ctx.onChange();
                ctx.repaint();   // re-render the form so the loaded fields + map show
            }

            async function saveTemplate() {
                const raw = await promptDialog('保存连接模板', '模板名称', selected && !isPredefined(selected) ? selected : '');
                const name = raw ? raw.trim() : '';
                if (!name) return;
                if (isPredefined(name)) { toast(`"${name}" 是内置模板，不能被覆盖。`, 'warn'); return; }
                const body = {
                    useJndi: asBool(p.useJndi),
                    jndiProviderUrl: p.jndiProviderUrl ?? '',
                    jndiInitialContextFactory: p.jndiInitialContextFactory ?? '',
                    jndiConnectionFactoryName: p.jndiConnectionFactoryName ?? '',
                    connectionFactoryClass: p.connectionFactoryClass ?? '',
                    connectionProperties: cloneMap(p.connectionProperties)
                };
                try {
                    await api.put(`/connectors/jms/templates/${encodeURIComponent(name)}`, body, { wrapKey: TEMPLATE_CLASS });
                    templatesPromise = null;
                    serverTemplates = await loadServerTemplates();
                    selected = name;
                    paint();
                    toast('连接模板已保存');
                } catch (e) { toast(apiErrorMessage(e), 'error'); }
            }

            async function deleteTemplate() {
                if (!selected || isPredefined(selected)) return;
                if (!(await confirmDialog('删除模板', `确定要删除连接模板 "${selected}" 吗？`, { danger: true, okLabel: '删除' }))) return;
                try {
                    await api.del(`/connectors/jms/templates/${encodeURIComponent(selected)}`);
                    templatesPromise = null;
                    serverTemplates = await loadServerTemplates();
                    selected = '';
                    paint();
                } catch (e) { toast(apiErrorMessage(e), 'error'); }
            }

            paint();
            loadServerTemplates().then((list: any) => { serverTemplates = list; paint(); });
            return wrap;
        }
    };
}

/* Connection fields shared by listener and sender. */
function jmsConnectionFields() {
    return [
        { section: '连接设置' },
        connectionTemplatesField(),
        { key: 'useJndi', label: '使用 JNDI', type: 'radio', options: YES_NO, refresh: true },
        { key: 'jndiProviderUrl', label: '提供者 URL', type: 'text', width: '420px', disabled: (p: any) => !usingJndi(p) },
        { key: 'jndiInitialContextFactory', label: '初始上下文工厂', type: 'text', width: '420px', disabled: (p: any) => !usingJndi(p) },
        { key: 'jndiConnectionFactoryName', label: '连接工厂名称', type: 'text', width: '320px', disabled: (p: any) => !usingJndi(p) },
        { key: 'connectionFactoryClass', label: '连接工厂类', type: 'text', width: '420px', disabled: usingJndi },
        { key: 'connectionProperties', label: '连接属性', type: 'keyvalue' },
        { key: 'username', label: '用户名', type: 'text', width: '220px' },
        { key: 'password', label: '密码', type: 'password', width: '220px' }
    ];
}

const jmsListener = {
    defaults(version: any) {
        return Object.assign({
            '@class': 'com.mirth.connect.connectors.jms.JmsReceiverProperties',
            '@version': version,
            pluginProperties: null,
            sourceConnectorProperties: defaultSourceProperties(version),
            selector: '',
            reconnectIntervalMillis: '10000',
            durableTopic: false
        }, jmsConnectorDefaults());
    },
    component({ properties, onChange }: any) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                ...jmsConnectionFields(),
                { section: '目标设置' },
                {
                    // Swing renders durableTopicCheckbox as a MirthCheckBox appended INLINE onto the
                    // Destination Type radio row (Queue / Topic / [x] Durable, one line). Mirror that
                    // with an append checkbox rather than a separate radio row. Same setEnabled gating:
                    // durable enabled only when Topic is selected (destinationTypeTopicActionPerformed
                    // enables it for the listener; destinationTypeQueueActionPerformed disables it).
                    key: 'topic', label: '目标类型', type: 'radio', refresh: true,
                    options: [
                        { value: false, label: '队列' },
                        { value: true, label: '主题' }
                    ],
                    append: (p: any, ctx: any) => checkbox('持久订阅', asBool(p.durableTopic), {
                        disabled: !asBool(p.topic),
                        onChange: (e: any) => { p.durableTopic = e.target.checked; ctx.onChange(); ctx.repaint(); }
                    }).el
                },
                { key: 'destinationName', label: '目标名称', type: 'text', width: '320px' },
                { key: 'clientId', label: '客户端 ID', type: 'text', width: '220px' },
                { key: 'reconnectIntervalMillis', label: '重连间隔（毫秒）', type: 'number', width: '120px' },
                { key: 'selector', label: '选择器', type: 'text', width: '320px' }
            ]} />
        );
    },
    // Swing JmsConnectorPanel.checkProperties (shared, connectorType == TYPE_LISTENER):
    // when JNDI -> provider URL / initial context factory / connection factory name required;
    // when not JNDI -> connection factory class required, plus client ID required only when the
    // destination is a durable Topic; destination name always required.
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'jndiProviderUrl', label: '提供者 URL', when: usingJndi },
            { key: 'jndiInitialContextFactory', label: '初始上下文工厂', when: usingJndi },
            { key: 'jndiConnectionFactoryName', label: '连接工厂名称', when: usingJndi },
            { key: 'connectionFactoryClass', label: '连接工厂类', when: (p: any) => !usingJndi(p) },
            { key: 'clientId', label: '客户端 ID', when: (p: any) => !usingJndi(p) && asBool(p.topic) && asBool(p.durableTopic) },
            { key: 'destinationName', label: '目标名称' }
        ]);
    }
};

const jmsSender = {
    defaults(version: any) {
        return Object.assign({
            '@class': 'com.mirth.connect.connectors.jms.JmsDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            template: '${message.encodedData}'
        }, jmsConnectorDefaults());
    },
    component({ properties, onChange }: any) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                ...jmsConnectionFields(),
                { section: '目标设置' },
                { key: 'topic', label: '目标类型', type: 'radio', disabled: usingJndi, options: [
                    { value: false, label: '队列' },
                    { value: true, label: '主题' }
                ] },
                { key: 'destinationName', label: '目标名称', type: 'text', width: '320px' },
                { key: 'clientId', label: '客户端 ID', type: 'text', width: '220px' },
                { section: '模板' },
                { key: 'template', label: '模板', type: 'code', minHeight: '260px' }
            ]} />
        );
    },
    // Swing JmsConnectorPanel.checkProperties (shared, connectorType == TYPE_SENDER):
    // when JNDI -> provider URL / initial context factory / connection factory name required;
    // when not JNDI -> connection factory class required; destination name always required.
    // (The durable-topic client ID requirement is listener-only.)
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'jndiProviderUrl', label: '提供者 URL', when: usingJndi },
            { key: 'jndiInitialContextFactory', label: '初始上下文工厂', when: usingJndi },
            { key: 'jndiConnectionFactoryName', label: '连接工厂名称', when: usingJndi },
            { key: 'connectionFactoryClass', label: '连接工厂类', when: (p: any) => !usingJndi(p) },
            { key: 'destinationName', label: '目标名称' }
        ]);
    }
};

export function register(platform: any) {
    platform.registerConnectorPanel('JMS Listener', 'SOURCE', jmsListener);
    platform.registerConnectorPanel('JMS Sender', 'DESTINATION', jmsSender);
}

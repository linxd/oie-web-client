/*
 * DICOM Listener (DICOMReceiverProperties) / DICOM Sender (DICOMDispatcherProperties).
 * Field names and defaults mirror server/src/com/mirth/connect/connectors/dimse.
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. Field schemas,
 * the shared TLS-field block, and defaults are reused VERBATIM. The 'Ports in
 * Use' button is the original imperative portsInUseButton() DOM node, mounted
 * via the form's `append`.
 *
 * Field order, labels and gating mirror the Swing DICOMListener.java (GroupLayout)
 * and DICOMSender.java (MigLayout) panels.
 */

import { React } from './react-platform.js';
import {
    ConnectorForm, portsInUseButton, listenerAddressField, asBool, YES_NO,
    defaultSourceProperties, defaultDestinationProperties, defaultListenerProperties, requireFields
} from './react-forms.js';

const TLS_OPTIONS = [
    { value: 'notls', label: '无 TLS' },
    { value: '3des', label: '3DES' },
    { value: 'aes', label: 'AES' },
    { value: 'without', label: '不加密' }
];

// Swing tlsNoRadioActionPerformed greys (setEnabled(false)) the whole keystore /
// client-auth / accept-ssl-v2 block when TLS = "No TLS"; the 3DES/AES/Without
// handlers re-enable it. Fields stay visible, just disabled.
const tlsDisabled = (p: any) => p.tls === 'notls';

/* TLS / keystore fields shared by listener and sender (same Java fields). */
function tlsFields() {
    return [
        { section: 'TLS 设置' },
        { key: 'tls', label: 'TLS', type: 'select', options: TLS_OPTIONS, width: '120px', refresh: true },
        { key: 'noClientAuth', label: 'TLS 客户端认证', type: 'radio', options: [
            { value: false, label: '是' },
            { value: true, label: '否' }
        ], disabled: tlsDisabled },
        { key: 'nossl2', label: '接受 SSL v2 TLS 握手', type: 'radio', options: [
            { value: false, label: '是' },
            { value: true, label: '否' }
        ], disabled: tlsDisabled },
        { key: 'keyStore', label: '密钥库', type: 'text', width: '320px', disabled: tlsDisabled },
        { key: 'keyStorePW', label: '密钥库密码', type: 'password', width: '220px', disabled: tlsDisabled },
        { key: 'trustStore', label: '信任库', type: 'text', width: '320px', disabled: tlsDisabled },
        { key: 'trustStorePW', label: '信任库密码', type: 'password', width: '220px', disabled: tlsDisabled },
        { key: 'keyPW', label: '密钥密码', type: 'password', width: '220px', disabled: tlsDisabled }
    ];
}

// DICOMListener mutual gating (bigendian/defts/native action handlers):
//   - defts=Yes disables AND forces bigEndian=No + nativeData=No.
//   - bigEndian=Yes disables defts AND forces defts=No.
//   - nativeData=Yes disables defts AND forces defts=No.
//   - defts is enabled only when bigEndian=No AND nativeData=No.
//   - bigEndian / nativeData are disabled when defts=Yes.
const deftsLocked = (p: any) => asBool(p.bigEndian) || asBool(p.nativeData);
const transferSyntaxLocked = (p: any) => asBool(p.defts);

const dicomListener = {
    defaults(version: any) {
        return {
            '@class': 'com.mirth.connect.connectors.dimse.DICOMReceiverProperties',
            '@version': version,
            pluginProperties: null,
            listenerConnectorProperties: defaultListenerProperties(version, '104'),
            sourceConnectorProperties: defaultSourceProperties(version),
            applicationEntity: '',
            localHost: '',
            localPort: '',
            localApplicationEntity: '',
            soCloseDelay: '50',
            releaseTo: '5',
            requestTo: '5',
            idleTo: '60',
            reaper: '10',
            rspDelay: '0',
            pdv1: false,
            sndpdulen: '16',
            rcvpdulen: '16',
            async: '0',
            bigEndian: false,
            bufSize: '1',
            defts: false,
            dest: '',
            nativeData: false,
            sorcvbuf: '0',
            sosndbuf: '0',
            tcpDelay: true,
            keyPW: '',
            keyStore: '',
            keyStorePW: '',
            noClientAuth: true,
            nossl2: true,
            tls: 'notls',
            trustStore: '',
            trustStorePW: ''
        };
    },
    component({ properties, onChange }: any) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: '连接设置' },
                listenerAddressField('listenerConnectorProperties.host', '监听器地址'),
                { key: 'listenerConnectorProperties.port', label: '监听器端口', type: 'number', width: '90px', append: () => portsInUseButton() },
                { key: 'applicationEntity', label: '应用实体', type: 'text', width: '220px' },
                { key: 'async', label: '最大异步操作数', type: 'number', width: '110px' },
                { key: 'pdv1', label: '打包 PDV', type: 'radio', options: YES_NO },
                { key: 'reaper', label: 'DIMSE-RSP 间隔周期（秒）', type: 'number', width: '110px' },
                { key: 'releaseTo', label: 'A-RELEASE-RP 超时（秒）', type: 'number', width: '110px' },
                { key: 'soCloseDelay', label: 'A-ABORT 后套接字关闭延迟（毫秒）', type: 'number', width: '110px' },
                { key: 'requestTo', label: 'ASSOCIATE-RQ 超时（毫秒）', type: 'number', width: '110px' },
                { key: 'idleTo', label: 'DIMSE-RQ 超时（毫秒）', type: 'number', width: '110px' },
                { key: 'rspDelay', label: 'DIMSE-RSP 延迟（毫秒）', type: 'number', width: '110px' },
                { key: 'sndpdulen', label: 'P-DATA-TF PDU 最大发送长度（KB）', type: 'number', width: '110px' },
                { key: 'rcvpdulen', label: 'P-DATA-TF PDU 最大接收长度（KB）', type: 'number', width: '110px' },
                { key: 'sosndbuf', label: '发送套接字缓冲区大小（KB）', type: 'number', width: '110px' },
                { key: 'sorcvbuf', label: '接收套接字缓冲区大小（KB）', type: 'number', width: '110px' },
                { key: 'bufSize', label: '转码器缓冲区大小（KB）', type: 'number', width: '110px' },
                {
                    key: 'bigEndian', label: '接受显式 VR 大端字节序', type: 'radio', options: YES_NO, refresh: true,
                    disabled: transferSyntaxLocked,
                    onSet: (p: any) => { if (asBool(p.bigEndian)) p.defts = false; }
                },
                {
                    key: 'defts', label: '仅接受默认传输语法', type: 'radio', options: YES_NO, refresh: true,
                    disabled: deftsLocked,
                    onSet: (p: any) => { if (asBool(p.defts)) { p.bigEndian = false; p.nativeData = false; } }
                },
                {
                    key: 'nativeData', label: '仅未压缩像素数据', type: 'radio', options: YES_NO, refresh: true,
                    disabled: transferSyntaxLocked,
                    onSet: (p: any) => { if (asBool(p.nativeData)) p.defts = false; }
                },
                { key: 'tcpDelay', label: 'TCP 延迟', type: 'radio', options: YES_NO },
                { key: 'dest', label: '将接收对象存入目录', type: 'text', width: '320px' },
                ...tlsFields()
            ]} />
        );
    },
    // DICOMListener.checkProperties has no required fields; the shared
    // ListenerSettingsPanel.checkProperties requires Listener Address + Listener Port.
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'listenerConnectorProperties.host', label: '监听器地址' },
            { key: 'listenerConnectorProperties.port', label: '监听器端口' }
        ]);
    }
};

const dicomSender = {
    defaults(version: any) {
        return {
            '@class': 'com.mirth.connect.connectors.dimse.DICOMDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            host: '127.0.0.1',
            port: '104',
            applicationEntity: '',
            localHost: '',
            localPort: '',
            localApplicationEntity: '',
            template: '${DICOMMESSAGE}',
            acceptTo: '5000',
            async: '0',
            bufSize: '1',
            connectTo: '0',
            priority: 'med',
            passcode: '',
            pdv1: false,
            rcvpdulen: '16',
            reaper: '10',
            releaseTo: '5',
            rspTo: '60',
            shutdownDelay: '1000',
            sndpdulen: '16',
            soCloseDelay: '50',
            sorcvbuf: '0',
            sosndbuf: '0',
            stgcmt: false,
            tcpDelay: true,
            ts1: false,
            uidnegrsp: false,
            username: '',
            keyPW: '',
            keyStore: '',
            keyStorePW: '',
            noClientAuth: true,
            nossl2: true,
            tls: 'notls',
            trustStore: '',
            trustStorePW: ''
        };
    },
    component({ properties, onChange }: any) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: '连接设置' },
                { key: 'host', label: '远程主机', type: 'text', width: '200px' },
                { key: 'localHost', label: '本地主机', type: 'text', width: '200px' },
                { key: 'port', label: '远程端口', type: 'number', width: '90px' },
                { key: 'localPort', label: '本地端口', type: 'number', width: '90px', append: () => portsInUseButton() },
                { key: 'applicationEntity', label: '远程应用实体', type: 'text', width: '220px' },
                { key: 'localApplicationEntity', label: '本地应用实体', type: 'text', width: '220px' },
                { key: 'async', label: '最大异步操作数', type: 'number', width: '110px' },
                { key: 'priority', label: '优先级', type: 'radio', options: [
                    { value: 'high', label: '高' },
                    { value: 'med', label: '中' },
                    { value: 'low', label: '低' }
                ] },
                { key: 'stgcmt', label: '请求存储承诺', type: 'radio', options: YES_NO },
                { key: 'username', label: '用户名', type: 'text', width: '220px' },
                { key: 'passcode', label: '口令', type: 'password', width: '220px' },
                { section: '设置' },
                { key: 'uidnegrsp', label: '请求肯定用户身份响应', type: 'radio', options: YES_NO },
                { key: 'pdv1', label: '打包 PDV', type: 'radio', options: YES_NO },
                { key: 'reaper', label: 'DIMSE-RSP 间隔周期（秒）', type: 'number', width: '110px' },
                { key: 'sndpdulen', label: 'P-DATA-TF PDU 最大发送长度（KB）', type: 'number', width: '110px' },
                { key: 'releaseTo', label: 'A-RELEASE-RP 超时（秒）', type: 'number', width: '110px' },
                { key: 'rcvpdulen', label: 'P-DATA-TF PDU 最大接收长度（KB）', type: 'number', width: '110px' },
                { key: 'rspTo', label: 'DIMSE-RSP 超时（秒）', type: 'number', width: '110px' },
                { key: 'sosndbuf', label: '发送套接字缓冲区大小（KB）', type: 'number', width: '110px' },
                { key: 'shutdownDelay', label: '关闭延迟（毫秒）', type: 'number', width: '110px' },
                { key: 'sorcvbuf', label: '接收套接字缓冲区大小（KB）', type: 'number', width: '110px' },
                { key: 'soCloseDelay', label: 'A-ABORT 后套接字关闭延迟（毫秒）', type: 'number', width: '110px' },
                { key: 'bufSize', label: '转码器缓冲区大小（KB）', type: 'number', width: '110px' },
                { key: 'acceptTo', label: 'A-ASSOCIATE-AC 超时（毫秒）', type: 'number', width: '110px' },
                { key: 'connectTo', label: 'TCP 连接超时（毫秒）', type: 'number', width: '110px' },
                { key: 'tcpDelay', label: 'TCP 延迟', type: 'radio', options: YES_NO },
                { key: 'ts1', label: '默认表示语法', type: 'radio', options: YES_NO },
                ...tlsFields(),
                { section: '模板' },
                { key: 'template', label: '模板', type: 'code', minHeight: '260px' }
            ]} />
        );
    },
    // DICOMSender.checkProperties: Remote Host, Remote Port, and Template are required
    // (host also enforces a minimum length, skipped here as a numeric/format check).
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'host', label: '远程主机' },
            { key: 'port', label: '远程端口' },
            { key: 'template', label: '模板' }
        ]);
    }
};

export function register(platform: any) {
    platform.registerConnectorPanel('DICOM Listener', 'SOURCE', dicomListener);
    platform.registerConnectorPanel('DICOM Sender', 'DESTINATION', dicomSender);
}

/*
 * Destination-mapping language forms. The classic Administrator shows one label
 * list but inserts Velocity tokens for template connectors and Rhino
 * expressions for JavaScript connectors; the web client must convert on insert,
 * because a ${...} pasted into a JavaScript Writer is a syntax error the engine
 * only reports later as "Script not found in cache".
 *
 * Run: node client/core/mappings.test.js   (regenerate mappings.js first:
 *      node tools/build-core.mjs)
 */
import assert from 'node:assert/strict';
import {
    DESTINATION_MAPPINGS,
    DESTINATION_MAPPINGS_JS,
    SCRIPT_REFERENCE,
    mappingsFor,
    mappingTextFor,
    mappingLanguageOf,
    isJsLanguage
} from './mappings.js';

// The Velocity column keeps its shape and contents (plugin API parity).
assert.equal(DESTINATION_MAPPINGS.length, 21);
assert.deepEqual(DESTINATION_MAPPINGS[0], ['通道 ID', '${channelId}']);
assert.ok(DESTINATION_MAPPINGS.every(([label, token]) => label && token));

// The JavaScript column carries the same labels minus the Velocity-only rows.
const jsLabels = DESTINATION_MAPPINGS_JS.map(([label]) => label);
assert.ok(!jsLabels.includes('计数'), 'COUNT has no Rhino equivalent');
assert.ok(!jsLabels.includes('CDATA 标签'), 'raw CDATA is a template construct');
assert.equal(jsLabels.length, DESTINATION_MAPPINGS.length - 2);

// No JavaScript entry may carry a Velocity token — that is the whole bug.
for (const [label, token] of DESTINATION_MAPPINGS_JS) {
    assert.ok(!token.includes('${'), `${label} inserts a Velocity token into JS: ${token}`);
    assert.ok(!token.includes('<![CDATA['), `${label} inserts CDATA into JS`);
}
// ...and the classic Rhino spellings the Administrator uses.
const jsToken = (label) => DESTINATION_MAPPINGS_JS.find(([l]) => l === label)[1];
assert.equal(jsToken('原始数据'), 'connectorMessage.getRawData()');
assert.equal(jsToken('转换后数据'), 'connectorMessage.getTransformedData()');
assert.equal(jsToken('编码后数据'), 'connectorMessage.getEncodedData()');
assert.equal(jsToken('消息 ID'), 'connectorMessage.getMessageId()');
assert.equal(jsToken('消息来源'), "$('mirth_source')");
assert.equal(jsToken('通道 ID'), 'channelId');
assert.equal(jsToken('唯一 ID'), 'var uuid = UUIDGenerator.getUUID();');

// Rail selection by editor language.
assert.equal(mappingsFor('javascript'), DESTINATION_MAPPINGS_JS);
assert.equal(mappingsFor('sql'), DESTINATION_MAPPINGS);
assert.equal(mappingsFor(undefined), DESTINATION_MAPPINGS);
assert.equal(mappingsFor('JAVASCRIPT'), DESTINATION_MAPPINGS_JS, 'language is matched case-insensitively');
assert.ok(isJsLanguage('javascript') && !isJsLanguage('xml') && !isJsLanguage(null));

// Insert-time conversion.
assert.equal(mappingTextFor('${message.rawData}', 'javascript'), 'connectorMessage.getRawData()');
assert.equal(mappingTextFor('${message.rawData}', 'velocity'), '${message.rawData}');
assert.equal(mappingTextFor('${message.rawData}'), '${message.rawData}');
assert.equal(mappingTextFor('${COUNT}', 'javascript'), null, 'untranslatable mappings are not inserted');
// The other direction: a JavaScript token dragged onto a template or SQL field.
assert.equal(mappingTextFor('connectorMessage.getRawData()', 'sql'), '${message.rawData}');
assert.equal(mappingTextFor('connectorMessage.getRawData()', 'javascript'), 'connectorMessage.getRawData()');
assert.equal(mappingTextFor('var uuid = UUIDGenerator.getUUID();', 'velocity'), '${UUID}');
// Foreign text (script cheat-sheet, a drop from outside) is left alone.
assert.equal(mappingTextFor("$c('key')", 'javascript'), "$c('key')");
assert.equal(mappingTextFor('msg', 'javascript'), 'msg');
assert.equal(mappingTextFor('${custom.header}', 'javascript'), '${custom.header}');

// The script cheat-sheet is pure Rhino text, unchanged by the refactor.
assert.ok(SCRIPT_REFERENCE.every(([label, token]) => label && token && !token.includes('${')));

// Target language detection, shared by the rails and the code view.
const monacoTarget = (id) => ({ monaco: { getModel: () => ({ getLanguageId: () => id }) } });
assert.equal(mappingLanguageOf(monacoTarget('javascript')), 'javascript');
assert.equal(mappingLanguageOf(monacoTarget('sql')), 'sql');
assert.equal(mappingLanguageOf(monacoTarget('')), 'velocity', 'an empty model id falls back to Velocity');
assert.equal(mappingLanguageOf({ el: {} }), 'velocity', 'a text field is a connector template field');
// The Monaco-less fallback: the field is a plain textarea, so the language comes
// from the code editor root it lives in.
const inEditor = (lang) => ({ el: { closest: () => lang === null ? null : { getAttribute: () => lang } } });
assert.equal(mappingLanguageOf(inEditor('javascript')), 'javascript');
assert.equal(mappingLanguageOf(inEditor('sql')), 'sql');
assert.equal(mappingLanguageOf(inEditor(null)), 'velocity', 'no code editor root means a template field');
assert.equal(mappingLanguageOf(null), 'velocity');
assert.equal(mappingLanguageOf({ monaco: { getModel: () => { throw new Error('disposed'); } } }), 'velocity');
assert.equal(mappingTextFor('${channelId}', mappingLanguageOf(monacoTarget('javascript'))), 'channelId');

// The code-view rail rule: translate, then drop what the language cannot express.
// For a Rhino editor this must reproduce the JavaScript column exactly.
const railRows = (language) => DESTINATION_MAPPINGS
    .map(([label, token]) => [label, mappingTextFor(token, language)])
    .filter(([, text]) => text !== null);
assert.deepEqual(railRows('velocity'), DESTINATION_MAPPINGS);
assert.deepEqual(railRows('javascript'), DESTINATION_MAPPINGS_JS);

console.log('destination mapping language-form tests passed');

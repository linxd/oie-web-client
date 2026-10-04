import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

/*
 * The destination-mappings rail must insert what the TARGET understands.
 *
 * The classic Administrator shows one label list and keeps two insert forms
 * (VariableListHandler.TransferMode): Velocity tokens for template connectors,
 * Rhino expressions for JavaScript connectors. The web rail collapsed that into
 * the Velocity column for every field, so clicking 原始数据 inside a JavaScript
 * Writer produced `return ${message.transformedData};` — a syntax error the
 * engine swallows at deploy and only reports later as
 * "Script not found in cache (JavaScript Writer …)" at run time.
 *
 * Covered: the classic editor's rail on a Monaco JavaScript field, the same rail
 * on a SQL/template field (must stay Velocity), the rail following the
 * Use-JavaScript toggle the way Swing's per-connector transfer mode does, the
 * full-screen code view's variables rail (core/codeeditor.js), and the rail with
 * the Monaco-less fallback, where the field is a plain textarea and the language
 * can only come from the code editor root (data-lang).
 */

const RAIL = '.dest-mappings';
const RAW_VELOCITY = '${message.rawData}';
const RAW_JS = 'connectorMessage.getRawData()';
const COUNT_VELOCITY = '${COUNT}';
const CDATA = '<![CDATA[]]>';

const row = (token: string) => `${RAIL} [title="${token}"]`;

function caseOf(name: string) {
    const kase = CASES.find((c: any) => c.name === name);
    if (!kase) throw new Error(`missing connector fixture: ${name}`);
    return kase;
}

function destinationChannel(id: string, name: string) {
    const kase: any = caseOf(name);
    return makeChannel(id, { destination: { transportName: kase.name, properties: kase.properties() } });
}

/** Open the editor on the Destinations tab (one destination = pre-selected). */
async function openDestination(page: any, id: string, channel: any) {
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: /目的地|Destinations/ }).click();
    await expect(page.locator(RAIL)).toBeVisible();
}

/** The value of the connector panel's Monaco model in the given language. */
async function monacoValue(page: any, language: string) {
    return page.evaluate((lang: string) => {
        const model = (window as any).monaco.editor.getModels()
            .find((m: any) => m.getLanguageId() === lang);
        return model ? model.getValue() : null;
    }, language);
}

test('a JavaScript field switches the rail to the Rhino column and inserts Rhino text', async ({ page }) => {
    const id = 'rail-js-writer';
    await openDestination(page, id, destinationChannel(id, 'JavaScript Writer'));
    const editor = page.locator('.ce[data-lang="javascript"]');
    await expect(editor.first()).toBeVisible();
    await page.waitForSelector('.ce-monaco', { timeout: 15000 });

    // Nothing focused yet: the rail keeps the classic Velocity column.
    await expect(page.locator(row(RAW_VELOCITY))).toBeVisible();

    await editor.first().click();
    await expect(page.locator(row(RAW_JS))).toBeVisible();
    // The Velocity column is gone, and with it the rows that have no Rhino form.
    await expect(page.locator(row(RAW_VELOCITY))).toHaveCount(0);
    await expect(page.locator(row(COUNT_VELOCITY))).toHaveCount(0);
    await expect(page.locator(row(CDATA))).toHaveCount(0);

    await page.locator(row(RAW_JS)).click();
    const value = await monacoValue(page, 'javascript');
    expect(value).toContain(RAW_JS);
    expect(value).not.toContain('${');            // the bug: a Velocity token inside a script
});

test('a connector template field keeps the Velocity column', async ({ page }) => {
    const id = 'rail-sql-writer';
    await openDestination(page, id, destinationChannel(id, 'Database Writer'));
    // The Database Writer's statement is a SQL code field, which takes Velocity
    // replacements exactly like a raw output template.
    const editor = page.locator('.cform-code[data-fkey="query"] .ce[data-lang="sql"]');
    await expect(editor.first()).toBeVisible();
    await page.waitForSelector('.ce-monaco', { timeout: 15000 });

    await editor.first().click();
    await expect(page.locator(row(RAW_VELOCITY))).toBeVisible();
    await expect(page.locator(row(RAW_JS))).toHaveCount(0);

    await page.locator(row(RAW_VELOCITY)).click();
    expect(await monacoValue(page, 'sql')).toContain(RAW_VELOCITY);
});

test('the rail follows the Use-JavaScript toggle, like the classic transfer mode', async ({ page }) => {
    const id = 'rail-db-toggle';
    await openDestination(page, id, destinationChannel(id, 'Database Writer'));
    await page.waitForSelector('.ce-monaco', { timeout: 15000 });
    await expect(page.locator('.ce[data-lang="sql"]').first()).toBeVisible();

    await page.locator('[data-fkey="useScript"] label').filter({ hasText: '是' }).first().click();
    const editor = page.locator('.ce[data-lang="javascript"]');
    await expect(editor.first()).toBeVisible();
    await page.waitForSelector('.ce-monaco', { timeout: 15000 });
    await editor.first().click();
    await expect(page.locator(row(RAW_JS))).toBeVisible();
});

test('the code view rail lists and inserts the Rhino forms for a script field', async ({ page }) => {
    const id = 'rail-codeview';
    await openDestination(page, id, destinationChannel(id, 'JavaScript Writer'));
    const editor = page.locator('.ce[data-lang="javascript"]');
    await expect(editor.first()).toBeVisible();
    await page.waitForSelector('.ce-monaco', { timeout: 15000 });

    await editor.first().hover();
    await editor.first().locator('.ce-pop-btn').click({ force: true });
    const overlay = page.locator('.ce-popout-overlay');
    await expect(overlay).toHaveCount(1);

    const vars = overlay.locator('.ce-popout-var');
    const rawRow = vars.filter({ hasText: /^原始数据$/ });
    await expect(rawRow).toHaveAttribute('title', RAW_JS);
    await expect(overlay.locator(`.ce-popout-var[title="${RAW_VELOCITY}"]`)).toHaveCount(0);
    // Rows with no JavaScript form are not offered at all — inserting them would
    // break the script.
    await expect(overlay.locator(`.ce-popout-var[title="${COUNT_VELOCITY}"]`)).toHaveCount(0);
    await expect(overlay.locator(`.ce-popout-var[title="${CDATA}"]`)).toHaveCount(0);

    await rawRow.click();
    expect(await monacoValue(page, 'javascript')).toContain(RAW_JS);
});

test('with Monaco unavailable the plain textarea still gets the Rhino column', async ({ page }) => {
    // Air-gapped / blocked vendor bundle: the editor stays the baseline textarea,
    // so the language has to come from the code editor root (data-lang).
    await page.route('**/vendor/monaco/**', route => route.abort());
    const id = 'rail-fallback';
    await openDestination(page, id, destinationChannel(id, 'JavaScript Writer'));
    const editor = page.locator('.ce[data-lang="javascript"]');
    await expect(editor.first()).toBeVisible();

    await editor.first().locator('textarea').focus();
    await expect(page.locator(row(RAW_JS))).toBeVisible();

    await page.locator(row(RAW_JS)).click();
    // insertIntoField writes through the native value setter, so assert on the
    // live value (textContent would still show the initial script).
    await expect(editor.first().locator('textarea')).toHaveValue(/connectorMessage\.getRawData\(\)/);
    await expect(editor.first().locator('textarea')).not.toHaveValue(/\$\{/);
});

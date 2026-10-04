export type Mapping = [string, string];
/** The Velocity column — what template connectors (and any plain text field) take. */
export declare const DESTINATION_MAPPINGS: Mapping[];
/** The JavaScript column — what a Rhino editor (JavaScript Writer/Reader, database
 *  "Use JavaScript", response/postprocessor scripts) takes. */
export declare const DESTINATION_MAPPINGS_JS: Mapping[];
/** True for the editor languages that run Rhino (same set the script editors use). */
export declare function isJsLanguage(language?: string | null): boolean;
/**
 * The insert language of a resolved mapping target — `{ monaco }` for an editor,
 * `{ el }` for a text field. A Monaco editor answers with its model language
 * (javascript / sql / xml / text); the same field as a plain textarea cannot, so
 * a code editor stamps its language on the `.ce` root (`data-lang`); anything
 * outside a code editor is a connector template field, which takes Velocity.
 */
export declare function mappingLanguageOf(target?: any): string;
/**
 * The list to show beside an editor: the JavaScript column for a Rhino editor,
 * the Velocity column everywhere else (templates, SQL, plain text fields).
 */
export declare function mappingsFor(language?: string | null): Mapping[];
/**
 * Translate a rail token for the target editor's language — in both directions,
 * because a drag can start while the rail shows one column and land in an editor
 * of the other kind. Returns the token unchanged when it is not a known
 * destination mapping (the script cheat-sheet, hand-typed text, a drop from
 * another window), and null when the mapping has no form for that language —
 * callers must not insert those.
 */
export declare function mappingTextFor(token: string, language?: string | null): string | null;
export declare const SCRIPT_REFERENCE: Mapping[];

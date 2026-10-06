import { describe, expect, it } from "vitest";
import source from "./SourceControlDialog.tsx?raw";

/**
 * Guards the Source Control focus fix STRUCTURALLY.
 *
 * The reported symptom: every character typed in the commit box dropped focus.
 * The cause was that `Shell`, `Section`, and `FileRow` were defined INSIDE
 * `SourceControlDialog`'s body. React matches components by type identity, and a
 * function declared in a render body is a new type each render — so React
 * remounts that subtree, and `Shell` wrapped the whole dialog including the
 * commit textarea.
 *
 * WHY A SOURCE GUARD AND NOT A RENDERED FOCUS ASSERTION: a minimal jsdom repro
 * of the inline-component pattern did NOT reproduce the focus loss (React/jsdom
 * reused the node), so a rendered assertion would have looked stronger than it
 * was and could even pass with the bug present. The STRUCTURE is unambiguous and
 * checkable: these components must be declared at module scope.
 *
 * The behavioural test lives in SourceControlDialog.test.tsx, which types
 * character-by-character into the real commit box and asserts focus survives.
 */
describe("SourceControlDialog defines no components inside its render body", () => {
  const bodyStart = source.indexOf("export function SourceControlDialog(");
  const body = source.slice(bodyStart);

  it("declares Shell, Section and FileRow at MODULE scope", () => {
    for (const name of ["Shell", "Section", "FileRow"]) {
      // A top-level `function X(` declaration...
      expect(source).toMatch(new RegExp(`^function ${name}\\(`, "m"));
      // ...and NOT assigned inside the component body (`const X = ...`).
      expect(body).not.toMatch(new RegExp(`const ${name}\\s*=`));
    }
  });

  it("has no arrow-function component declared in the render body", () => {
    // The shape of the bug:
    //   const Foo = ({ ... }: T): React.JSX.Element => (...)
    //   const Foo = ({ ... }) => createPortal(...)
    const inlineComponent =
      /^\s{2}const [A-Z][A-Za-z0-9]* = \((?:[^)]|\n)*?\)\s*(?::[^=]+)?=>/m;
    expect(inlineComponent.test(body)).toBe(false);
  });

  it("still renders the hoisted Shell", () => {
    expect(body).toContain("<Shell>");
  });
});

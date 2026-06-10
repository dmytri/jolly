// Step-expression helper: match the literal step text from the .feature file.
//
// Cucumber treats plain strings as Cucumber Expressions, where `(`, `{`, and
// `/` have special meaning. Spec step text uses all of these, so step
// definitions register with `lit("<exact step text>")`, which compiles to an
// anchored RegExp. This keeps feature text and step definitions byte-for-byte
// traceable (feature 023 traceability rule).
export function lit(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`);
}

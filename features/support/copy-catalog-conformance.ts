// Structural conformance checker for Jolly's user-facing copy (feature
// user-facing-copy-from-catalog, @logic @property).
//
// Jolly's human-facing copy is human-owned material that lives in the
// `cliMessage` catalog (assets/messages/cli.json). This checker walks the
// implementation with ts-morph and reports every inline prose literal that
// reaches a user through the envelope prose surface instead of the catalog.
//
// Two surfaces, per the feature's "The envelope prose surface" Rule:
//   - The seven typed prose fields, keyed on each field's resolved TYPE and
//     never on its property name. Name-keying over-matches: the @clack prompt
//     options carry a `message` property that already renders through the
//     catalog. A literal counts when it is structurally one of these types even
//     where TypeScript infers the shape rather than declaring it, so a declared
//     contextual type is resolved first and a structural signature is the
//     fallback. `Envelope.summary` also reaches the envelope as
//     `errorEnvelope`'s second positional argument, so that argument is followed
//     too.
//   - The `cliMessage` call variables, which fill the catalog value's `{name}`
//     placeholders.
//
// Copy is followed to where it was authored. Prose handed along as a variable is
// still prose, so a value resolves through a local const to its initializer, and
// a shorthand property resolves to the variable behind it.
//
// DATA and COPY part company at a template, per the Rule. A template written AT
// a prose surface is authored copy carrying placeholders, so its text counts:
// prose never hides inside a template as a fragment. A template reached through
// a named intermediate is construction from run values — a store URL, a usage
// line — so its text is DATA and stays in code. A template a condition SELECTS
// is copy either way, because a word or phrase selected by a condition owes its
// own catalog key.
//
// This checker reads only the implementation directories (src/, bin/), so the
// verification layer's own pattern literals are never self-flagged.
import { Node, Project, SyntaxKind } from "ts-morph";
import { sharedProject } from "./ts-project.ts";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

/** An inline prose literal found at the envelope prose surface. */
export interface ProseLiteral {
  /** Repo-root-relative path of the file carrying the literal. */
  file: string;
  /** 1-based line number of the literal. */
  line: number;
  /** The prose surface it sits on, such as `Envelope.summary`. */
  field: string;
  /** The literal copy itself. */
  text: string;
}

/** An extra source injected for a planted-red proof: virtual, never on disk. */
export interface InjectedSource {
  file: string;
  text: string;
}

/**
 * The seven typed prose fields, keyed by owning TYPE then by property. Every
 * value here is copy Jolly prints, so each resolves through the catalog.
 */
const PROSE_FIELDS: Record<string, string[]> = {
  Envelope: ["summary"],
  Check: ["description", "remediation"],
  NextStep: ["description"],
  ErrorEntry: ["message", "remediation"],
  SkillSpec: ["description"],
};

/**
 * Structural signatures for the inferred case: the discriminating property set
 * that makes an object literal one of the prose-bearing types even where no
 * declared type reaches it. Ordered most specific first, so a SkillSpec is not
 * read as a bare NextStep.
 */
const STRUCTURAL: { type: string; required: string[] }[] = [
  { type: "Envelope", required: ["tool", "command", "status", "summary"] },
  { type: "SkillSpec", required: ["id", "ref", "description"] },
  { type: "ErrorEntry", required: ["code", "message"] },
  { type: "Check", required: ["id", "status"] },
  { type: "NextStep", required: ["description"] },
];

const CLI_MESSAGE = "cliMessage";
const ERROR_ENVELOPE = "errorEnvelope";
/** `errorEnvelope(command, summary, errors)` — summary is the second argument. */
const ERROR_ENVELOPE_SUMMARY_ARG = 1;
/** `cliMessage(key, vars)` — the variables are the second argument. */
const CLI_MESSAGE_VARS_ARG = 1;
const IMPLEMENTATION = ["src/", "bin/"];

/**
 * Copy is a word. A separator (`"; "`), a punctuation fragment (`": "`), and an
 * empty string carry no wording to own, so an alphabetic run of two or more
 * letters is what makes a literal prose.
 */
const PROSE = /[A-Za-z]{2,}/;

/** A cycle and deeply chained consts both stop here. */
const MAX_DEPTH = 8;

/**
 * The catalog resolver itself. Its refusal reports the failure to find an
 * entry, so no entry can render it: a key lookup for that sentence would be the
 * same lookup that just failed. The exemption is the one seam, not the file.
 */
const CATALOG_RESOLVER_FILE = "src/lib/messages.ts";
const CATALOG_RESOLVER_FUNCTION = "cliMessage";

/** Whether a throw sits inside the catalog resolver seam. */
function inCatalogResolver(statement: Node, file: string): boolean {
  if (file !== CATALOG_RESOLVER_FILE) return false;
  return statement
    .getAncestors()
    .some(
      (ancestor) =>
        Node.isFunctionDeclaration(ancestor) &&
        ancestor.getName() === CATALOG_RESOLVER_FUNCTION,
    );
}

function project(): Project {
  return sharedProject();
}

function repoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split("\\").join("/");
}

function propertyName(node: Node): string {
  return Node.isPropertyAssignment(node) ||
    Node.isShorthandPropertyAssignment(node)
    ? node.getName().replace(/^["']|["']$/g, "")
    : "";
}

/** A literal fragment of copy, paired with the node that carries it. */
interface Fragment {
  text: string;
  node: Node;
}

/** How a value was reached, which decides whether a template carries copy. */
interface Trace {
  /** A variable has been followed, so this value is a named intermediate. */
  followed: boolean;
  /** This value is selected by a condition. */
  conditional: boolean;
  depth: number;
}

const AT_SURFACE: Trace = { followed: false, conditional: false, depth: 0 };

/**
 * Every literal copy fragment an expression carries.
 *
 * A template's substitution expressions are read past: interpolated data is a
 * placeholder that stays in code, so only a template's own literal text is ever
 * considered. A call's return value is a run value, so a call is not walked
 * into.
 */
function fragments(node: Node, trace: Trace): Fragment[] {
  if (trace.depth > MAX_DEPTH) return [];
  const step = (child: Node, change: Partial<Trace> = {}): Fragment[] =>
    fragments(child, { ...trace, depth: trace.depth + 1, ...change });

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return [{ text: node.getLiteralValue(), node }];
  }
  if (Node.isTemplateExpression(node)) {
    // Construction reached through a named intermediate is DATA, not copy.
    if (trace.followed && !trace.conditional) return [];
    const texts = [node.getHead().getLiteralText()];
    for (const span of node.getTemplateSpans()) {
      texts.push(span.getLiteral().getLiteralText());
    }
    return texts.map((text) => ({ text, node }));
  }
  if (Node.isConditionalExpression(node)) {
    return [
      ...step(node.getWhenTrue(), { conditional: true }),
      ...step(node.getWhenFalse(), { conditional: true }),
    ];
  }
  if (Node.isBinaryExpression(node)) {
    return [...step(node.getLeft()), ...step(node.getRight())];
  }
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node)) {
    return step(node.getExpression());
  }
  if (Node.isIdentifier(node)) {
    // Only a variable's initializer is followed. A parameter, an import, and a
    // function carry run values, not copy authored at this site.
    const declaration = node.getSymbol()?.getValueDeclaration();
    if (declaration && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer) return step(initializer, { followed: true });
    }
  }
  return [];
}

/**
 * The literal copy fragments an object-literal member carries.
 *
 * A shorthand `{ stageWord }` names the property and the variable with one
 * identifier, and that identifier's own symbol is the PROPERTY. Resolving the
 * variable behind it takes the value symbol, so a shorthand carries copy as
 * faithfully as a longhand one.
 */
function memberFragments(member: Node): Fragment[] {
  if (Node.isPropertyAssignment(member)) {
    const initializer = member.getInitializer();
    return initializer ? fragments(initializer, AT_SURFACE) : [];
  }
  if (Node.isShorthandPropertyAssignment(member)) {
    const declaration = member.getValueSymbol()?.getValueDeclaration();
    if (declaration && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer) {
        return fragments(initializer, { ...AT_SURFACE, followed: true, depth: 1 });
      }
    }
  }
  return [];
}

/**
 * The name of the type that owns an object literal's property, resolved first
 * through the declared contextual type and then, where TypeScript only infers
 * the shape, through the structural signature. Keying on the resolved type is
 * what keeps the check off the @clack prompt options, whose `message` property
 * already renders through the catalog.
 */
function owningTypeName(
  objectLiteral: Node,
  property: string,
): string | undefined {
  if (!Node.isObjectLiteralExpression(objectLiteral)) return undefined;

  const contextual = objectLiteral.getContextualType();
  // A mapped type such as `Partial<Envelope>` keeps its property symbols
  // pointing at the original declaration, so the owning interface is reached
  // through the property rather than the type's own name.
  const declaration = contextual?.getProperty(property)?.getDeclarations()[0];
  const parent = declaration?.getParent();
  if (parent && Node.isInterfaceDeclaration(parent)) {
    const name = parent.getName();
    if (PROSE_FIELDS[name]) return name;
  }

  const names = objectLiteral
    .getProperties()
    .filter(
      (member) =>
        Node.isPropertyAssignment(member) ||
        Node.isShorthandPropertyAssignment(member),
    )
    .map((member) => propertyName(member));
  for (const signature of STRUCTURAL) {
    if (signature.required.every((key) => names.includes(key))) {
      return signature.type;
    }
  }
  return undefined;
}

function calleeName(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  return undefined;
}

/**
 * Every inline user-facing prose literal in the implementation: copy that
 * reaches a user through the envelope prose surface without resolving through
 * the message catalog.
 *
 * Pass `injected` to plant a violation for a planted-red proof; the injected
 * sources are virtual and are removed before returning.
 */
export function findInlineProseLiterals(
  injected: InjectedSource[] = [],
): ProseLiteral[] {
  const found: ProseLiteral[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    // A followed variable can be declared in another file, so a fragment is
    // reported at the site of the literal itself: that is where the copy is
    // authored and where it is replaced.
    const report = (fragment: Fragment, field: string): void => {
      if (!PROSE.test(fragment.text)) return;
      const site = repoRelative(fragment.node.getSourceFile().getFilePath());
      if (!IMPLEMENTATION.some((dir) => site.startsWith(dir))) return;
      found.push({
        file: site,
        line: fragment.node.getStartLineNumber(),
        field,
        text: fragment.text,
      });
    };

    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!IMPLEMENTATION.some((dir) => file.startsWith(dir))) continue;

      // The seven typed prose fields, reached as an object-literal property.
      for (const objectLiteral of source.getDescendantsOfKind(
        SyntaxKind.ObjectLiteralExpression,
      )) {
        for (const member of objectLiteral.getProperties()) {
          const name = propertyName(member);
          if (!name) continue;
          const owner = owningTypeName(objectLiteral, name);
          if (!owner || !PROSE_FIELDS[owner]?.includes(name)) continue;
          for (const fragment of memberFragments(member)) {
            report(fragment, `${owner}.${name}`);
          }
        }
      }

      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = calleeName(call);

        // `Envelope.summary` also reaches the envelope as errorEnvelope's second
        // positional argument; a check walking only property assignments misses
        // it.
        if (callee === ERROR_ENVELOPE) {
          const summary = call.getArguments()[ERROR_ENVELOPE_SUMMARY_ARG];
          if (summary) {
            for (const fragment of fragments(summary, AT_SURFACE)) {
              report(fragment, "Envelope.summary");
            }
          }
        }

        // The cliMessage variables: prose handed to the renderer as a
        // placeholder value is still prose.
        if (callee === CLI_MESSAGE) {
          const vars = call.getArguments()[CLI_MESSAGE_VARS_ARG];
          if (vars && Node.isObjectLiteralExpression(vars)) {
            for (const member of vars.getProperties()) {
              const name = propertyName(member);
              if (!name) continue;
              for (const fragment of memberFragments(member)) {
                report(fragment, `cliMessage variable "${name}"`);
              }
            }
          }
        }
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return found;
}

// ─── The key join (feature user-facing-copy-from-catalog) ────────────────────
//
// The join between code and catalog is total in both directions: a referenced
// key the catalog lacks would ship the word "undefined" as prose, and a catalog
// entry no site references is dead copy that drifts unread.

/** A `cliMessage` key reference in the implementation. */
export interface KeyReference {
  /** Repo-root-relative path of the referencing site. */
  file: string;
  /** 1-based line number of the reference. */
  line: number;
  /** The referenced key, or the expression text where the key is not a literal. */
  key: string;
}

/** Both directions of the code-to-catalog join. */
export interface CatalogJoin {
  /** References whose key resolves to no catalog entry. */
  unresolved: KeyReference[];
  /** Catalog entries no site references. */
  unreferenced: string[];
}

const CLI_CATALOG_PATH = join(REPO_ROOT, "assets", "messages", "cli.json");

/**
 * The literal keys a `cliMessage` key argument statically resolves to. A key
 * selected by a condition references BOTH branch keys, so each branch is
 * followed. Undefined means the expression carries no statically readable key.
 */
function literalKeys(node: Node): string[] | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return [node.getLiteralValue()];
  }
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node)) {
    return literalKeys(node.getExpression());
  }
  if (Node.isConditionalExpression(node)) {
    const whenTrue = literalKeys(node.getWhenTrue());
    const whenFalse = literalKeys(node.getWhenFalse());
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  return undefined;
}

/**
 * Join every `cliMessage` key referenced in the implementation directories
 * against the catalog entries, in both directions.
 *
 * Pass `injected` to plant a referencing site, and `injectedEntries` to plant a
 * catalog entry, for the planted-red proofs; both are virtual and never on disk.
 * A non-literal key expression cannot be joined statically, so it is reported
 * as unresolved: a key the check cannot read is a key nobody proved resolves.
 */
export function joinCliMessageKeys(
  injected: InjectedSource[] = [],
  injectedEntries: Record<string, string> = {},
): CatalogJoin {
  const catalog: Record<string, string> = {
    ...(JSON.parse(readFileSync(CLI_CATALOG_PATH, "utf8")) as Record<string, string>),
    ...injectedEntries,
  };
  const referenced = new Set<string>();
  const unresolved: KeyReference[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!IMPLEMENTATION.some((dir) => file.startsWith(dir))) continue;
      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (calleeName(call) !== CLI_MESSAGE) continue;
        const keyArgument = call.getArguments()[0];
        if (!keyArgument) continue;
        const line = keyArgument.getStartLineNumber();
        // A key the check cannot read is a key nobody proved resolves.
        const keys = literalKeys(keyArgument) ?? [keyArgument.getText()];
        for (const key of keys) {
          referenced.add(key);
          if (!(key in catalog)) unresolved.push({ file, line, key });
        }
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  const unreferenced = Object.keys(catalog).filter((key) => !referenced.has(key));
  return { unresolved, unreferenced };
}

/** A user-facing sentence authored at a throw site rather than in the catalog. */
export interface ThrowSiteProse {
  /** Repo-root-relative path of the file carrying the throw. */
  file: string;
  /** 1-based line number of the authored sentence. */
  line: number;
  /** The sentence as authored, with interpolations shown as `${...}`. */
  text: string;
}

/**
 * Every user-facing sentence authored at a throw site in the implementation.
 *
 * An error's message reaches the human through the envelope's error entry, but
 * the envelope assigns it from a property access on the caught error, so the
 * prose-surface checker's value-follow stops one hop short and the sentence
 * passes unchecked. This checker starts at the throw instead: the message
 * argument of a thrown error is copy, so it owes a catalog key exactly as any
 * other prose surface does. A message that resolves through `cliMessage`
 * carries its key; a string literal or template authored at the site does not.
 *
 * Interpolated data such as a host name or a status code is not copy, so a
 * template's interpolations are left in place and only its surrounding wording
 * decides whether the site authored a sentence.
 *
 * Pass `injected` to plant a violation for a planted-red proof; the injected
 * sources are virtual and are removed before returning.
 */
export function findThrowSiteProse(
  injected: InjectedSource[] = [],
): ThrowSiteProse[] {
  const found: ThrowSiteProse[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!IMPLEMENTATION.some((dir) => file.startsWith(dir))) continue;

      for (const statement of source.getDescendantsOfKind(
        SyntaxKind.ThrowStatement,
      )) {
        if (inCatalogResolver(statement, file)) continue;
        const thrown = statement.getExpression();
        if (!Node.isNewExpression(thrown)) continue;
        const message = thrown.getArguments()[0];
        if (!message) continue;
        const authored = authoredSentence(message, 0);
        if (!authored) continue;
        if (!PROSE.test(authored.text)) continue;
        const site = repoRelative(authored.node.getSourceFile().getFilePath());
        if (!IMPLEMENTATION.some((dir) => site.startsWith(dir))) continue;
        found.push({
          file: site,
          line: authored.node.getStartLineNumber(),
          text: authored.text,
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return found;
}

/**
 * The sentence a throw site's message argument authors, or undefined when the
 * message resolves through the catalog or carries no authored wording. Copy
 * handed along as a variable is still authored copy, so a local const is
 * followed to its initializer.
 */
function authoredSentence(node: Node, depth: number): Fragment | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return { text: node.getLiteralText(), node };
  }
  if (Node.isTemplateExpression(node)) {
    // The interpolations are data; the surrounding wording is the copy.
    return { text: node.getText().slice(1, -1), node };
  }
  // A sentence split across `+` operands is still one authored sentence, so
  // both sides are followed and their wording joined. Splitting copy across
  // operands would otherwise hide it from a check that reads only literals.
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.PlusToken
  ) {
    const left = authoredSentence(node.getLeft(), depth + 1);
    const right = authoredSentence(node.getRight(), depth + 1);
    if (!left && !right) return undefined;
    return { text: `${left?.text ?? ""}${right?.text ?? ""}`, node };
  }
  // A call authors no sentence at this site: a `cliMessage` lookup carries its
  // key, and any other call constructs its value from run data.
  if (Node.isCallExpression(node)) return undefined;
  if (Node.isIdentifier(node)) {
    const declaration = node
      .getSymbol()
      ?.getDeclarations()
      .find((entry) => Node.isVariableDeclaration(entry));
    if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
    const initializer = declaration.getInitializer();
    return initializer ? authoredSentence(initializer, depth + 1) : undefined;
  }
  return undefined;
}

// ─── The completion surface's copy ──────────────────────────────────────────
//
// Two sentences reach the human without touching the envelope prose surface or
// a throw site, so neither existing checker sees them. `COMMANDS` in
// `src/lib/completion.ts` pairs each command name with an English description
// the shell prints beside the candidates it offers, and the
// `jolly completion --help` usage text is written straight to stdout, reaching
// no envelope field and no throw.
//
// The launcher `bin/jolly` is the one exempt site: it runs its Node version
// guard before `dist/index.js` loads, so it cannot reach the catalog at all and
// its sentence stays inline.

/** The declaration pairing each completed command with its description. */
const COMPLETION_COMMANDS = "COMMANDS";

/** The launcher, which runs before the catalog is reachable. */
const LAUNCHER_FILE = "bin/jolly";

/** A sentence the completion surface writes without resolving through the catalog. */
export interface CompletionCopy {
  /** Repo-root-relative path of the file carrying the sentence. */
  file: string;
  /** 1-based line number of the sentence. */
  line: number;
  /** The site it sits on, such as `completion command "help"`. */
  site: string;
  /** The sentence as authored. */
  text: string;
}

/** Whether a call writes directly to a standard stream. */
function streamWrite(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return false;
  const target = expression.getExpression().getText();
  const member = expression.getName();
  if (target === "process.stdout" || target === "process.stderr") {
    return member === "write";
  }
  if (target === "console") {
    return member === "log" || member === "error" || member === "warn";
  }
  return false;
}

/**
 * Every sentence the completion surface writes without resolving through the
 * catalog: a command description authored as a literal, and a sentence written
 * directly to a standard stream.
 *
 * Pass `injected` to plant a violation for a planted-red proof; the injected
 * sources are virtual and are removed before returning.
 */
export function findCompletionCopy(injected: InjectedSource[] = []): CompletionCopy[] {
  const found: CompletionCopy[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!IMPLEMENTATION.some((dir) => file.startsWith(dir))) continue;
      // The launcher cannot reach the catalog, so its sentence stays inline.
      if (file === LAUNCHER_FILE) continue;

      // The completion command descriptions: `[name, description]` tuples.
      const commands = source.getVariableDeclaration(COMPLETION_COMMANDS)?.getInitializer();
      const tuples = commands ? unwrapValue(commands) : undefined;
      if (tuples && Node.isArrayLiteralExpression(tuples)) {
        for (const element of tuples.getElements()) {
          const tuple = unwrapValue(element);
          if (!Node.isArrayLiteralExpression(tuple)) continue;
          const [nameNode, descriptionNode] = tuple.getElements();
          if (!nameNode || !descriptionNode) continue;
          const name =
            Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode)
              ? nameNode.getLiteralText()
              : nameNode.getText();
          const authored = authoredSentence(descriptionNode, 0);
          if (!authored || !PROSE.test(authored.text)) continue;
          found.push({
            file,
            line: authored.node.getStartLineNumber(),
            site: `completion command "${name}"`,
            text: authored.text,
          });
        }
      }

      // Sentences written straight to a standard stream.
      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (!streamWrite(call)) continue;
        const argument = call.getArguments()[0];
        if (!argument) continue;
        const authored = authoredSentence(argument, 0);
        if (!authored || !PROSE.test(authored.text)) continue;
        found.push({
          file,
          line: authored.node.getStartLineNumber(),
          site: `${call.getExpression().getText()} argument`,
          text: authored.text,
        });
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return found;
}

/** Strip `as const` and parentheses so the underlying literal is reached. */
function unwrapValue(node: Node): Node {
  let current = node;
  while (Node.isAsExpression(current) || Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

// ─── The risk-context prose fields ──────────────────────────────────────────
//
// Feature 021's `riskContext` carries three prose fields the envelope prose
// checker does not reach: `action`, `target`, and each entry of `sideEffects`.
// They are full English clauses, and they reach the human twice over: the
// interactive plan preview renders `action` on stderr, and every field ships
// inside the envelope `data` an agent reads.
//
// The literal is authored in the plan builder and in the risk-context helper,
// not at the field the envelope carries, so the same one-hop-short follow that
// hides throw-site prose hides these.

/** The property names that make an object literal a risk context. */
const RISK_CONTEXT_SIGNATURE = [
  "action",
  "target",
  "riskLevel",
  "categories",
  "reversible",
  "sideEffects",
];

/** The two scalar prose fields a risk context carries. */
const RISK_CONTEXT_PROSE = ["action", "target"];

/** The list-valued prose field a risk context carries. */
const RISK_CONTEXT_SIDE_EFFECTS = "sideEffects";

/**
 * Whether an object literal is a risk context, read structurally: `RiskContext`
 * values are authored as plain object literals in plan data, so the shape is
 * what identifies them and a plant needs no import to be one.
 */
function isRiskContext(objectLiteral: Node): boolean {
  if (!Node.isObjectLiteralExpression(objectLiteral)) return false;
  const names = objectLiteral
    .getProperties()
    .filter(
      (member) =>
        Node.isPropertyAssignment(member) || Node.isShorthandPropertyAssignment(member),
    )
    .map((member) => propertyName(member));
  return RISK_CONTEXT_SIGNATURE.every((key) => names.includes(key));
}

/**
 * Every risk-context prose clause authored in the implementation instead of
 * resolving through the catalog: the `action` and `target` fields, and each
 * entry of `sideEffects`.
 *
 * Pass `injected` to plant a violation for a planted-red proof; the injected
 * sources are virtual and are removed before returning.
 */
export function findRiskContextProse(injected: InjectedSource[] = []): ProseLiteral[] {
  const found: ProseLiteral[] = [];
  const added = injected.map((source) =>
    project().createSourceFile(join(REPO_ROOT, source.file), source.text, {
      overwrite: true,
    }),
  );
  try {
    const report = (fragment: Fragment, field: string): void => {
      if (!PROSE.test(fragment.text)) return;
      const site = repoRelative(fragment.node.getSourceFile().getFilePath());
      if (!IMPLEMENTATION.some((dir) => site.startsWith(dir))) return;
      found.push({
        file: site,
        line: fragment.node.getStartLineNumber(),
        field,
        text: fragment.text,
      });
    };

    for (const source of project().getSourceFiles()) {
      const file = repoRelative(source.getFilePath());
      if (!IMPLEMENTATION.some((dir) => file.startsWith(dir))) continue;

      for (const objectLiteral of source.getDescendantsOfKind(
        SyntaxKind.ObjectLiteralExpression,
      )) {
        if (!isRiskContext(objectLiteral)) continue;
        for (const member of objectLiteral.getProperties()) {
          const name = propertyName(member);
          if (!name) continue;
          if (RISK_CONTEXT_PROSE.includes(name)) {
            for (const fragment of memberFragments(member)) {
              report(fragment, `riskContext.${name}`);
            }
            continue;
          }
          if (name !== RISK_CONTEXT_SIDE_EFFECTS) continue;
          if (!Node.isPropertyAssignment(member)) continue;
          const initializer = member.getInitializer();
          if (!initializer) continue;
          const list = unwrapValue(initializer);
          if (!Node.isArrayLiteralExpression(list)) continue;
          for (const entry of list.getElements()) {
            for (const fragment of fragments(entry, AT_SURFACE)) {
              report(fragment, "riskContext.sideEffects entry");
            }
          }
        }
      }
    }
  } finally {
    for (const source of added) project().removeSourceFile(source);
  }
  return found;
}

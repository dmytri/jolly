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

let cachedProject: Project | undefined;

function project(): Project {
  cachedProject ??= new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
  });
  return cachedProject;
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

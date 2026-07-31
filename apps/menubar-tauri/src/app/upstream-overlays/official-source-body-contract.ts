import { createHash } from "node:crypto";

import ts from "typescript";

export type ExactMemberTransformOperation =
  | {
      readonly kind: "replace";
      readonly search: string;
      readonly replacement: string;
    }
  | {
      readonly kind: "remove";
      readonly search: string;
    };

export type OfficialMemberTransform = {
  readonly authorityMember: string;
  readonly runtimeMember: string;
  readonly operations: readonly ExactMemberTransformOperation[];
  readonly retainedAuthorityFragments: readonly string[];
  readonly retainedAuthorityStatements: readonly {
    readonly index: number;
    readonly source: string;
  }[];
  readonly allowUnchanged?: boolean;
  readonly allowNoRetainedStatement?: boolean;
};

export type PinnedMemberTransformContract = {
  readonly authorityClass: string;
  readonly authoritySha256: string;
  readonly runtimeClass: string;
  readonly transforms: readonly OfficialMemberTransform[];
  readonly enforceCompleteRuntimeMembers?: boolean;
  readonly runtimeOnlyMembers?: readonly RuntimeOnlyMemberContract[];
};

export type RuntimeOnlyMemberContract = {
  readonly runtimeMember: string;
  readonly justification: string;
  readonly canonicalSha256: string;
};

type ClassMembers = ReadonlyMap<string, readonly string[]>;

function classMemberName(
  member: ts.ClassElement,
  source: ts.SourceFile,
): string | null {
  if (ts.isConstructorDeclaration(member)) {
    return "constructor";
  }
  const name = member.name?.getText(source);
  if (!name) {
    return null;
  }
  if (ts.isGetAccessorDeclaration(member)) {
    return `${name}:get`;
  }
  if (ts.isSetAccessorDeclaration(member)) {
    return `${name}:set`;
  }
  return name;
}

function canonicalMember(
  member: ts.ClassElement,
  source: ts.SourceFile,
  printer: ts.Printer,
): string | null {
  let skeleton: ts.ClassElement;
  let statements: readonly ts.Statement[] = [];
  let propertyInitializer: ts.Expression | undefined;

  if (ts.isMethodDeclaration(member) && member.body) {
    skeleton = ts.factory.updateMethodDeclaration(
      member,
      member.modifiers,
      member.asteriskToken,
      member.name,
      member.questionToken,
      member.typeParameters,
      member.parameters,
      member.type,
      ts.factory.createBlock([], true),
    );
    statements = member.body.statements;
  } else if (ts.isConstructorDeclaration(member) && member.body) {
    skeleton = ts.factory.updateConstructorDeclaration(
      member,
      member.modifiers,
      member.parameters,
      ts.factory.createBlock([], true),
    );
    statements = member.body.statements;
  } else if (ts.isGetAccessorDeclaration(member) && member.body) {
    skeleton = ts.factory.updateGetAccessorDeclaration(
      member,
      member.modifiers,
      member.name,
      member.parameters,
      member.type,
      ts.factory.createBlock([], true),
    );
    statements = member.body.statements;
  } else if (ts.isSetAccessorDeclaration(member) && member.body) {
    skeleton = ts.factory.updateSetAccessorDeclaration(
      member,
      member.modifiers,
      member.name,
      member.parameters,
      ts.factory.createBlock([], true),
    );
    statements = member.body.statements;
  } else if (
    ts.isPropertyDeclaration(member) &&
    member.initializer &&
    ts.isArrowFunction(member.initializer) &&
    ts.isBlock(member.initializer.body)
  ) {
    const initializer = ts.factory.updateArrowFunction(
      member.initializer,
      member.initializer.modifiers,
      member.initializer.typeParameters,
      member.initializer.parameters,
      member.initializer.type,
      member.initializer.equalsGreaterThanToken,
      ts.factory.createBlock([], true),
    );
    skeleton = ts.factory.updatePropertyDeclaration(
      member,
      member.modifiers,
      member.name,
      member.questionToken ?? member.exclamationToken,
      member.type,
      initializer,
    );
    statements = member.initializer.body.statements;
  } else if (ts.isPropertyDeclaration(member) && member.initializer) {
    skeleton = ts.factory.updatePropertyDeclaration(
      member,
      member.modifiers,
      member.name,
      member.questionToken ?? member.exclamationToken,
      member.type,
      undefined,
    );
    propertyInitializer = member.initializer;
  } else if (
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member) ||
    ts.isPropertyDeclaration(member)
  ) {
    skeleton = member;
  } else {
    return null;
  }

  const parts = [
    "[[member-skeleton]]",
    printer.printNode(ts.EmitHint.Unspecified, skeleton, source),
    "[[/member-skeleton]]",
  ];
  if (propertyInitializer) {
    parts.push(
      "[[initializer]]",
      canonicalExpression(propertyInitializer, source, printer),
      "[[/initializer]]",
    );
  }
  statements.forEach((statement, index) => {
    parts.push(
      `[[statement:${index}]]`,
      canonicalStatement(statement, source, printer),
      `[[/statement:${index}]]`,
    );
  });
  parts.push("[[end-member]]");
  return parts.join("\n");
}

function canonicalExpression(
  expression: ts.Expression,
  source: ts.SourceFile,
  printer: ts.Printer,
): string {
  const isolatedSource = ts.createSourceFile(
    "guarded-expression.ts",
    `const guardedExpression = ${expression.getText(source)};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = isolatedSource.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) {
    throw new Error(
      "Guarded property initializer did not reparse exactly once",
    );
  }
  const initializer = statement.declarationList.declarations[0]?.initializer;
  if (!initializer) {
    throw new Error("Guarded property initializer is missing");
  }
  return printer.printNode(ts.EmitHint.Expression, initializer, isolatedSource);
}

function canonicalStatement(
  statement: ts.Statement,
  source: ts.SourceFile,
  printer: ts.Printer,
): string {
  const isolatedSource = ts.createSourceFile(
    "guarded-statement.ts",
    statement.getText(source),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (isolatedSource.statements.length !== 1) {
    throw new Error("Guarded top-level statement did not reparse exactly once");
  }
  return printer.printNode(
    ts.EmitHint.Unspecified,
    isolatedSource.statements[0],
    isolatedSource,
  );
}

function normalizedClassMembers(
  sourceText: string,
  className: string,
): ClassMembers {
  const source = ts.createSourceFile(
    className,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  if (!declaration) {
    throw new Error(`Missing guarded class ${className}`);
  }

  const printer = ts.createPrinter({
    removeComments: true,
    newLine: ts.NewLineKind.LineFeed,
  });
  const members = new Map<string, string[]>();
  for (const member of declaration.members) {
    const name = classMemberName(member, source);
    if (!name) {
      continue;
    }
    const normalized = canonicalMember(member, source, printer);
    if (normalized === null) {
      continue;
    }
    members.set(name, [...(members.get(name) ?? []), normalized]);
  }
  return members;
}

function uniqueMember(
  members: ClassMembers,
  className: string,
  memberName: string,
): string {
  const matches = members.get(memberName) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `${className}.${memberName} must resolve exactly once; received ${matches.length}`,
    );
  }
  return matches[0];
}

export function canonicalMemberFromSource(
  sourceText: string,
  className: string,
  memberName: string,
): string {
  return uniqueMember(
    normalizedClassMembers(sourceText, className),
    className,
    memberName,
  );
}

function occurrenceCount(source: string, search: string): number {
  if (search.length === 0) {
    return 0;
  }
  return source.split(search).length - 1;
}

function retainedStatementToken(index: number, source: string): string {
  return `[[statement:${index}]]\n${source}\n[[/statement:${index}]]`;
}

function assertMeaningfulStatement(source: string, label: string): void {
  const parsed = ts.createSourceFile(
    "retained-statement.ts",
    `function retainedAuthorityStatement() {\n${source}\n}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = parsed.statements[0];
  if (
    !declaration ||
    !ts.isFunctionDeclaration(declaration) ||
    !declaration.body ||
    declaration.body.statements.length !== 1 ||
    ts.isEmptyStatement(declaration.body.statements[0])
  ) {
    throw new Error(
      `${label} retained authority statement is not one meaningful statement`,
    );
  }
}

function applyOperationExactlyOnce(
  source: string,
  operation: ExactMemberTransformOperation,
  actualRuntimeMember: string,
  retainedAuthorityFragments: readonly string[],
  retainedAuthorityStatements: readonly string[],
  label: string,
  index: number,
): string {
  if (operation.search.length === 0) {
    throw new Error(`${label} operation ${index + 1} has an empty search`);
  }
  if (operation.search === source) {
    throw new Error(
      `${label} operation ${index + 1} cannot replace the whole member`,
    );
  }

  const replacement = operation.kind === "replace" ? operation.replacement : "";
  if (replacement === actualRuntimeMember) {
    throw new Error(
      `${label} operation ${index + 1} cannot inject the whole runtime member`,
    );
  }

  const matches = occurrenceCount(source, operation.search);
  if (matches !== 1) {
    throw new Error(
      `${label} operation ${index + 1} must match exactly once; received ${matches}`,
    );
  }
  const operationStart = source.indexOf(operation.search);
  const operationEnd = operationStart + operation.search.length;
  for (const fragment of [
    ...retainedAuthorityFragments,
    ...retainedAuthorityStatements,
  ]) {
    const fragmentStart = source.indexOf(fragment);
    const fragmentEnd = fragmentStart + fragment.length;
    if (
      fragmentStart >= 0 &&
      operationStart < fragmentEnd &&
      fragmentStart < operationEnd
    ) {
      throw new Error(
        `${label} operation ${index + 1} overlaps retained official structure`,
      );
    }
  }
  return source.replace(operation.search, replacement);
}

function assertRetainedAuthorityStatements(
  authorityMember: string,
  transformedMember: string,
  transform: OfficialMemberTransform,
  label: string,
): string[] {
  if (
    !transform.retainedAuthorityStatements ||
    transform.retainedAuthorityStatements.length === 0
  ) {
    if (
      transform.allowUnchanged ||
      transform.allowNoRetainedStatement ||
      authorityMember.includes("[[initializer]]")
    ) {
      return [];
    }
    throw new Error(
      `${label} must retain at least one unchanged top-level authority statement`,
    );
  }

  const tokens = transform.retainedAuthorityStatements.map(
    ({ index, source }) => {
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(
          `${label} retained authority statement index is invalid`,
        );
      }
      assertMeaningfulStatement(source, label);
      const token = retainedStatementToken(index, source);
      if (occurrenceCount(authorityMember, token) !== 1) {
        throw new Error(
          `${label} retained authority statement ${index} does not match pinned authority`,
        );
      }
      if (occurrenceCount(transformedMember, token) !== 1) {
        throw new Error(
          `${label} retained authority statement ${index} must survive exactly unchanged`,
        );
      }
      return token;
    },
  );

  if (new Set(tokens).size !== tokens.length) {
    throw new Error(
      `${label} retained authority statement identity is duplicated`,
    );
  }
  return tokens;
}

function assertRetainedAuthorityFragments(
  authorityMember: string,
  transformedMember: string,
  transform: OfficialMemberTransform,
  label: string,
): void {
  if (transform.retainedAuthorityFragments.length === 0) {
    throw new Error(
      `${label} must declare a retained official skeleton or statement`,
    );
  }
  for (const fragment of transform.retainedAuthorityFragments) {
    if (fragment.trim().length < 8) {
      throw new Error(
        `${label} retained fragment is too weak: ${JSON.stringify(fragment)}`,
      );
    }
    const authorityMatches = occurrenceCount(authorityMember, fragment);
    if (authorityMatches !== 1) {
      throw new Error(
        `${label} retained fragment must occur once in pinned authority; received ${authorityMatches}`,
      );
    }
    const transformedMatches = occurrenceCount(transformedMember, fragment);
    if (transformedMatches !== 1) {
      throw new Error(
        `${label} retained fragment must survive once; received ${transformedMatches}`,
      );
    }
  }
}

export function validatePinnedMemberTransforms(
  authoritySource: string,
  runtimeSource: string,
  contract: PinnedMemberTransformContract,
): string[] {
  const authorityHash = createHash("sha256")
    .update(authoritySource)
    .digest("hex");
  if (authorityHash !== contract.authoritySha256) {
    return [`${contract.authorityClass} pinned authority drift`];
  }

  try {
    const authorityMembers = normalizedClassMembers(
      authoritySource,
      contract.authorityClass,
    );
    const runtimeMembers = normalizedClassMembers(
      runtimeSource,
      contract.runtimeClass,
    );
    const authorityNames = new Set<string>();
    const runtimeNames = new Set<string>();

    const failures = contract.transforms.flatMap((transform) => {
      if (authorityNames.has(transform.authorityMember)) {
        return [
          `${contract.authorityClass}.${transform.authorityMember} transform is ambiguous`,
        ];
      }
      if (runtimeNames.has(transform.runtimeMember)) {
        return [
          `${contract.runtimeClass}.${transform.runtimeMember} transform is ambiguous`,
        ];
      }
      authorityNames.add(transform.authorityMember);
      runtimeNames.add(transform.runtimeMember);

      const authority = uniqueMember(
        authorityMembers,
        contract.authorityClass,
        transform.authorityMember,
      );
      const actual = uniqueMember(
        runtimeMembers,
        contract.runtimeClass,
        transform.runtimeMember,
      );
      if (transform.operations.length === 0 && !transform.allowUnchanged) {
        return [
          `${contract.authorityClass}.${transform.authorityMember} has no explicit transforms`,
        ];
      }

      const label = `${contract.authorityClass}.${transform.authorityMember}`;
      const retainedStatements = assertRetainedAuthorityStatements(
        authority,
        authority,
        transform,
        label,
      );
      const expected = transform.operations.reduce(
        (source, operation, index) =>
          applyOperationExactlyOnce(
            source,
            operation,
            actual,
            transform.retainedAuthorityFragments,
            retainedStatements,
            label,
            index,
          ),
        authority,
      );
      assertRetainedAuthorityFragments(authority, expected, transform, label);
      assertRetainedAuthorityStatements(authority, expected, transform, label);
      return expected === actual
        ? []
        : [
            `${contract.runtimeClass}.${transform.runtimeMember} derived body mismatch`,
          ];
    });

    if (failures.length > 0) {
      return failures;
    }

    for (const runtimeOnly of contract.runtimeOnlyMembers ?? []) {
      if (runtimeNames.has(runtimeOnly.runtimeMember)) {
        return [
          `${contract.runtimeClass}.${runtimeOnly.runtimeMember} runtime member contract is ambiguous`,
        ];
      }
      if (runtimeOnly.justification.trim().length < 16) {
        return [
          `${contract.runtimeClass}.${runtimeOnly.runtimeMember} runtime-only justification is missing`,
        ];
      }

      const actual = uniqueMember(
        runtimeMembers,
        contract.runtimeClass,
        runtimeOnly.runtimeMember,
      );
      const actualHash = createHash("sha256").update(actual).digest("hex");
      if (actualHash !== runtimeOnly.canonicalSha256) {
        return [
          `${contract.runtimeClass}.${runtimeOnly.runtimeMember} runtime-only member drift`,
        ];
      }
      runtimeNames.add(runtimeOnly.runtimeMember);
    }

    if (!contract.enforceCompleteRuntimeMembers) {
      return [];
    }

    for (const [name, members] of runtimeMembers) {
      if (members.length !== 1) {
        return [
          `${contract.runtimeClass}.${name} must resolve exactly once; received ${members.length}`,
        ];
      }
      if (!runtimeNames.has(name)) {
        return [
          `${contract.runtimeClass}.${name} is an unlisted runtime member`,
        ];
      }
    }

    return [];
  } catch (error) {
    return [
      error instanceof Error
        ? error.message
        : "Official member transform failed",
    ];
  }
}

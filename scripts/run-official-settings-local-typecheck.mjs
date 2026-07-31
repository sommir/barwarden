import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  NgtscProgram,
  createCompilerHost,
  formatDiagnostics,
  readConfiguration,
} from "@angular/compiler-cli";
import ts from "typescript";

const root = process.cwd();
const project = resolve(
  root,
  process.argv[2] ?? "apps/menubar-tauri/tsconfig.official-settings.json",
);
const configuration = readConfiguration(project);
const host = createCompilerHost({ options: configuration.options });
const program = new NgtscProgram(
  configuration.rootNames,
  configuration.options,
  host,
);

await program.loadNgStructureAsync();

const diagnostics = [
  ...configuration.errors,
  ...program.getTsOptionDiagnostics(),
  ...program.getNgOptionDiagnostics(),
  ...program.getTsSyntacticDiagnostics(),
  ...program.getTsSemanticDiagnostics(),
  ...program.getNgStructuralDiagnostics(),
  ...program.getNgSemanticDiagnostics(),
];
const ownedFiles = new Set(configuration.rootNames.map((file) => resolve(file)));
for (const file of configuration.rootNames) {
  if (!file.endsWith(".component.ts")) continue;
  const template = resolve(file.replace(/\.ts$/, ".html"));
  if (existsSync(template)) ownedFiles.add(template);
}
const ownedDiagnostics = uniqueDiagnostics(diagnostics).filter((diagnostic) =>
  diagnostic.category === ts.DiagnosticCategory.Error
  && (!diagnostic.file || ownedFiles.has(resolve(diagnostic.file.fileName))));

if (ownedDiagnostics.length > 0) {
  process.stderr.write(formatDiagnostics(ownedDiagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }));
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Settings local Angular typecheck passed: ${configuration.rootNames.length} strict roots and templates\n`,
  );
}

function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.file?.fileName ?? "",
      diagnostic.start ?? "",
      diagnostic.code,
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

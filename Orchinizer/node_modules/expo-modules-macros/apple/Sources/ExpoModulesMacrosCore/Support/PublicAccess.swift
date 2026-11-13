import SwiftDiagnostics
import SwiftSyntax
import SwiftSyntaxMacros

/// Warns when a class that autolinking exports isn't `public` or `open`. Autolinking generates the modules
/// provider in the app target, so it can reference only public classes of other modules. The warning has a
/// fix-it that makes the class `public`. A local class is skipped, because it can't have an access modifier.
internal func diagnoseNonPublicClass(
  _ classDecl: ClassDeclSyntax,
  macroName: String,
  reason: String,
  idPrefix: String,
  in context: some MacroExpansionContext
) {
  guard !isLocal(context: context) else {
    return
  }
  let accessModifier = classDecl.modifiers.first { accessLevelKeywords.contains($0.name.tokenKind) }
  if let accessModifier,
    [.keyword(.public), .keyword(.open)].contains(accessModifier.name.tokenKind)
  {
    return
  }
  let name = classDecl.name.text
  context.diagnose(
    Diagnostic(
      node: accessModifier.map(Syntax.init) ?? Syntax(classDecl.classKeyword),
      message: PublicAccessDiagnosticMessage(
        "\(macroName) class '\(name)' should be public or open, so that the modules provider that autolinking generates in the app target can \(reason)",
        id: "\(idPrefix)-class-not-public"
      ),
      fixIts: [makePublicFixIt(for: classDecl, replacing: accessModifier, idPrefix: idPrefix)]
    )
  )
}

private let accessLevelKeywords: [TokenKind] = [
  .keyword(.open), .keyword(.public), .keyword(.package), .keyword(.internal), .keyword(.fileprivate),
  .keyword(.private),
]

/// True when the declaration is inside a function, closure or another scope that isn't a type or an extension.
private func isLocal(context: some MacroExpansionContext) -> Bool {
  return context.lexicalContext.contains { node in
    return !node.is(ClassDeclSyntax.self) && !node.is(StructDeclSyntax.self) && !node.is(EnumDeclSyntax.self)
      && !node.is(ActorDeclSyntax.self) && !node.is(ExtensionDeclSyntax.self)
  }
}

/// The fix-it for a class that isn't public: replace its access modifier with `public`, or add `public` before
/// its other modifiers.
private func makePublicFixIt(
  for classDecl: ClassDeclSyntax,
  replacing accessModifier: DeclModifierSyntax?,
  idPrefix: String
) -> FixIt {
  let message = PublicAccessFixItMessage("Make the class 'public'", id: "\(idPrefix)-class-insert-public")
  if let accessModifier {
    let newModifier = accessModifier.with(\.name, accessModifier.name.with(\.tokenKind, .keyword(.public)))
    return FixIt(message: message, changes: [.replace(oldNode: Syntax(accessModifier), newNode: Syntax(newModifier))])
  }
  // The new modifier takes over the leading trivia of the first modifier or of `class` (the line break after the
  // attribute), so it lands where the declaration started.
  let newDecl: ClassDeclSyntax
  if let firstModifier = classDecl.modifiers.first {
    let publicModifier = DeclModifierSyntax(
      name: .keyword(.public, leadingTrivia: firstModifier.leadingTrivia, trailingTrivia: .space)
    )
    var modifiers = classDecl.modifiers
    modifiers[modifiers.startIndex] = firstModifier.with(\.leadingTrivia, [])
    modifiers.insert(publicModifier, at: modifiers.startIndex)
    newDecl = classDecl.with(\.modifiers, modifiers)
  } else {
    let classKeyword = classDecl.classKeyword
    let publicModifier = DeclModifierSyntax(
      name: .keyword(.public, leadingTrivia: classKeyword.leadingTrivia, trailingTrivia: .space)
    )
    newDecl =
      classDecl
      .with(\.modifiers, [publicModifier])
      .with(\.classKeyword, classKeyword.with(\.leadingTrivia, []))
  }
  return FixIt(message: message, changes: [.replace(oldNode: Syntax(classDecl), newNode: Syntax(newDecl))])
}

private struct PublicAccessDiagnosticMessage: DiagnosticMessage {
  let message: String
  let diagnosticID: MessageID
  let severity: DiagnosticSeverity = .warning

  init(_ message: String, id: String) {
    self.message = message
    self.diagnosticID = MessageID(domain: "ExpoModulesMacros", id: id)
  }
}

private struct PublicAccessFixItMessage: FixItMessage {
  let message: String
  let fixItID: MessageID

  init(_ message: String, id: String) {
    self.message = message
    self.fixItID = MessageID(domain: "ExpoModulesMacros", id: id)
  }
}

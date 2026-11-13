import SwiftDiagnostics
import SwiftSyntax
import SwiftSyntaxMacros

/// Reports each `@JS` member whose JavaScript name an earlier `@JS` member already binds on the same
/// JavaScript object. Pass the members of one object only: a shared object's static members bind onto
/// the constructor and its instance members onto the prototype, so the two sets are checked separately.
internal func diagnoseJSNameCollisions(
  functions: [JSFunction],
  properties: [JSProperty],
  in context: some MacroExpansionContext
) {
  // Each member binds with its own `setProperty` or `defineProperty` call, so of two members with one
  // name, JavaScript would reach only one. Members are compared in source order, so the error lands on
  // every member after the first, whichever kind each one is.
  let members = functions.map(BoundMember.init(function:)) + properties.map(BoundMember.init(property:))
  var firstMembers: [String: BoundMember] = [:]

  for member in members.sorted(by: { $0.nameToken.position < $1.nameToken.position }) {
    guard let first = firstMembers[member.jsName] else {
      firstMembers[member.jsName] = member
      continue
    }
    let renaming =
      first.renaming == member.renaming ? first.renaming : "\(first.renaming) or \(member.renaming)"
    context.diagnose(
      Diagnostic(
        node: member.nameToken,
        message: JSNameCollisionMessage(
          "The JavaScript name '\(member.jsName)' is already bound by an earlier \(first.kind). A JavaScript object holds one member per name, so JavaScript could reach only one of them. Give one of them another name with \(renaming)."
        ),
        notes: [
          Note(
            node: Syntax(first.nameToken),
            message: JSNameCollisionNote("'\(member.jsName)' is first bound here")
          )
        ]
      )
    )
  }
}

/// The JavaScript object that a set of `@JS` members binds onto, for `diagnoseReservedJSNames`.
internal enum JSBindingTarget {
  /// The module object of an `@ExpoModule` class.
  case module
  /// The prototype of a shared object class, which holds the instance members.
  case prototype
  /// The constructor of a shared object class, which holds the static members.
  case constructor

  /// The names that JavaScript already gives a meaning on this object, with what binding a member
  /// under one would break.
  var reservedNames: [String: String] {
    let proto = "setting '__proto__' on an object replaces its prototype instead of adding a member"
    switch self {
    case .module:
      return ["__proto__": proto]
    case .prototype:
      return [
        "__proto__": proto,
        "constructor": "a member named 'constructor' replaces the prototype's reference to the class",
      ]
    case .constructor:
      return [
        "__proto__": proto,
        "prototype": "a static member named 'prototype' replaces the prototype that holds the instance members",
      ]
    }
  }
}

/// Reports each `@JS` member whose JavaScript name JavaScript already gives a meaning on the object that
/// the member binds onto, such as `constructor` on a shared object's prototype.
internal func diagnoseReservedJSNames(
  functions: [JSFunction],
  properties: [JSProperty],
  on target: JSBindingTarget,
  in context: some MacroExpansionContext
) {
  let members = functions.map(BoundMember.init(function:)) + properties.map(BoundMember.init(property:))
  for member in members {
    guard let reason = target.reservedNames[member.jsName] else {
      continue
    }
    context.diagnose(
      Diagnostic(
        node: member.nameToken,
        message: ReservedJSNameMessage(
          "The JavaScript name '\(member.jsName)' can't be bound: \(reason). Give the \(member.kind) another name with \(member.renaming)."
        )
      )
    )
  }
}

/// Reports each `@Event` property of a class body whose JavaScript event name an earlier `@Event`
/// property already uses. Both properties emit under that name, so a listener can't tell which one fired.
internal func diagnoseEventNameCollisions(in memberBlock: MemberBlockSyntax, in context: some MacroExpansionContext) {
  var firstEvents: [String: TokenSyntax] = [:]

  for member in memberBlock.members {
    guard let varDecl = member.decl.as(VariableDeclSyntax.self),
      let attribute = varDecl.attributes.firstAttribute(named: "Event"),
      let jsName = eventJSName(of: varDecl, attribute: attribute),
      let nameToken = varDecl.bindings.first?.pattern.as(IdentifierPatternSyntax.self)?.identifier
    else {
      continue
    }
    guard let first = firstEvents[jsName] else {
      firstEvents[jsName] = nameToken
      continue
    }
    context.diagnose(
      Diagnostic(
        node: nameToken,
        message: EventNameCollisionMessage(
          "The event name '\(jsName)' is already used by the earlier @Event '\(first.text)'. Both properties emit the same event, so a JavaScript listener can't tell them apart. Give one of them another name with @Event(\"...\")."
        ),
        notes: [
          Note(
            node: Syntax(first),
            message: JSNameCollisionNote("'\(jsName)' is first used here", id: "event-name-collision-first")
          )
        ]
      )
    )
  }
}

private struct BoundMember {
  let jsName: String
  /// How the message names the member, such as `@JS function`.
  let kind: String
  /// The spelling that gives the member another JavaScript name.
  let renaming: String
  let nameToken: TokenSyntax

  init(function: JSFunction) {
    // A `.withAsync` variant takes its JavaScript name from the option, not from `@JS("...")`.
    self.jsName = function.jsName
    self.kind = function.isAsyncVariant ? "'.withAsync' variant" : "@JS function"
    self.renaming = function.isAsyncVariant ? ".withAsync(\"...\")" : "@JS(\"...\")"
    self.nameToken = function.nameToken
  }

  init(property: JSProperty) {
    self.jsName = property.jsName
    self.kind = "@JS property"
    self.renaming = "@JS(\"...\")"
    self.nameToken = property.nameToken
  }
}

private struct JSNameCollisionMessage: DiagnosticMessage {
  let message: String
  let diagnosticID = MessageID(domain: "ExpoModulesMacros", id: "js-name-collision")
  let severity: DiagnosticSeverity = .error

  init(_ message: String) {
    self.message = message
  }
}

private struct ReservedJSNameMessage: DiagnosticMessage {
  let message: String
  let diagnosticID = MessageID(domain: "ExpoModulesMacros", id: "js-reserved-name")
  let severity: DiagnosticSeverity = .error

  init(_ message: String) {
    self.message = message
  }
}

private struct EventNameCollisionMessage: DiagnosticMessage {
  let message: String
  let diagnosticID = MessageID(domain: "ExpoModulesMacros", id: "event-name-collision")
  let severity: DiagnosticSeverity = .warning

  init(_ message: String) {
    self.message = message
  }
}

private struct JSNameCollisionNote: NoteMessage {
  let message: String
  let noteID: MessageID

  init(_ message: String, id: String = "js-name-collision-first") {
    self.message = message
    self.noteID = MessageID(domain: "ExpoModulesMacros", id: id)
  }
}

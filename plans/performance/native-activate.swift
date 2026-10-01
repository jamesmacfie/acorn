// Activates only an already-running, explicitly identified disposable automation bundle.
import AppKit
import Foundation

func refuse(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 3,
      let pid = Int32(CommandLine.arguments[1]), pid > 0 else {
    refuse("Usage: native-activate <owned-app-pid> <automation-app-bundle-path>")
}
let expected = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL.resolvingSymlinksInPath()
guard expected.lastPathComponent == "Acorn Performance Automation.app",
      let app = NSRunningApplication(processIdentifier: pid),
      app.bundleIdentifier == "com.acorn.performance.automation",
      app.bundleURL?.standardizedFileURL.resolvingSymlinksInPath() == expected,
      app.executableURL?.standardizedFileURL.resolvingSymlinksInPath()
        == expected.appendingPathComponent("Contents/MacOS/acorn-desktop"),
      !app.isTerminated else {
    refuse("The PID does not belong to the specified running performance automation bundle.")
}

let accepted = app.activate(options: [.activateAllWindows])
// Activation is asynchronous. Report acceptance separately; native-focus.mjs verifies actual
// native and document focus afterward. Do not replace browser visibility or focus properties.
let result: [String: Any] = [
    "pid": pid,
    "identifier": app.bundleIdentifier!,
    "activationAccepted": accepted,
    "activeAtReturn": app.isActive,
]
let encoded = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(encoded)
FileHandle.standardOutput.write(Data("\n".utf8))

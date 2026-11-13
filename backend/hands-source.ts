export const HANDS_SWIFT = String.raw`import Foundation
import AppKit
import ApplicationServices

func jstr(_ value: String) -> String {
    var out = ""
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
        }
    }
    return out
}

func attr(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    let status = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return status == .success ? value : nil
}

func text(_ element: AXUIElement, _ name: String) -> String {
    if let direct = attr(element, name) as? String { return direct }
    if let number = attr(element, name) as? NSNumber { return number.stringValue }
    return ""
}

func axValue(_ element: AXUIElement, _ name: String) -> AXValue? {
    guard let raw = attr(element, name) else { return nil }
    guard CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    return (raw as! AXValue)
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    guard let raw = attr(element, kAXChildrenAttribute) else { return [] }
    guard CFGetTypeID(raw) == CFArrayGetTypeID() else { return [] }
    return (raw as! [AXUIElement])
}

func axWindows(_ element: AXUIElement) -> [AXUIElement] {
    guard let raw = attr(element, kAXWindowsAttribute) else { return [] }
    guard CFGetTypeID(raw) == CFArrayGetTypeID() else { return [] }
    return (raw as! [AXUIElement])
}

func frame(_ element: AXUIElement) -> (Double, Double, Double, Double) {
    var point = CGPoint.zero
    var size = CGSize.zero
    if let position = axValue(element, kAXPositionAttribute) { AXValueGetValue(position, .cgPoint, &point) }
    if let dimension = axValue(element, kAXSizeAttribute) { AXValueGetValue(dimension, .cgSize, &size) }
    return (Double(point.x), Double(point.y), Double(size.width), Double(size.height))
}

func node(_ element: AXUIElement, depth: Int, maxDepth: Int, budget: inout Int) -> String {
    budget -= 1
    let role = text(element, kAXRoleAttribute)
    let title = text(element, kAXTitleAttribute)
    let description = text(element, kAXDescriptionAttribute)
    let value = text(element, kAXValueAttribute)
    let label = title.isEmpty ? description : title
    let (x, y, w, h) = frame(element)
    var children: [String] = []
    if depth < maxDepth, budget > 0 {
        for kid in axChildren(element) {
            if budget <= 0 { break }
            children.append(node(kid, depth: depth + 1, maxDepth: maxDepth, budget: &budget))
        }
    }
    let inner = children.joined(separator: ",")
    return "{\"role\":\"\(jstr(role))\",\"label\":\"\(jstr(label))\",\"value\":\"\(jstr(value))\",\"rect\":{\"x\":\(x),\"y\":\(y),\"width\":\(w),\"height\":\(h)},\"children\":[\(inner)]}"
}

func windowsCommand() {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        print("[]")
        return
    }
    var rows: [String] = []
    for window in list {
        let layer = window[kCGWindowLayer as String] as? Int ?? 0
        if layer != 0 { continue }
        let number = window[kCGWindowNumber as String] as? Int ?? 0
        let pid = window[kCGWindowOwnerPID as String] as? Int ?? 0
        let owner = window[kCGWindowOwnerName as String] as? String ?? ""
        let name = window[kCGWindowName as String] as? String ?? ""
        let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let x = bounds["X"] as? Double ?? 0
        let y = bounds["Y"] as? Double ?? 0
        let w = bounds["Width"] as? Double ?? 0
        let h = bounds["Height"] as? Double ?? 0
        if number == 0 || pid == 0 || w < 40 || h < 40 { continue }
        rows.append("{\"window_id\":\(number),\"pid\":\(pid),\"app_id\":\"\(jstr(owner.lowercased().replacingOccurrences(of: " ", with: "-")))\",\"app_name\":\"\(jstr(owner))\",\"title\":\"\(jstr(name))\",\"rect\":{\"x\":\(x),\"y\":\(y),\"width\":\(w),\"height\":\(h)},\"onscreen\":true}")
    }
    print("[" + rows.joined(separator: ",") + "]")
}

func treeCommand(_ pid: pid_t, _ maxNodes: Int, _ maxDepth: Int) {
    let app = AXUIElementCreateApplication(pid)
    var budget = maxNodes
    var roots: [String] = []
    let windowList = axWindows(app)
    if !windowList.isEmpty {
        for window in windowList {
            if budget <= 0 { break }
            roots.append(node(window, depth: 0, maxDepth: maxDepth, budget: &budget))
        }
    }
    if roots.isEmpty, budget > 0 {
        roots.append(node(app, depth: 0, maxDepth: maxDepth, budget: &budget))
    }
    print("{\"role\":\"AXApplication\",\"label\":\"\",\"value\":\"\",\"rect\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0},\"children\":[" + roots.joined(separator: ",") + "]}")
}

func hitCommand(_ pid: pid_t, _ x: Double, _ y: Double) {
    let app = AXUIElementCreateApplication(pid)
    var element: AXUIElement?
    let status = AXUIElementCopyElementAtPosition(app, Float(x), Float(y), &element)
    if status != .success || element == nil {
        print("{\"found\":false}")
        return
    }
    let role = text(element!, kAXRoleAttribute)
    let title = text(element!, kAXTitleAttribute)
    let description = text(element!, kAXDescriptionAttribute)
    let label = title.isEmpty ? description : title
    print("{\"found\":true,\"role\":\"\(jstr(role))\",\"label\":\"\(jstr(label))\"}")
}

func mouseCommand(_ x: Double, _ y: Double, _ button: Int, _ count: Int) {
    let point = CGPoint(x: x, y: y)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    let down: CGEventType = button == 2 ? .rightMouseDown : .leftMouseDown
    let up: CGEventType = button == 2 ? .rightMouseUp : .leftMouseUp
    let which: CGMouseButton = button == 2 ? .right : .left
    for index in 0..<max(count, 1) {
        let clickState = Int64(index + 1)
        let downEvent = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: point, mouseButton: which)
        downEvent?.setIntegerValueField(.mouseEventClickState, value: clickState)
        downEvent?.post(tap: .cghidEventTap)
        let upEvent = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: point, mouseButton: which)
        upEvent?.setIntegerValueField(.mouseEventClickState, value: clickState)
        upEvent?.post(tap: .cghidEventTap)
        usleep(40_000)
    }
    print("{\"sent\":true}")
}

var selectedPid: pid_t? = nil

func focusTarget(_ encoded: String) -> Bool {
    guard AXIsProcessTrusted(), let data = encoded.data(using: .utf8),
          let target = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let pid = target["pid"] as? Int, let windowId = target["window_id"] as? UInt32,
          let rect = target["rect"] as? [String: Double], let title = target["title"] as? String,
          let x = rect["x"], let y = rect["y"], let width = rect["width"], let height = rect["height"],
          let listed = CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(windowId)) as? [[String: Any]],
          let actual = listed.first, actual[kCGWindowOwnerPID as String] as? Int == pid,
          let bounds = actual[kCGWindowBounds as String] as? [String: Any],
          let current = CGRect(dictionaryRepresentation: bounds as CFDictionary),
          abs(current.minX - x) < 2, abs(current.minY - y) < 2,
          abs(current.width - width) < 2, abs(current.height - height) < 2 else { return false }
    let app = AXUIElementCreateApplication(pid_t(pid))
    let matching = axWindows(app).filter { window in
        let (wx, wy, ww, wh) = frame(window)
        return abs(wx - x) < 2 && abs(wy - y) < 2 && abs(ww - width) < 2 && abs(wh - height) < 2 &&
            (title.isEmpty || text(window, kAXTitleAttribute) == title)
    }
    guard matching.count == 1, let window = matching.first,
          let process = NSRunningApplication(processIdentifier: pid_t(pid)) else { return false }
    guard process.activate(options: [.activateIgnoringOtherApps]),
          AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success else { return false }
    for _ in 0..<20 {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid_t(pid),
           let focused = attr(app, kAXFocusedWindowAttribute), CFEqual(focused, window) {
            selectedPid = pid_t(pid)
            return true
        }
        usleep(50_000)
    }
    return false
}

func requireTarget(_ index: Int) -> Bool {
    if CommandLine.arguments.count > index, focusTarget(CommandLine.arguments[index]) { return true }
    print("{\"sent\":false,\"error\":\"Selected window could not be focused and verified; no input was sent\"}")
    return false
}

func typeCommand(_ encoded: String) {
    guard let data = Data(base64Encoded: encoded), let body = String(data: data, encoding: .utf8) else {
        print("{\"sent\":false,\"error\":\"text was not base64 utf8\"}")
        return
    }
    let source = CGEventSource(stateID: .hidSystemState)
    for scalar in body.unicodeScalars {
        guard selectedPid == NSWorkspace.shared.frontmostApplication?.processIdentifier else {
            print("{\"sent\":false,\"error\":\"Target focus changed during typing; inspect the partial outcome\"}")
            return
        }
        var unit = UniChar(scalar.value)
        if scalar.value > 0xFFFF { unit = UniChar(0xFFFD) }
        let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        down?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
        down?.post(tap: .cghidEventTap)
        let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        up?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
        up?.post(tap: .cghidEventTap)
        usleep(8_000)
    }
    print("{\"sent\":true}")
}

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
    "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28,
    "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "return": 36,
    "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45,
    "m": 46, ".": 47, "tab": 48, "space": 49, "delete": 51, "escape": 53,
    "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119,
    "pageup": 116, "pagedown": 121, "forwarddelete": 117
]

func keyCommand(_ combo: String) {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    guard let last = parts.last, let code = keyCodes[last] else {
        print("{\"sent\":false,\"error\":\"no key named \(jstr(combo))\"}")
        return
    }
    var flags: CGEventFlags = []
    for modifier in parts.dropLast() {
        if modifier == "cmd" || modifier == "command" { flags.insert(.maskCommand) }
        if modifier == "ctrl" || modifier == "control" { flags.insert(.maskControl) }
        if modifier == "alt" || modifier == "opt" || modifier == "option" { flags.insert(.maskAlternate) }
        if modifier == "shift" { flags.insert(.maskShift) }
    }
    let source = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
    print("{\"sent\":true}")
}

let arguments = CommandLine.arguments
let command = arguments.count > 1 ? arguments[1] : "trusted"
func number(_ index: Int, _ fallback: Double) -> Double {
    return arguments.count > index ? (Double(arguments[index]) ?? fallback) : fallback
}

switch command {
case "trusted":
    print("{\"accessibility\":\(AXIsProcessTrusted() ? "true" : "false")}")
case "windows":
    windowsCommand()
case "axtree":
    treeCommand(pid_t(number(2, 0)), Int(number(3, 400)), Int(number(4, 12)))
case "hit":
    hitCommand(pid_t(number(2, 0)), number(3, 0), number(4, 0))
case "click":
    if requireTarget(6) { mouseCommand(number(2, 0), number(3, 0), Int(number(4, 1)), Int(number(5, 1))) }
case "type":
    if requireTarget(3) { typeCommand(arguments.count > 2 ? arguments[2] : "") }
case "key":
    if requireTarget(3) { keyCommand(arguments.count > 2 ? arguments[2] : "") }
default:
    print("{\"error\":\"unknown command\"}")
}
`;

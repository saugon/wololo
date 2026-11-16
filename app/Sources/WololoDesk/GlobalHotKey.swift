import AppKit
import Carbon.HIToolbox

/// A shortcut that works from any app, through Carbon's `RegisterEventHotKey`: unlike a global event monitor it needs
/// no Accessibility permission, and the system swallows the keystroke, so the app in front never sees it. Registering
/// fails when another app already holds the same combination; then the shortcut only works from the menu.
@MainActor
final class GlobalHotKey {
    private static var handlers: [UInt32: () -> Void] = [:]
    private static var nextID: UInt32 = 1
    private static var isHandlerInstalled = false

    private var ref: EventHotKeyRef?
    private let id: UInt32

    /// `keyCode` is a virtual key code (`kVK_ANSI_L`), `modifiers` Carbon's (`cmdKey | shiftKey`).
    init?(keyCode: Int, modifiers: Int, action: @escaping () -> Void) {
        Self.installHandler()
        id = Self.nextID
        Self.nextID += 1
        let hotKeyID = EventHotKeyID(signature: OSType(0x574F_4C4F), id: id)  // "WOLO"
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), hotKeyID, GetEventDispatcherTarget(), 0, &ref)
        guard status == noErr, let ref else { return nil }
        self.ref = ref
        Self.handlers[id] = action
    }

    func unregister() {
        if let ref { UnregisterEventHotKey(ref) }
        ref = nil
        Self.handlers[id] = nil
    }

    private static func installHandler() {
        guard !isHandlerInstalled else { return }
        isHandlerInstalled = true
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetEventDispatcherTarget(), { _, event, _ in
            var hotKeyID = EventHotKeyID()
            let status = GetEventParameter(
                event,
                EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID),
                nil,
                MemoryLayout<EventHotKeyID>.size,
                nil,
                &hotKeyID
            )
            guard status == noErr else { return status }
            let id = hotKeyID.id
            DispatchQueue.main.async {
                MainActor.assumeIsolated { GlobalHotKey.handlers[id]?() }
            }
            return noErr
        }, 1, &spec, nil, nil)
    }
}

import AppKit
import SwiftUI

/// One entry of the canvas's right-click menu.
struct CanvasMenuItem {
    let title: String
    let action: () -> Void
}

/// The canvas's mouse and trackpad input, read in AppKit so every event comes with its exact point: a press with its
/// click count, the drag and the release, the trackpad's two-finger scroll and pinch, and the right-click menu for what
/// is under the pointer; and ⌫ and Escape, which reach it only while it is the first responder, so a text field
/// with the focus keeps them. Points are in the view's own flipped coordinates, the same as SwiftUI's for the canvas.
struct CanvasInput: NSViewRepresentable {
    struct Handlers {
        var mouseDown: (CGPoint, Int) -> Void
        var mouseDragged: (CGPoint) -> Void
        var mouseUp: (CGPoint) -> Void
        /// The distance to pan by, and whether the scroll just ended (a wheel step always ends).
        var scroll: (CGSize, Bool) -> Void
        /// The factor to zoom by, around the point, and whether the pinch just ended.
        var magnify: (Double, CGPoint, Bool) -> Void
        var menu: (CGPoint) -> [CanvasMenuItem]
        /// ⌫ or forward delete while the canvas has the focus.
        var delete: () -> Void
        /// Escape while the canvas has the focus.
        var cancel: () -> Void
    }

    let handlers: Handlers
    /// Changes when the selection changes; the view then takes the focus, so ⌫ and Escape reach it without a click
    /// first (after "+ Nodo", say), unless `takesFocus` is false or the focus is somewhere it must stay.
    var focusToken: AnyHashable
    var takesFocus: Bool
    /// The canvas and what is laid out beside it (the node drawer), in the view's coordinates: a control in there
    /// gives the focus up to the canvas, one elsewhere (the sidebar, the header) keeps it.
    var focusArea: CGRect

    func makeNSView(context: Context) -> InputView {
        let view = InputView()
        view.handlers = handlers
        view.focusToken = focusToken
        view.focusArea = focusArea
        return view
    }

    func updateNSView(_ nsView: InputView, context: Context) {
        nsView.handlers = handlers
        nsView.focusArea = focusArea
        guard nsView.focusToken != focusToken else { return }
        nsView.focusToken = focusToken
        guard takesFocus else { return }
        // After this update, so a field SwiftUI focuses in the same pass has already taken the focus and keeps it.
        DispatchQueue.main.async { [weak nsView] in nsView?.takeFocusIfFree() }
    }

    final class InputView: NSView {
        var handlers: Handlers?
        var focusToken: AnyHashable?
        var focusArea = CGRect.zero

        override var isFlipped: Bool { true }
        override var acceptsFirstResponder: Bool { true }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        /// Becomes the first responder when nothing in particular has the focus (the window, or the hosting view the
        /// canvas is drawn in) or a control of the canvas or its drawer has it; never from a text field being edited
        /// (its field editor is a text view), nor from a control elsewhere in the window.
        func takeFocusIfFree() {
            guard let window, window.firstResponder !== self, !(window.firstResponder is NSText) else { return }
            if let responder = window.firstResponder, responder !== window {
                guard let view = responder as? NSView else { return }
                let isFree = isDescendant(of: view)
                    || focusArea.contains(convert(view.convert(view.bounds, to: nil), from: nil))
                guard isFree else { return }
            }
            window.makeFirstResponder(self)
        }

        override func mouseDown(with event: NSEvent) {
            // Taking the focus ends the editing of a text field, so ⌫ and Escape go back to the canvas.
            window?.makeFirstResponder(self)
            handlers?.mouseDown(point(of: event), event.clickCount)
        }

        override func mouseDragged(with event: NSEvent) {
            handlers?.mouseDragged(point(of: event))
        }

        override func mouseUp(with event: NSEvent) {
            handlers?.mouseUp(point(of: event))
        }

        override func scrollWheel(with event: NSEvent) {
            guard let handlers else { return }
            // A mouse wheel moves by lines; a trackpad by points.
            let scale: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 10
            let ended = event.phase == .ended || event.phase == .cancelled || event.momentumPhase == .ended
                || (event.phase.isEmpty && event.momentumPhase.isEmpty)
            handlers.scroll(CGSize(width: event.scrollingDeltaX * scale, height: event.scrollingDeltaY * scale), ended)
        }

        override func magnify(with event: NSEvent) {
            let ended = event.phase == .ended || event.phase == .cancelled
            handlers?.magnify(1 + event.magnification, point(of: event), ended)
        }

        override func keyDown(with event: NSEvent) {
            // ⌫ is key code 51, forward delete 117 and Escape 53. A plain view doesn't turn Escape into
            // `cancelOperation`, so it is read here too.
            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
                .subtracting([.function, .numericPad, .capsLock])
            switch (event.keyCode, modifiers.isEmpty) {
            case (51, true), (117, true): handlers?.delete()
            case (53, true): handlers?.cancel()
            default: super.keyDown(with: event)
            }
        }

        override func cancelOperation(_ sender: Any?) {
            handlers?.cancel()
        }

        override func menu(for event: NSEvent) -> NSMenu? {
            guard let items = handlers?.menu(point(of: event)), !items.isEmpty else { return nil }
            let menu = NSMenu()
            for item in items {
                menu.addItem(ClosureMenuItem(title: item.title, action: item.action))
            }
            return menu
        }

        private func point(of event: NSEvent) -> CGPoint {
            convert(event.locationInWindow, from: nil)
        }
    }

    private final class ClosureMenuItem: NSMenuItem {
        private let handler: () -> Void

        init(title: String, action handler: @escaping () -> Void) {
            self.handler = handler
            super.init(title: title, action: #selector(run), keyEquivalent: "")
            target = self
        }

        @available(*, unavailable)
        required init(coder: NSCoder) {
            fatalError("init(coder:) is not used")
        }

        @objc private func run() {
            handler()
        }
    }
}

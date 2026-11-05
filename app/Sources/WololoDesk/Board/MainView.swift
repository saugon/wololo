import SwiftUI
import WololoKit

/// The window's root until the board lands (item 6 replaces this file): how many runs there are and where they are read from.
struct MainView: View {
    let state: AppState

    var body: some View {
        let model = state.model
        VStack(spacing: 8) {
            Text("Wololo Desk")
                .font(Theme.Font.title)
                .foregroundStyle(Theme.text)
            Text(menuBarHeader(model.runs, now: model.now))
                .font(Theme.Font.body)
                .foregroundStyle(Theme.secondary)
            Text("\(model.runs.count) runs en \(model.dataDirectory.runsURL.path)")
                .font(Theme.Font.mono)
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.ground)
    }
}

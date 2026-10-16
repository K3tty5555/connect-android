# Connect Mobile

## Install

Run `npm ci` from the repository root. The root postinstall installs the
independent mobile lockfile.

## Development builds

- iOS: `npm run mobile:ios`
- Android: `npm run mobile:android`
- Metro for an installed development build: `npm run mobile:start`

Expo Go is not a supported runtime because keyboard-controller contains native
code. The Release dependency graph intentionally excludes `expo-dev-client` and
`expo-dev-launcher`.

## iOS physical-device signing

Apple Personal Team signing is a weekly maintenance constraint, not a normal
build cache:

- The tracked iOS configuration is pinned to Personal Team `3489SSDHU2` and
  bundle identifier `app.connect.mobile.team3489ssdhu2`. The previous identifier
  belongs to the previous Team and Apple does not allow it to be registered by
  another Team. Android keeps `app.connect.mobile`.
- A Team change creates a separate iOS app identity and Keychain access group.
  Existing pairing state cannot carry over. After the first install, trust the
  new developer identity in **Settings > General > VPN & Device Management**
  before launching the app.
- The embedded provisioning profile is valid for about 7 days from its signing
  certificate's issue date.
- Rebuilding or running `npm run mobile:ios:reinstall` does not move that date.
  The command reports the embedded profile expiry and warns when 2 days or less
  remain, but it only builds and reinstalls the current signed app.
- To renew, open `apps/mobile/ios/Connect.xcworkspace` in Xcode, select the
  Connect target, and let **Signing & Capabilities** generate a new Personal
  Team profile. Then run `npm run mobile:ios:reinstall` with the iPhone connected
  by cable and unlocked.
- A paid Apple Developer account changes this to annual signing and permits
  TestFlight; Connect does not assume that subscription.

Release builds include the JavaScript bundle and run without Metro. The app
declares `NSLocalNetworkUsageDescription` itself in `app.json`; do not rely on
the dev launcher to retain that permission text in Release builds.

## Private-network connection

Connect prefers a concrete Tailscale `100.64.0.0/10` address so the Mac and
iPhone can pair and reconnect away from the same LAN. Without Tailscale it
falls back to a concrete RFC1918 LAN address. Public addresses, wildcard
listeners, other VPN tunnel addresses, Funnel, public tunnels, relays, and NAT
port mapping remain rejected.

The bridge remains default-off and applies the same pairing, AEAD, device
scope, Workspace Trust, capability, epoch, rate-limit, and audit checks on
both paths. If the preferred address changes while the bridge is enabled,
turn **手机远程** off and on once, then generate a new pairing code.

## Pairing and access

1. On the Mac, open **Connect > 设置 > 手机远程** and enable **手机远程控制**.
2. Choose **配对新手机**, then scan the QR code from the Connect mobile app.
3. Compare the six-digit SAS shown on both devices. Confirm only when the two
   values are identical.
4. A newly paired phone is read-only. Grant **写入** separately from the Mac
   before using terminal input, session creation, closure, or collaboration send.

The Mac remains authoritative. Use **收回写入** to downgrade a device, **吊销**
to reject it permanently, or **断开全部并吊销** when a phone is lost. **解除绑定**
on the phone removes only that phone's local pairing data; it does not replace
desktop revocation.

## Capability limits

- The phone can open only fixed Claude, Codex, Shell, or collaboration sessions
  in workspaces that the desktop has already trusted. It never supplies a path,
  launch command, PID, trust decision, or raw kill request.
- Terminal input requires explicit ownership and the current epoch. A
  collaboration room is not a PTY, so it has no takeover control, epoch, or
  terminal-close action.
- Collaboration history is a bounded complete-message suffix. Attachments are
  represented only by a count; names, paths, and contents are not sent.
- A collaboration draft clears only after the desktop commits and acknowledges
  the message. A disconnect before acknowledgement is treated as ambiguous: the
  draft is restored and is never retried automatically.
- The phone cannot close a collaboration room. Terminal closure is limited to
  the exact currently attached panel at its current epoch and still requires
  native confirmation.

## Honest demo data

Normal launch shows `尚未绑定电脑`. To inspect the approved interaction fixture:

`EXPO_PUBLIC_CONNECT_DEMO=1 npm run mobile:start`

The fixture is marked `演示` and does not call a provider or PTY.

The phone UI is portrait-only. Rotating the device keeps the session in portrait;
the composer still provides an explicit keyboard-dismiss control on iOS.

## Required device matrix

- iOS Simulator: current stable iPhone simulator, light/dark, Reduce Motion,
  VoiceOver, English and Chinese IME.
- Android Emulator: current stable Pixel emulator with Edge-to-Edge,
  light/dark, Remove animations, TalkBack, Gboard Chinese IME.
- Android physical spot check: one Samsung device before declaring keyboard
  acceptance.

## Native acceptance prerequisites

- Full Xcode with an iOS Simulator runtime.
- Android Studio with Android SDK, JDK, and a Pixel AVD.
- One connected Samsung device for the keyboard spot check.

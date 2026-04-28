//! macOS-specific responsiveness tweaks. Two things live here:
//!
//! 1. Window-show animation suppression. NSWindow's default is a slide-in
//!    that can take ~250ms — measured as the dominant cost in our open-paint
//!    metric after we parallelized the backend. Setting animationBehavior to
//!    `.none` makes ⌃Space appear to draw instantly.
//!
//! 2. App Nap opt-out. macOS aggressively throttles "background" apps —
//!    davidcast as a menu-bar accessory with a hidden window qualifies.
//!    After a few minutes of idle, the next ⌃Space pays a wake-up tax
//!    (CPU clock-up, possibly page faults) that we've measured at 11s in
//!    pathological cases. Calling NSProcessInfo.beginActivity with the
//!    user-initiated option keeps us out of nap. We retain the returned
//!    Activity in a static so it isn't released.

#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::runtime::{NSObjectProtocol, ProtocolObject};
use objc2_app_kit::{
    NSMainMenuWindowLevel, NSWindow, NSWindowAnimationBehavior, NSWindowCollectionBehavior,
};
use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
use std::sync::OnceLock;

/// Disable the slide-in animation when the palette window is shown. Called
/// once at app setup with the main window's NSWindow*. Idempotent.
///
/// # Safety
/// `ns_window` must be a valid, retained NSWindow pointer for as long as
/// this function runs (Tauri owns the window so this holds during setup).
pub unsafe fn disable_window_animation(ns_window: *mut std::ffi::c_void) {
    if ns_window.is_null() {
        return;
    }
    let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    window.setAnimationBehavior(NSWindowAnimationBehavior::None);
}

/// Make the palette appear on every Space and float over fullscreen apps.
/// Without this, ⌥Space does nothing while another app is in macOS
/// fullscreen — the palette opens on the original Space and the user sees
/// no UI. With CanJoinAllSpaces + FullScreenAuxiliary + MainMenu level it
/// appears on top of fullscreen content, like Raycast or Spotlight.
///
/// # Safety
/// Same as `disable_window_animation`.
pub unsafe fn make_visible_over_fullscreen(ns_window: *mut std::ffi::c_void) {
    if ns_window.is_null() {
        return;
    }
    let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary;
    window.setCollectionBehavior(behavior);
    window.setLevel(NSMainMenuWindowLevel as isize);
}

/// Holds the activity returned by NSProcessInfo so it stays retained for
/// the lifetime of the process. Dropping it ends the activity and lets
/// App Nap kick back in.
static APP_NAP_ACTIVITY: OnceLock<ActivityHandle> = OnceLock::new();

struct ActivityHandle {
    _activity: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

unsafe impl Send for ActivityHandle {}
unsafe impl Sync for ActivityHandle {}

/// Tell macOS not to throttle this process. Called once at startup.
/// Returns true if the activity was started; false if it was already started.
pub fn opt_out_of_app_nap() -> bool {
    if APP_NAP_ACTIVITY.get().is_some() {
        return false;
    }
    let info = NSProcessInfo::processInfo();
    let reason = NSString::from_str("davidcast palette responsiveness");
    // UserInitiated = active user-driven work. Combined with
    // LatencyCritical so the OS keeps timers + I/O at full speed.
    // We allow idle system sleep — no reason to keep the laptop awake.
    let options = NSActivityOptions::UserInitiatedAllowingIdleSystemSleep
        | NSActivityOptions::LatencyCritical;
    let activity = info.beginActivityWithOptions_reason(options, &reason);
    let _ = APP_NAP_ACTIVITY.set(ActivityHandle { _activity: activity });
    true
}

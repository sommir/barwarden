#[cfg(test)]
use serde::Serialize;
use std::time::{Duration, Instant};

pub const AX_TEXT_FIELD: &str = "AXTextField";
pub const AX_SECURE_TEXT_FIELD: &str = "AXSecureTextField";
pub const FOCUSED_FIELD_ATTRIBUTE_ALLOWLIST: [&str; 5] =
    ["AXRole", "AXSubrole", "AXPosition", "AXSize", "AXWindow"];
const MAX_OBSERVATION_AGE: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AxFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScreenFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ScreenFrame {
    fn fully_contains(self, frame: AxFrame) -> bool {
        frame.x >= self.x
            && frame.y >= self.y
            && frame.x + frame.width <= self.x + self.width
            && frame.y + frame.height <= self.y + self.height
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppIdentity {
    pub bundle_id: String,
    pub process_id: i32,
    pub live: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FallbackEligibility {
    SystemAvailableOrUnknown,
    SystemUnsupported,
}

#[derive(Clone, Debug)]
pub struct FocusedFieldObservation {
    pub permission_granted: bool,
    pub fallback_eligibility: FallbackEligibility,
    pub app: AppIdentity,
    pub role: Option<String>,
    pub subrole: Option<String>,
    pub editable: bool,
    pub frame: Option<AxFrame>,
    pub element_valid: bool,
    pub window_valid: bool,
    pub observed_at: Instant,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FocusedFieldSnapshot {
    pub app: AppIdentity,
    pub role: String,
    pub subrole: Option<String>,
    pub frame: AxFrame,
    pub secure: bool,
    pub reliable: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FocusRejectReason {
    PermissionDenied,
    SystemAutoFillPreferred,
    InvalidApplication,
    OwnedApplication,
    ApplicationTerminated,
    StaleElement,
    StaleWindow,
    StaleObservation,
    UnsupportedRole,
    NotEditable,
    MissingFrame,
    UnreliableGeometry,
    Offscreen,
}

impl FocusRejectReason {
    pub fn code(self) -> &'static str {
        match self {
            Self::PermissionDenied => "permission-denied",
            Self::SystemAutoFillPreferred => "system-autofill-preferred",
            Self::InvalidApplication => "invalid-application",
            Self::OwnedApplication => "owned-application",
            Self::ApplicationTerminated => "application-terminated",
            Self::StaleElement => "stale-element",
            Self::StaleWindow => "stale-window",
            Self::StaleObservation => "stale-observation",
            Self::UnsupportedRole => "unsupported-role",
            Self::NotEditable => "not-editable",
            Self::MissingFrame => "missing-frame",
            Self::UnreliableGeometry => "unreliable-geometry",
            Self::Offscreen => "offscreen",
        }
    }
}

#[cfg(test)]
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusDiagnostic {
    pub reason: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
}

#[cfg(test)]
impl FocusDiagnostic {
    pub fn new(reason: FocusRejectReason, bundle_id: Option<&str>) -> Self {
        Self {
            reason: reason.code(),
            bundle_id: bundle_id
                .map(str::trim)
                .filter(|value| valid_bundle_id(value))
                .map(str::to_owned),
        }
    }
}

pub fn classify_focused_field(
    observation: FocusedFieldObservation,
    screens: &[ScreenFrame],
    self_bundle_id: &str,
    now: Instant,
) -> Result<FocusedFieldSnapshot, FocusRejectReason> {
    if !observation.permission_granted {
        return Err(FocusRejectReason::PermissionDenied);
    }
    if observation.fallback_eligibility != FallbackEligibility::SystemUnsupported {
        return Err(FocusRejectReason::SystemAutoFillPreferred);
    }
    let bundle_id = observation.app.bundle_id.trim();
    if !valid_bundle_id(bundle_id) || observation.app.process_id <= 0 {
        return Err(FocusRejectReason::InvalidApplication);
    }
    if bundle_id == self_bundle_id {
        return Err(FocusRejectReason::OwnedApplication);
    }
    if !observation.app.live {
        return Err(FocusRejectReason::ApplicationTerminated);
    }
    if !observation.element_valid {
        return Err(FocusRejectReason::StaleElement);
    }
    if !observation.window_valid {
        return Err(FocusRejectReason::StaleWindow);
    }
    if now
        .checked_duration_since(observation.observed_at)
        .is_none_or(|age| age > MAX_OBSERVATION_AGE)
    {
        return Err(FocusRejectReason::StaleObservation);
    }

    let role = observation.role.ok_or(FocusRejectReason::UnsupportedRole)?;
    let secure = role == AX_SECURE_TEXT_FIELD
        || observation.subrole.as_deref() == Some(AX_SECURE_TEXT_FIELD);
    if role != AX_TEXT_FIELD && role != AX_SECURE_TEXT_FIELD {
        return Err(FocusRejectReason::UnsupportedRole);
    }
    if !observation.editable {
        return Err(FocusRejectReason::NotEditable);
    }
    let frame = observation.frame.ok_or(FocusRejectReason::MissingFrame)?;
    if ![frame.x, frame.y, frame.width, frame.height]
        .into_iter()
        .all(f64::is_finite)
        || frame.width <= 0.0
        || frame.height <= 0.0
    {
        return Err(FocusRejectReason::UnreliableGeometry);
    }
    if screens.is_empty()
        || frame.width
            > screens
                .iter()
                .map(|screen| screen.width)
                .fold(0.0, f64::max)
        || frame.height
            > screens
                .iter()
                .map(|screen| screen.height)
                .fold(0.0, f64::max)
    {
        return Err(FocusRejectReason::UnreliableGeometry);
    }
    if !screens
        .iter()
        .copied()
        .any(|screen| screen.fully_contains(frame))
    {
        return Err(FocusRejectReason::Offscreen);
    }

    Ok(FocusedFieldSnapshot {
        app: AppIdentity {
            bundle_id: bundle_id.to_owned(),
            ..observation.app
        },
        role,
        subrole: observation.subrole,
        frame,
        secure,
        reliable: true,
    })
}

fn valid_bundle_id(bundle_id: &str) -> bool {
    !bundle_id.is_empty()
        && bundle_id.len() <= 255
        && bundle_id.contains('.')
        && bundle_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn screen() -> ScreenFrame {
        ScreenFrame {
            x: 0.0,
            y: 0.0,
            width: 1440.0,
            height: 900.0,
        }
    }

    fn observation(role: &str) -> FocusedFieldObservation {
        FocusedFieldObservation {
            permission_granted: true,
            fallback_eligibility: FallbackEligibility::SystemUnsupported,
            app: AppIdentity {
                bundle_id: "com.example.editor".into(),
                process_id: 42,
                live: true,
            },
            role: Some(role.into()),
            subrole: None,
            editable: true,
            frame: Some(AxFrame {
                x: 200.0,
                y: 120.0,
                width: 320.0,
                height: 28.0,
            }),
            element_valid: true,
            window_valid: true,
            observed_at: Instant::now(),
        }
    }

    #[test]
    fn accepts_only_live_external_editable_text_and_secure_text() {
        for (role, secure) in [(AX_TEXT_FIELD, false), (AX_SECURE_TEXT_FIELD, true)] {
            let snapshot = classify_focused_field(
                observation(role),
                &[screen()],
                "com.sommir.barwarden",
                Instant::now(),
            )
            .expect("eligible focused field");

            assert_eq!(snapshot.app.bundle_id, "com.example.editor");
            assert_eq!(snapshot.app.process_id, 42);
            assert_eq!(snapshot.role, role);
            assert_eq!(snapshot.secure, secure);
            assert!(snapshot.reliable);
        }
    }

    #[test]
    fn rejects_labels_noneditable_fields_and_barwarden_owned_windows() {
        let mut label = observation("AXStaticText");
        assert_eq!(
            classify_focused_field(
                label.clone(),
                &[screen()],
                "com.sommir.barwarden",
                Instant::now()
            ),
            Err(FocusRejectReason::UnsupportedRole),
        );

        label.role = Some(AX_TEXT_FIELD.into());
        label.editable = false;
        assert_eq!(
            classify_focused_field(label, &[screen()], "com.sommir.barwarden", Instant::now()),
            Err(FocusRejectReason::NotEditable),
        );

        let mut owned = observation(AX_TEXT_FIELD);
        owned.app.bundle_id = "com.sommir.barwarden".into();
        assert_eq!(
            classify_focused_field(owned, &[screen()], "com.sommir.barwarden", Instant::now()),
            Err(FocusRejectReason::OwnedApplication),
        );

        for bundle_id in [String::new(), "not a bundle".into(), "a".repeat(256)] {
            let mut invalid = observation(AX_TEXT_FIELD);
            invalid.app.bundle_id = bundle_id;
            assert_eq!(
                classify_focused_field(invalid, &[screen()], "self", Instant::now()),
                Err(FocusRejectReason::InvalidApplication),
            );
        }
    }

    #[test]
    fn fails_closed_for_permission_system_autofill_or_unreliable_lifecycle() {
        let mut candidate = observation(AX_TEXT_FIELD);
        candidate.permission_granted = false;
        assert_eq!(
            classify_focused_field(candidate, &[screen()], "self", Instant::now()),
            Err(FocusRejectReason::PermissionDenied)
        );

        let mut candidate = observation(AX_TEXT_FIELD);
        candidate.fallback_eligibility = FallbackEligibility::SystemAvailableOrUnknown;
        assert_eq!(
            classify_focused_field(candidate, &[screen()], "self", Instant::now()),
            Err(FocusRejectReason::SystemAutoFillPreferred)
        );

        let mut candidate = observation(AX_TEXT_FIELD);
        candidate.app.live = false;
        assert_eq!(
            classify_focused_field(candidate, &[screen()], "self", Instant::now()),
            Err(FocusRejectReason::ApplicationTerminated)
        );

        let mut candidate = observation(AX_TEXT_FIELD);
        candidate.element_valid = false;
        assert_eq!(
            classify_focused_field(candidate, &[screen()], "self", Instant::now()),
            Err(FocusRejectReason::StaleElement)
        );

        let mut candidate = observation(AX_TEXT_FIELD);
        candidate.window_valid = false;
        assert_eq!(
            classify_focused_field(candidate, &[screen()], "self", Instant::now()),
            Err(FocusRejectReason::StaleWindow)
        );

        let now = Instant::now();
        let mut candidate = observation(AX_TEXT_FIELD);
        candidate.observed_at = now - Duration::from_millis(501);
        assert_eq!(
            classify_focused_field(candidate, &[screen()], "self", now),
            Err(FocusRejectReason::StaleObservation)
        );
    }

    #[test]
    fn rejects_missing_zero_negative_offscreen_and_huge_geometry() {
        let mut candidate = observation(AX_TEXT_FIELD);
        candidate.frame = None;
        assert_eq!(
            classify_focused_field(candidate, &[screen()], "self", Instant::now()),
            Err(FocusRejectReason::MissingFrame)
        );

        for frame in [
            AxFrame {
                x: 10.0,
                y: 10.0,
                width: 0.0,
                height: 20.0,
            },
            AxFrame {
                x: 10.0,
                y: 10.0,
                width: -1.0,
                height: 20.0,
            },
            AxFrame {
                x: 1500.0,
                y: 10.0,
                width: 100.0,
                height: 20.0,
            },
            AxFrame {
                x: 10.0,
                y: 10.0,
                width: 2000.0,
                height: 20.0,
            },
            AxFrame {
                x: f64::NAN,
                y: 10.0,
                width: 100.0,
                height: 20.0,
            },
        ] {
            let mut candidate = observation(AX_TEXT_FIELD);
            candidate.frame = Some(frame);
            assert!(matches!(
                classify_focused_field(candidate, &[screen()], "self", Instant::now()),
                Err(FocusRejectReason::UnreliableGeometry | FocusRejectReason::Offscreen),
            ));
        }
    }

    #[test]
    fn native_reader_allowlist_contains_no_field_content_attributes() {
        assert_eq!(
            FOCUSED_FIELD_ATTRIBUTE_ALLOWLIST,
            ["AXRole", "AXSubrole", "AXPosition", "AXSize", "AXWindow"],
        );
        for forbidden in [
            "AXValue",
            "AXSelectedText",
            "AXPlaceholderValue",
            "AXTitle",
            "AXDescription",
            "AXIdentifier",
        ] {
            assert!(!FOCUSED_FIELD_ATTRIBUTE_ALLOWLIST.contains(&forbidden));
        }
    }

    #[test]
    fn diagnostics_are_fixed_reason_and_bundle_id_only() {
        let diagnostic =
            FocusDiagnostic::new(FocusRejectReason::Offscreen, Some("com.example.editor"));
        assert_eq!(diagnostic.reason, "offscreen");
        assert_eq!(diagnostic.bundle_id.as_deref(), Some("com.example.editor"));
        assert_eq!(
            serde_json::to_value(diagnostic).unwrap(),
            serde_json::json!({ "reason": "offscreen", "bundleId": "com.example.editor" }),
        );
    }
}

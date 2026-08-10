use crate::accessibility_focus::{
    classify_focused_field, AppIdentity, AxFrame, FallbackEligibility, FocusRejectReason,
    FocusedFieldObservation, FocusedFieldSnapshot, ScreenFrame, AX_SECURE_TEXT_FIELD,
    AX_TEXT_FIELD,
};
use crate::autofill_contract::AutoFillSecretField;
use crate::autofill_field_context::{
    classify_fields, detect_action, DetectedAction, DetectedFieldKind, FieldConfidence,
    SemanticFieldObservation,
};
use crate::frontmost::FrontmostApp;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_ANCESTORS: usize = 3;
const MAX_DESCENDANTS: usize = 256;
const MAX_FIELDS: usize = 20;
const MAX_SEMANTIC_SCALARS: usize = 255;
const OBSERVATION_BUDGET: Duration = Duration::from_millis(50);
const CONTEXT_LIFETIME: Duration = Duration::from_secs(30);
const CONTEXT_CAPACITY: usize = 64;

pub trait AxMetadataPort {
    type Element: Clone + PartialEq;

    fn string(&mut self, element: &Self::Element, attribute: &'static str) -> Option<String>;
    fn element(
        &mut self,
        element: &Self::Element,
        attribute: &'static str,
    ) -> Option<Self::Element>;
    fn elements(
        &mut self,
        element: &Self::Element,
        attribute: &'static str,
        limit: usize,
    ) -> Vec<Self::Element>;
    fn frame(&mut self, element: &Self::Element) -> Option<AxFrame>;
    fn value_settable(&mut self, element: &Self::Element) -> bool;
    fn caret_frame(&mut self, element: &Self::Element) -> Option<AxFrame>;
    fn now(&self) -> Instant;
    fn metadata_valid(&self) -> bool {
        true
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AxContextError {
    Focus(FocusRejectReason),
    OversizedMetadata,
    TimeBudgetExceeded,
    MissingWindow,
    NoWritableField,
}

impl From<FocusRejectReason> for AxContextError {
    fn from(value: FocusRejectReason) -> Self {
        Self::Focus(value)
    }
}

#[derive(Clone, Debug)]
#[allow(dead_code)] // The caret is consumed by the Task 3 pill placement.
pub struct CapturedAxContext {
    pub focused: FocusedFieldSnapshot,
    pub caret_frame: Option<AxFrame>,
    pub fields: Vec<CapturedFieldFingerprint>,
    pub action: DetectedAction,
}

#[allow(dead_code)] // The caret-first anchor is consumed by Task 3.
impl CapturedAxContext {
    pub fn anchor_frame(&self) -> AxFrame {
        self.caret_frame.unwrap_or(self.focused.frame)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct CapturedFieldFingerprint {
    pub process_id: i32,
    pub role: String,
    pub frame: AxFrame,
    pub window_frame: AxFrame,
    pub kind: DetectedFieldKind,
    pub secret_field: Option<AutoFillSecretField>,
    pub confidence: FieldConfidence,
    pub focused: bool,
    pub observer_generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresentedFieldKind {
    Username,
    Email,
    Password,
    OneTimeCode,
    Unknown,
}

impl From<DetectedFieldKind> for PresentedFieldKind {
    fn from(value: DetectedFieldKind) -> Self {
        match value {
            DetectedFieldKind::Username => Self::Username,
            DetectedFieldKind::Email => Self::Email,
            DetectedFieldKind::Password => Self::Password,
            DetectedFieldKind::OneTimeCode => Self::OneTimeCode,
            DetectedFieldKind::Unknown => Self::Unknown,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresentedFieldConfidence {
    High,
    Medium,
    Low,
}

impl From<FieldConfidence> for PresentedFieldConfidence {
    fn from(value: FieldConfidence) -> Self {
        match value {
            FieldConfidence::High => Self::High,
            FieldConfidence::Medium => Self::Medium,
            FieldConfidence::Low => Self::Low,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentedField {
    pub kind: PresentedFieldKind,
    pub confidence: PresentedFieldConfidence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresentedActionMode {
    Field,
    Form,
    Choose,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentedAction {
    pub mode: PresentedActionMode,
    pub fields: Vec<AutoFillSecretField>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FillContextPresentation {
    pub fill_context_token: String,
    pub focused_field: PresentedField,
    pub action: PresentedAction,
}

#[derive(Clone, Debug)]
#[allow(dead_code)] // Consumed by the Task 4 native fill executor.
pub struct CapturedFillPlan {
    pub target: FrontmostApp,
    pub fields: Vec<CapturedFieldFingerprint>,
    pub action: DetectedAction,
    pub requested: Vec<AutoFillSecretField>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // Remaining variants are consumed by the Task 4 fill command.
pub enum DetectedFillError {
    InvalidToken,
    Expired,
    CapacityReached,
    WrongFieldSubset,
    TargetChanged,
    StaleProcess,
    StaleWindow,
    StaleField,
    StaleGeneration,
}

#[derive(Clone, Debug, Default)]
pub struct ObserverGeneration(Arc<AtomicU64>);

impl ObserverGeneration {
    #[cfg(test)]
    pub(crate) fn new(generation: u64) -> Self {
        Self(Arc::new(AtomicU64::new(generation)))
    }

    pub(crate) fn current(&self) -> u64 {
        self.0.load(Ordering::Acquire)
    }

    pub(crate) fn set(&self, generation: u64) {
        self.0.store(generation, Ordering::Release);
    }
}

#[allow(dead_code)] // Read by the Task 4 fill executor through `take`.
struct StoredFillContext {
    target: FrontmostApp,
    fields: Vec<CapturedFieldFingerprint>,
    action: DetectedAction,
    deadline: Instant,
}

type Clock = dyn Fn() -> Instant + Send + Sync;
type Validator = dyn Fn(&FrontmostApp, &[CapturedFieldFingerprint], u64) -> Result<(), DetectedFillError>
    + Send
    + Sync;

#[derive(Clone)]
pub struct DetectedFillContextStore {
    records: Arc<Mutex<HashMap<String, StoredFillContext>>>,
    clock: Arc<Clock>,
    observer_generation: ObserverGeneration,
    #[allow(dead_code)] // Invoked by `take`, which Task 4 registers on the command surface.
    validator: Arc<Validator>,
}

impl fmt::Debug for DetectedFillContextStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DetectedFillContextStore")
            .finish_non_exhaustive()
    }
}

impl Default for DetectedFillContextStore {
    fn default() -> Self {
        Self::with_observer_generation(ObserverGeneration::default())
    }
}

impl DetectedFillContextStore {
    pub(crate) fn with_observer_generation(observer_generation: ObserverGeneration) -> Self {
        Self {
            records: Arc::new(Mutex::new(HashMap::new())),
            clock: Arc::new(Instant::now),
            observer_generation,
            validator: Arc::new(validate_live_fingerprints),
        }
    }
}

#[allow(dead_code)] // The complete store contract is consumed beginning in Task 4.
impl DetectedFillContextStore {
    pub fn insert(
        &self,
        target: FrontmostApp,
        fields: Vec<CapturedFieldFingerprint>,
        action: DetectedAction,
    ) -> FillContextPresentation {
        let rejected = presentation_for("".to_owned(), &fields, &action);
        self.try_insert(target, fields, action).unwrap_or(rejected)
    }

    pub(crate) fn try_insert(
        &self,
        target: FrontmostApp,
        fields: Vec<CapturedFieldFingerprint>,
        action: DetectedAction,
    ) -> Result<FillContextPresentation, DetectedFillError> {
        validate_inserted_fingerprints(&target, &fields)?;
        if fields
            .first()
            .is_none_or(|field| field.observer_generation != self.observer_generation.current())
        {
            return Err(DetectedFillError::StaleGeneration);
        }
        let now = (self.clock)();
        let mut records = self
            .records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        records.retain(|_, record| now < record.deadline);
        if records.len() >= CONTEXT_CAPACITY {
            return Err(DetectedFillError::CapacityReached);
        }
        let token = uuid::Uuid::new_v4().to_string();
        let presentation = presentation_for(token.clone(), &fields, &action);
        records.insert(
            token,
            StoredFillContext {
                target,
                fields,
                action,
                deadline: now + CONTEXT_LIFETIME,
            },
        );
        Ok(presentation)
    }

    pub fn take(
        &self,
        token: &str,
        requested: &[AutoFillSecretField],
    ) -> Result<CapturedFillPlan, DetectedFillError> {
        let record = self
            .records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(token)
            .ok_or(DetectedFillError::InvalidToken)?;
        if (self.clock)() >= record.deadline {
            return Err(DetectedFillError::Expired);
        }
        if !requested_fields_allowed(requested, &record.fields, &record.action) {
            return Err(DetectedFillError::WrongFieldSubset);
        }
        let generation = self.observer_generation.current();
        if record
            .fields
            .first()
            .is_none_or(|field| field.observer_generation != generation)
        {
            return Err(DetectedFillError::StaleGeneration);
        }
        (self.validator)(&record.target, &record.fields, generation)?;
        if self.observer_generation.current() != generation {
            return Err(DetectedFillError::StaleGeneration);
        }
        Ok(CapturedFillPlan {
            target: record.target,
            fields: record.fields,
            action: record.action,
            requested: requested.to_vec(),
        })
    }

    pub fn invalidate_all(&self) {
        self.records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    pub(crate) fn current_observer_generation(&self) -> u64 {
        self.observer_generation.current()
    }

    #[cfg(test)]
    fn for_test(
        clock: impl Fn() -> Instant + Send + Sync + 'static,
        validator: impl Fn(&FrontmostApp, &[CapturedFieldFingerprint]) -> Result<(), DetectedFillError>
            + Send
            + Sync
            + 'static,
    ) -> Self {
        Self::for_test_with_generation(
            ObserverGeneration::new(7),
            clock,
            move |target, fields, _| validator(target, fields),
        )
    }

    #[cfg(test)]
    pub(crate) fn for_test_with_generation(
        observer_generation: ObserverGeneration,
        clock: impl Fn() -> Instant + Send + Sync + 'static,
        validator: impl Fn(&FrontmostApp, &[CapturedFieldFingerprint], u64) -> Result<(), DetectedFillError>
            + Send
            + Sync
            + 'static,
    ) -> Self {
        Self {
            records: Arc::new(Mutex::new(HashMap::new())),
            clock: Arc::new(clock),
            observer_generation,
            validator: Arc::new(validator),
        }
    }
}

fn validate_inserted_fingerprints(
    target: &FrontmostApp,
    fields: &[CapturedFieldFingerprint],
) -> Result<(), DetectedFillError> {
    if fields
        .iter()
        .any(|field| field.process_id != target.process_id)
    {
        return Err(DetectedFillError::StaleProcess);
    }
    let Some(first) = fields.first() else {
        return Err(DetectedFillError::StaleField);
    };
    if fields.len() > MAX_FIELDS
        || fields.iter().filter(|field| field.focused).count() != 1
        || fields.iter().any(|field| {
            field.observer_generation != first.observer_generation
                || !valid_frame(&field.frame)
                || !is_text_role(Some(&field.role), None)
        })
    {
        return Err(DetectedFillError::StaleField);
    }
    if !valid_frame(&first.window_frame)
        || fields
            .iter()
            .any(|field| field.window_frame != first.window_frame)
    {
        return Err(DetectedFillError::StaleWindow);
    }
    Ok(())
}

#[allow(dead_code)] // Called by `take`, which Task 4 registers on the command surface.
fn requested_fields_allowed(
    requested: &[AutoFillSecretField],
    fields: &[CapturedFieldFingerprint],
    action: &DetectedAction,
) -> bool {
    if requested.is_empty()
        || requested.len() > 3
        || requested
            .iter()
            .enumerate()
            .any(|(index, field)| requested[..index].contains(field))
    {
        return false;
    }
    match action {
        DetectedAction::Field { field } => requested == [*field],
        DetectedAction::Form { fields: allowed } => {
            requested.iter().all(|field| allowed.contains(field))
                && requested.iter().all(|field| {
                    fields
                        .iter()
                        .any(|captured| captured.secret_field == Some(*field))
                })
        }
        DetectedAction::Choose => requested.len() == 1 && fields.iter().any(|field| field.focused),
    }
}

fn presentation_for(
    token: String,
    fields: &[CapturedFieldFingerprint],
    action: &DetectedAction,
) -> FillContextPresentation {
    let focused = fields.iter().find(|field| field.focused);
    let focused_field = focused.map_or(
        PresentedField {
            kind: PresentedFieldKind::Unknown,
            confidence: PresentedFieldConfidence::Low,
        },
        |field| PresentedField {
            kind: field.kind.into(),
            confidence: field.confidence.into(),
        },
    );
    let action = match action {
        DetectedAction::Field { field } => PresentedAction {
            mode: PresentedActionMode::Field,
            fields: vec![*field],
        },
        DetectedAction::Form { fields } => PresentedAction {
            mode: PresentedActionMode::Form,
            fields: fields.clone(),
        },
        DetectedAction::Choose => PresentedAction {
            mode: PresentedActionMode::Choose,
            fields: Vec::new(),
        },
    };
    FillContextPresentation {
        fill_context_token: token,
        focused_field,
        action,
    }
}

fn validate_live_fingerprints(
    target: &FrontmostApp,
    fields: &[CapturedFieldFingerprint],
    observer_generation: u64,
) -> Result<(), DetectedFillError> {
    if !crate::frontmost::target_is_running(target) {
        return Err(DetectedFillError::TargetChanged);
    }
    if fields
        .iter()
        .any(|field| field.process_id != target.process_id)
    {
        return Err(DetectedFillError::StaleProcess);
    }
    validate_native_fingerprints(target, fields, observer_generation)
}

#[cfg(not(target_os = "macos"))]
fn validate_native_fingerprints(
    _target: &FrontmostApp,
    _fields: &[CapturedFieldFingerprint],
    _observer_generation: u64,
) -> Result<(), DetectedFillError> {
    Ok(())
}

fn validate_current_fingerprints(
    stored: &[CapturedFieldFingerprint],
    current: &[CapturedFieldFingerprint],
    observer_generation: u64,
) -> Result<(), DetectedFillError> {
    if stored
        .iter()
        .chain(current)
        .any(|field| field.observer_generation != observer_generation)
    {
        return Err(DetectedFillError::StaleGeneration);
    }
    if stored.len() != current.len() {
        return Err(DetectedFillError::StaleField);
    }
    let mut matched = vec![false; current.len()];
    for expected in stored {
        let Some(index) = current
            .iter()
            .enumerate()
            .position(|(index, actual)| !matched[index] && actual == expected)
        else {
            if current
                .iter()
                .any(|actual| actual.window_frame != expected.window_frame)
            {
                return Err(DetectedFillError::StaleWindow);
            }
            return Err(DetectedFillError::StaleField);
        };
        matched[index] = true;
    }
    Ok(())
}

fn inspect_bounded_child_entries<T>(
    entries: &[T],
    limit: usize,
    mut valid: impl FnMut(&T) -> bool,
) -> Result<usize, usize> {
    let mut inspected = 0;
    for entry in entries.iter().take(limit) {
        inspected += 1;
        if !valid(entry) {
            return Err(inspected);
        }
    }
    Ok(inspected)
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use crate::accessibility_focus::{validate_ax_value_with, validate_copied_type_with};
    use core_foundation::array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex};
    use core_foundation::base::{
        CFGetTypeID, CFIndex, CFRange, CFRelease, CFRetain, CFTypeID, CFTypeRef, TCFType,
    };
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::{
        kCFStringEncodingUTF8, CFString, CFStringGetBytes, CFStringGetLength, CFStringRef,
    };
    use core_graphics::display::CGDisplay;
    use core_graphics::geometry::{CGPoint, CGRect, CGSize};
    use std::ffi::c_void;
    use std::ptr;

    type AXUIElementRef = *const c_void;
    type AXValueRef = *const c_void;
    type AXError = i32;

    const AX_ERROR_SUCCESS: AXError = 0;
    const AX_VALUE_CGPOINT: i32 = 1;
    const AX_VALUE_CGSIZE: i32 = 2;
    const AX_VALUE_CGRECT: i32 = 3;
    const AX_VALUE_CFRANGE: i32 = 4;
    const MAX_UTF16_UNITS: CFIndex = (MAX_SEMANTIC_SCALARS * 2) as CFIndex;
    const MAX_UTF8_BYTES: usize = MAX_SEMANTIC_SCALARS * 4;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementGetTypeID() -> CFTypeID;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementCopyAttributeValues(
            element: AXUIElementRef,
            attribute: CFStringRef,
            index: CFIndex,
            max_values: CFIndex,
            values: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementCopyParameterizedAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            parameter: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementIsAttributeSettable(
            element: AXUIElementRef,
            attribute: CFStringRef,
            settable: *mut bool,
        ) -> AXError;
        fn AXValueGetValue(value: AXValueRef, value_type: i32, output: *mut c_void) -> bool;
        fn AXValueGetTypeID() -> CFTypeID;
        fn AXValueGetType(value: AXValueRef) -> i32;
    }

    #[derive(Debug, Eq, PartialEq)]
    pub struct NativeAxElement(AXUIElementRef);

    impl Clone for NativeAxElement {
        fn clone(&self) -> Self {
            unsafe { CFRetain(self.0.cast()) };
            Self(self.0)
        }
    }

    impl Drop for NativeAxElement {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0.cast()) };
        }
    }

    pub struct NativeAxMetadataPort {
        descendants_inspected: usize,
        invalid_metadata: bool,
    }

    impl NativeAxMetadataPort {
        fn new() -> Self {
            Self {
                descendants_inspected: 0,
                invalid_metadata: false,
            }
        }

        fn copy_attribute(
            &self,
            element: &NativeAxElement,
            attribute: &'static str,
        ) -> Option<CFTypeRef> {
            let attribute = CFString::from_static_string(attribute);
            let mut value = ptr::null();
            let status = unsafe {
                AXUIElementCopyAttributeValue(
                    element.0,
                    attribute.as_concrete_TypeRef(),
                    &mut value,
                )
            };
            (status == AX_ERROR_SUCCESS && !value.is_null()).then_some(value)
        }

        fn ax_value(
            &mut self,
            element: &NativeAxElement,
            attribute: &'static str,
            expected_type: i32,
        ) -> Option<CFTypeRef> {
            let value = self.copy_attribute(element, attribute)?;
            let validated = unsafe {
                validate_ax_value_with(
                    value,
                    AXValueGetTypeID(),
                    expected_type,
                    |value| CFGetTypeID(value.cast()),
                    |value| AXValueGetType(value.cast()),
                    |value| CFRelease(value.cast()),
                )
            };
            if validated.is_none() {
                self.invalid_metadata = true;
            }
            validated
        }
    }

    impl AxMetadataPort for NativeAxMetadataPort {
        type Element = NativeAxElement;

        fn string(&mut self, element: &Self::Element, attribute: &'static str) -> Option<String> {
            let value = self.copy_attribute(element, attribute)?;
            if attribute == "AXEnabled" {
                let validated = unsafe {
                    validate_copied_type_with(
                        value,
                        CFBoolean::type_id(),
                        |value| CFGetTypeID(value.cast()),
                        |value| CFRelease(value.cast()),
                    )
                };
                let Some(value) = validated else {
                    self.invalid_metadata = true;
                    return None;
                };
                let enabled =
                    unsafe { bool::from(CFBoolean::wrap_under_create_rule(value.cast())) };
                return Some(if enabled { "true" } else { "false" }.to_owned());
            }
            let validated = unsafe {
                validate_copied_type_with(
                    value,
                    CFString::type_id(),
                    |value| CFGetTypeID(value.cast()),
                    |value| CFRelease(value.cast()),
                )
            };
            let Some(value) = validated else {
                self.invalid_metadata = true;
                return None;
            };
            let string = bounded_native_string(value.cast());
            if string.is_none() {
                self.invalid_metadata = true;
            }
            string
        }

        fn element(
            &mut self,
            element: &Self::Element,
            attribute: &'static str,
        ) -> Option<Self::Element> {
            let value = self.copy_attribute(element, attribute)?;
            let validated = unsafe {
                validate_copied_type_with(
                    value,
                    AXUIElementGetTypeID(),
                    |value| CFGetTypeID(value.cast()),
                    |value| CFRelease(value.cast()),
                )
            };
            if validated.is_none() {
                self.invalid_metadata = true;
            }
            validated.map(|value| NativeAxElement(value.cast()))
        }

        fn elements(
            &mut self,
            element: &Self::Element,
            attribute: &'static str,
            limit: usize,
        ) -> Vec<Self::Element> {
            if limit == 0 {
                return Vec::new();
            }
            let attribute = CFString::from_static_string(attribute);
            let mut value = ptr::null();
            let status = unsafe {
                AXUIElementCopyAttributeValues(
                    element.0,
                    attribute.as_concrete_TypeRef(),
                    0,
                    limit.min(MAX_DESCENDANTS) as CFIndex,
                    &mut value,
                )
            };
            if status != AX_ERROR_SUCCESS {
                if !value.is_null() {
                    unsafe { CFRelease(value.cast()) };
                }
                return Vec::new();
            }
            if value.is_null() {
                return Vec::new();
            }
            let Some(value) = (unsafe {
                validate_copied_type_with(
                    value,
                    CFArrayGetTypeID(),
                    |value| CFGetTypeID(value.cast()),
                    |value| CFRelease(value.cast()),
                )
            }) else {
                self.invalid_metadata = true;
                return Vec::new();
            };
            let count = unsafe { CFArrayGetCount(value.cast()) }
                .max(0)
                .min(limit as CFIndex) as usize;
            let entries = (0..count)
                .map(|index| unsafe { CFArrayGetValueAtIndex(value.cast(), index as CFIndex) })
                .collect::<Vec<_>>();
            let inspected = inspect_bounded_child_entries(&entries, limit, |child| {
                !child.is_null()
                    && unsafe { CFGetTypeID((*child).cast()) } == unsafe { AXUIElementGetTypeID() }
            });
            let inspected_count = inspected.unwrap_or_else(|inspected| inspected);
            self.descendants_inspected += inspected_count;
            if inspected.is_err() {
                self.invalid_metadata = true;
                unsafe { CFRelease(value.cast()) };
                return Vec::new();
            }
            let mut result = Vec::with_capacity(count);
            for child in entries {
                unsafe { CFRetain(child.cast()) };
                result.push(NativeAxElement(child.cast()));
            }
            unsafe { CFRelease(value.cast()) };
            result
        }

        fn frame(&mut self, element: &Self::Element) -> Option<AxFrame> {
            let point_value = self.ax_value(element, "AXPosition", AX_VALUE_CGPOINT)?;
            let mut point = CGPoint::new(0.0, 0.0);
            let copied_point = unsafe {
                AXValueGetValue(
                    point_value.cast(),
                    AX_VALUE_CGPOINT,
                    (&mut point as *mut CGPoint).cast(),
                )
            };
            unsafe { CFRelease(point_value.cast()) };
            if !copied_point {
                return None;
            }
            let size_value = self.ax_value(element, "AXSize", AX_VALUE_CGSIZE)?;
            let mut size = CGSize::new(0.0, 0.0);
            let copied_size = unsafe {
                AXValueGetValue(
                    size_value.cast(),
                    AX_VALUE_CGSIZE,
                    (&mut size as *mut CGSize).cast(),
                )
            };
            unsafe { CFRelease(size_value.cast()) };
            copied_size.then_some(AxFrame {
                x: point.x,
                y: point.y,
                width: size.width,
                height: size.height,
            })
        }

        fn value_settable(&mut self, element: &Self::Element) -> bool {
            let attribute = CFString::from_static_string("AXValue");
            let mut settable = false;
            (unsafe {
                AXUIElementIsAttributeSettable(
                    element.0,
                    attribute.as_concrete_TypeRef(),
                    &mut settable,
                ) == AX_ERROR_SUCCESS
            }) && settable
        }

        fn caret_frame(&mut self, element: &Self::Element) -> Option<AxFrame> {
            let range = self.ax_value(element, "AXSelectedTextRange", AX_VALUE_CFRANGE)?;
            let mut selected = CFRange {
                location: 0,
                length: 0,
            };
            let copied = unsafe {
                AXValueGetValue(
                    range.cast(),
                    AX_VALUE_CFRANGE,
                    (&mut selected as *mut CFRange).cast(),
                )
            };
            if !copied || selected.location < 0 || selected.length < 0 {
                unsafe { CFRelease(range.cast()) };
                return None;
            }
            let attribute = CFString::from_static_string("AXBoundsForRange");
            let mut bounds = ptr::null();
            let status = unsafe {
                AXUIElementCopyParameterizedAttributeValue(
                    element.0,
                    attribute.as_concrete_TypeRef(),
                    range,
                    &mut bounds,
                )
            };
            unsafe { CFRelease(range.cast()) };
            if status != AX_ERROR_SUCCESS || bounds.is_null() {
                return None;
            }
            let bounds = unsafe {
                validate_ax_value_with(
                    bounds,
                    AXValueGetTypeID(),
                    AX_VALUE_CGRECT,
                    |value| CFGetTypeID(value.cast()),
                    |value| AXValueGetType(value.cast()),
                    |value| CFRelease(value.cast()),
                )?
            };
            let mut rect = CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(0.0, 0.0));
            let copied = unsafe {
                AXValueGetValue(
                    bounds.cast(),
                    AX_VALUE_CGRECT,
                    (&mut rect as *mut CGRect).cast(),
                )
            };
            unsafe { CFRelease(bounds.cast()) };
            copied.then_some(AxFrame {
                x: rect.origin.x,
                y: rect.origin.y,
                width: rect.size.width,
                height: rect.size.height,
            })
        }

        fn now(&self) -> Instant {
            Instant::now()
        }

        fn metadata_valid(&self) -> bool {
            !self.invalid_metadata
        }
    }

    fn bounded_native_string(value: CFStringRef) -> Option<String> {
        let length = unsafe { CFStringGetLength(value) };
        if length < 0 || length > MAX_UTF16_UNITS {
            unsafe { CFRelease(value.cast()) };
            return None;
        }
        let mut buffer = [0_u8; MAX_UTF8_BYTES];
        let mut bytes_used = 0;
        let converted = unsafe {
            CFStringGetBytes(
                value,
                CFRange {
                    location: 0,
                    length,
                },
                kCFStringEncodingUTF8,
                0,
                false as u8,
                buffer.as_mut_ptr(),
                buffer.len() as CFIndex,
                &mut bytes_used,
            )
        };
        unsafe { CFRelease(value.cast()) };
        if converted != length || bytes_used < 0 {
            return None;
        }
        let string = String::from_utf8(buffer[..bytes_used as usize].to_vec()).ok()?;
        (string.chars().take(MAX_SEMANTIC_SCALARS + 1).count() <= MAX_SEMANTIC_SCALARS)
            .then_some(string)
    }

    fn active_screen_frames() -> Vec<ScreenFrame> {
        CGDisplay::active_displays()
            .unwrap_or_default()
            .into_iter()
            .map(CGDisplay::new)
            .map(|display| display.bounds())
            .map(|bounds| ScreenFrame {
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.size.width,
                height: bounds.size.height,
            })
            .collect()
    }

    pub fn capture_native_fill_context(
        target: &FrontmostApp,
        observer_generation: u64,
    ) -> Result<CapturedAxContext, AxContextError> {
        if !crate::frontmost::target_is_running(target) {
            return Err(AxContextError::Focus(
                FocusRejectReason::ApplicationTerminated,
            ));
        }
        let application = unsafe { AXUIElementCreateApplication(target.process_id) };
        if application.is_null() {
            return Err(AxContextError::Focus(FocusRejectReason::StaleElement));
        }
        let application = NativeAxElement(application);
        let mut port = NativeAxMetadataPort::new();
        let focused = port
            .element(&application, "AXFocusedUIElement")
            .ok_or(AxContextError::Focus(FocusRejectReason::StaleElement))?;
        capture_with_port(
            &mut port,
            focused,
            target.clone(),
            &active_screen_frames(),
            observer_generation,
        )
    }

    pub fn validate_native_fingerprints(
        target: &FrontmostApp,
        fields: &[CapturedFieldFingerprint],
        observer_generation: u64,
    ) -> Result<(), DetectedFillError> {
        let current = capture_native_fill_context(target, observer_generation)
            .map_err(|_| DetectedFillError::StaleField)?;
        validate_current_fingerprints(fields, &current.fields, observer_generation)
    }
}

#[cfg(target_os = "macos")]
pub use macos::capture_native_fill_context;

#[cfg(target_os = "macos")]
fn validate_native_fingerprints(
    target: &FrontmostApp,
    fields: &[CapturedFieldFingerprint],
    observer_generation: u64,
) -> Result<(), DetectedFillError> {
    macos::validate_native_fingerprints(target, fields, observer_generation)
}

#[cfg(not(target_os = "macos"))]
pub fn capture_native_fill_context(
    _target: &FrontmostApp,
    _observer_generation: u64,
) -> Result<CapturedAxContext, AxContextError> {
    Err(AxContextError::Focus(FocusRejectReason::PermissionDenied))
}

pub fn capture_with_port<P: AxMetadataPort>(
    port: &mut P,
    focused_element: P::Element,
    target: FrontmostApp,
    screens: &[ScreenFrame],
    observer_generation: u64,
) -> Result<CapturedAxContext, AxContextError> {
    let started = port.now();
    check_budget(port, started)?;
    let focused_strings = read_semantic_strings(port, &focused_element, started)?;
    ensure_metadata_valid(port)?;

    let mut root = focused_element.clone();
    for _ in 0..MAX_ANCESTORS {
        check_budget(port, started)?;
        let Some(parent) = port.element(&root, "AXParent") else {
            break;
        };
        root = parent;
    }

    let mut queue = VecDeque::from([(root, vec![0_u16])]);
    let mut descendants = Vec::new();
    while let Some((element, path)) = queue.pop_front() {
        check_budget(port, started)?;
        let remaining = MAX_DESCENDANTS.saturating_sub(descendants.len());
        if remaining == 0 {
            break;
        }
        let children = port.elements(&element, "AXChildren", remaining);
        ensure_metadata_valid(port)?;
        for (index, child) in children.into_iter().take(remaining).enumerate() {
            let mut child_path = path.clone();
            child_path.push(index.min(u16::MAX as usize) as u16);
            descendants.push((child.clone(), child_path.clone()));
            queue.push_back((child, child_path));
        }
    }
    let focused_container_path = descendants
        .iter()
        .find(|(element, _)| *element == focused_element)
        .map(|(_, path)| container_path(path))
        .unwrap_or_else(|| vec![0]);
    ensure_metadata_valid(port)?;

    check_budget(port, started)?;
    let window = port
        .element(&focused_element, "AXWindow")
        .ok_or(AxContextError::MissingWindow)?;
    let focused_frame = port
        .frame(&focused_element)
        .ok_or(AxContextError::Focus(FocusRejectReason::MissingFrame))?;
    let window_frame = port
        .frame(&window)
        .filter(valid_frame)
        .ok_or(AxContextError::MissingWindow)?;
    let enabled = read_enabled(port, &focused_element, started)?;
    ensure_metadata_valid(port)?;
    let editable = port.value_settable(&focused_element);
    if !editable || !enabled {
        return Err(AxContextError::NoWritableField);
    }
    let caret_frame = port.caret_frame(&focused_element).filter(valid_caret_frame);
    ensure_metadata_valid(port)?;
    check_budget(port, started)?;

    let focus_observation = FocusedFieldObservation {
        permission_granted: true,
        fallback_eligibility: FallbackEligibility::SystemUnsupported,
        app: AppIdentity {
            bundle_id: target.bundle_id.clone(),
            process_id: target.process_id,
            live: true,
        },
        role: focused_strings.role.clone(),
        subrole: focused_strings.subrole.clone(),
        editable,
        frame: Some(focused_frame),
        element_valid: true,
        window_valid: true,
        observed_at: started,
    };
    let focused = classify_focused_field(
        focus_observation,
        screens,
        crate::frontmost::APP_BUNDLE_ID,
        port.now(),
    )?;

    let mut observations = Vec::new();
    observations.push(semantic_observation(
        focused_strings,
        focused_frame,
        editable,
        enabled,
        true,
        focused_container_path,
    ));
    for (element, path) in descendants {
        if observations.len() >= MAX_FIELDS || element == focused_element {
            continue;
        }
        check_budget(port, started)?;
        let strings = read_semantic_strings(port, &element, started)?;
        ensure_metadata_valid(port)?;
        if !is_text_role(strings.role.as_deref(), strings.subrole.as_deref()) {
            continue;
        }
        let editable = port.value_settable(&element);
        let enabled = read_enabled(port, &element, started)?;
        ensure_metadata_valid(port)?;
        if !editable || !enabled {
            continue;
        }
        let Some(frame) = port.frame(&element).filter(valid_frame) else {
            continue;
        };
        observations.push(semantic_observation(
            strings,
            frame,
            editable,
            enabled,
            false,
            container_path(&path),
        ));
    }
    if observations.is_empty() {
        return Err(AxContextError::NoWritableField);
    }
    check_budget(port, started)?;
    let detected = classify_fields(&observations);
    let action = detect_action(&detected);
    let fields = observations
        .iter()
        .zip(detected.iter())
        .map(|(observation, detected)| {
            let _internal_score = detected.score;
            CapturedFieldFingerprint {
                process_id: target.process_id,
                role: observation.role.clone(),
                frame: observation.frame,
                window_frame,
                kind: detected.kind,
                secret_field: detected.secret_field,
                confidence: detected.confidence,
                focused: detected.focused,
                observer_generation,
            }
        })
        .collect();
    Ok(CapturedAxContext {
        focused,
        caret_frame,
        fields,
        action,
    })
}

#[derive(Default)]
struct SemanticStrings {
    role: Option<String>,
    subrole: Option<String>,
    role_description: Option<String>,
    title: Option<String>,
    description: Option<String>,
    help: Option<String>,
    placeholder: Option<String>,
    identifier: Option<String>,
    linked_title: Option<String>,
}

fn read_semantic_strings<P: AxMetadataPort>(
    port: &mut P,
    element: &P::Element,
    started: Instant,
) -> Result<SemanticStrings, AxContextError> {
    let role = bounded_string(port.string(element, "AXRole"))?;
    let subrole = bounded_string(port.string(element, "AXSubrole"))?;
    let role_description = bounded_string(port.string(element, "AXRoleDescription"))?;
    let title = bounded_string(port.string(element, "AXTitle"))?;
    let description = bounded_string(port.string(element, "AXDescription"))?;
    let help = bounded_string(port.string(element, "AXHelp"))?;
    let placeholder = bounded_string(port.string(element, "AXPlaceholderValue"))?;
    let identifier = bounded_string(port.string(element, "AXIdentifier"))?;
    let linked_title_element = port.element(element, "AXTitleUIElement");
    let linked_title = linked_title_element
        .as_ref()
        .map(|title_element| bounded_string(port.string(title_element, "AXTitle")))
        .transpose()?
        .flatten();
    check_budget(port, started)?;
    Ok(SemanticStrings {
        role,
        subrole,
        role_description,
        title,
        description,
        help,
        placeholder,
        identifier,
        linked_title,
    })
}

fn bounded_string(value: Option<String>) -> Result<Option<String>, AxContextError> {
    match value {
        Some(value)
            if value.chars().take(MAX_SEMANTIC_SCALARS + 1).count() > MAX_SEMANTIC_SCALARS =>
        {
            Err(AxContextError::OversizedMetadata)
        }
        Some(value) if value.is_empty() => Ok(None),
        value => Ok(value),
    }
}

fn read_enabled<P: AxMetadataPort>(
    port: &mut P,
    element: &P::Element,
    started: Instant,
) -> Result<bool, AxContextError> {
    let value = bounded_string(port.string(element, "AXEnabled"))?;
    check_budget(port, started)?;
    Ok(value.as_deref() == Some("true"))
}

fn semantic_observation(
    strings: SemanticStrings,
    frame: AxFrame,
    editable: bool,
    enabled: bool,
    focused: bool,
    container_path: Vec<u16>,
) -> SemanticFieldObservation {
    SemanticFieldObservation {
        role: strings.role.unwrap_or_default(),
        subrole: strings.subrole,
        role_description: strings.role_description,
        title: strings.title,
        description: strings.description,
        help: strings.help,
        placeholder: strings.placeholder,
        identifier: strings.identifier,
        linked_title: strings.linked_title,
        frame,
        editable,
        enabled,
        focused,
        container_path,
    }
}

fn check_budget<P: AxMetadataPort>(port: &P, started: Instant) -> Result<(), AxContextError> {
    if port
        .now()
        .checked_duration_since(started)
        .is_none_or(|elapsed| elapsed > OBSERVATION_BUDGET)
    {
        Err(AxContextError::TimeBudgetExceeded)
    } else {
        Ok(())
    }
}

fn ensure_metadata_valid<P: AxMetadataPort>(port: &P) -> Result<(), AxContextError> {
    port.metadata_valid()
        .then_some(())
        .ok_or(AxContextError::OversizedMetadata)
}

fn container_path(path: &[u16]) -> Vec<u16> {
    if path.len() > 1 {
        path[..path.len() - 1].to_vec()
    } else {
        vec![0]
    }
}

fn is_text_role(role: Option<&str>, _subrole: Option<&str>) -> bool {
    matches!(role, Some(AX_TEXT_FIELD | AX_SECURE_TEXT_FIELD))
}

fn valid_frame(frame: &AxFrame) -> bool {
    [frame.x, frame.y, frame.width, frame.height]
        .into_iter()
        .all(f64::is_finite)
        && frame.width > 0.0
        && frame.height > 0.0
}

fn valid_caret_frame(frame: &AxFrame) -> bool {
    [frame.x, frame.y, frame.width, frame.height]
        .into_iter()
        .all(f64::is_finite)
        && frame.width >= 0.0
        && frame.height > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accessibility_focus::{AxFrame, ScreenFrame};
    use crate::autofill_contract::AutoFillSecretField;
    use crate::autofill_field_context::{DetectedAction, DetectedFieldKind, FieldConfidence};
    use crate::frontmost::test_frontmost_app;
    use std::cell::Cell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[derive(Clone, Debug, Eq, Hash, PartialEq)]
    struct Element(u16);

    struct FakePort {
        started: Instant,
        elapsed: Duration,
        now_calls: Cell<usize>,
        strings: HashMap<(u16, &'static str), String>,
        elements: HashMap<(u16, &'static str), Element>,
        children: HashMap<u16, Vec<Element>>,
        frames: HashMap<u16, AxFrame>,
        settable: HashSet<u16>,
        caret: Option<AxFrame>,
        requested: Vec<&'static str>,
        parameterized: Vec<&'static str>,
        child_visits: usize,
        child_request_limits: Vec<usize>,
        parent_requests: usize,
    }

    impl FakePort {
        fn login_form() -> Self {
            let started = Instant::now();
            let field = |x| AxFrame {
                x,
                y: 100.0,
                width: 180.0,
                height: 24.0,
            };
            Self {
                started,
                elapsed: Duration::ZERO,
                now_calls: Cell::new(0),
                strings: HashMap::from([
                    ((1, "AXRole"), "AXTextField".into()),
                    ((1, "AXPlaceholderValue"), "Email".into()),
                    ((1, "AXEnabled"), "true".into()),
                    ((2, "AXRole"), "AXSecureTextField".into()),
                    ((2, "AXPlaceholderValue"), "Password".into()),
                    ((2, "AXEnabled"), "true".into()),
                ]),
                elements: HashMap::from([
                    ((1, "AXParent"), Element(10)),
                    ((10, "AXParent"), Element(11)),
                    ((11, "AXParent"), Element(12)),
                    ((1, "AXWindow"), Element(20)),
                ]),
                children: HashMap::from([
                    (12, vec![Element(11)]),
                    (11, vec![Element(10)]),
                    (10, vec![Element(1), Element(2)]),
                ]),
                frames: HashMap::from([
                    (1, field(100.0)),
                    (2, field(100.0)),
                    (
                        20,
                        AxFrame {
                            x: 20.0,
                            y: 20.0,
                            width: 800.0,
                            height: 600.0,
                        },
                    ),
                ]),
                settable: HashSet::from([1, 2]),
                caret: Some(AxFrame {
                    x: 116.0,
                    y: 102.0,
                    width: 1.0,
                    height: 20.0,
                }),
                requested: Vec::new(),
                parameterized: Vec::new(),
                child_visits: 0,
                child_request_limits: Vec::new(),
                parent_requests: 0,
            }
        }

        fn record(&mut self, attribute: &'static str) {
            if !self.requested.contains(&attribute) {
                self.requested.push(attribute);
            }
        }
    }

    impl AxMetadataPort for FakePort {
        type Element = Element;

        fn string(&mut self, element: &Self::Element, attribute: &'static str) -> Option<String> {
            self.record(attribute);
            self.strings.get(&(element.0, attribute)).cloned()
        }

        fn element(
            &mut self,
            element: &Self::Element,
            attribute: &'static str,
        ) -> Option<Self::Element> {
            self.record(attribute);
            if attribute == "AXParent" {
                self.parent_requests += 1;
            }
            self.elements.get(&(element.0, attribute)).cloned()
        }

        fn elements(
            &mut self,
            element: &Self::Element,
            attribute: &'static str,
            limit: usize,
        ) -> Vec<Self::Element> {
            self.record(attribute);
            self.child_request_limits.push(limit);
            let result = self
                .children
                .get(&element.0)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .take(limit)
                .collect::<Vec<_>>();
            self.child_visits += result.len();
            result
        }

        fn frame(&mut self, element: &Self::Element) -> Option<AxFrame> {
            self.record("AXPosition");
            self.record("AXSize");
            self.frames.get(&element.0).copied()
        }

        fn value_settable(&mut self, element: &Self::Element) -> bool {
            self.settable.contains(&element.0)
        }

        fn caret_frame(&mut self, _element: &Self::Element) -> Option<AxFrame> {
            self.record("AXSelectedTextRange");
            self.parameterized.push("AXBoundsForRange");
            self.caret
        }

        fn now(&self) -> Instant {
            let call = self.now_calls.get();
            self.now_calls.set(call + 1);
            self.started
                + if call == 0 {
                    Duration::ZERO
                } else {
                    self.elapsed
                }
        }
    }

    fn screen() -> ScreenFrame {
        ScreenFrame {
            x: 0.0,
            y: 0.0,
            width: 1440.0,
            height: 900.0,
        }
    }

    fn fingerprint(field: AutoFillSecretField, focused: bool) -> CapturedFieldFingerprint {
        CapturedFieldFingerprint {
            process_id: 42,
            role: if field == AutoFillSecretField::Password {
                "AXSecureTextField"
            } else {
                "AXTextField"
            }
            .into(),
            frame: AxFrame {
                x: 100.0,
                y: 100.0,
                width: 180.0,
                height: 24.0,
            },
            window_frame: AxFrame {
                x: 20.0,
                y: 20.0,
                width: 800.0,
                height: 600.0,
            },
            kind: if field == AutoFillSecretField::Password {
                DetectedFieldKind::Password
            } else {
                DetectedFieldKind::Email
            },
            secret_field: Some(field),
            confidence: FieldConfidence::High,
            focused,
            observer_generation: 7,
        }
    }

    #[test]
    fn reader_uses_only_the_bounded_privacy_allowlist_and_prefers_caret() {
        let mut port = FakePort::login_form();
        port.caret = Some(AxFrame {
            x: 116.0,
            y: 102.0,
            width: 0.0,
            height: 20.0,
        });
        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .expect("safe form");

        assert_eq!(
            port.requested,
            vec![
                "AXRole",
                "AXSubrole",
                "AXRoleDescription",
                "AXTitle",
                "AXDescription",
                "AXHelp",
                "AXPlaceholderValue",
                "AXIdentifier",
                "AXTitleUIElement",
                "AXParent",
                "AXChildren",
                "AXWindow",
                "AXPosition",
                "AXSize",
                "AXEnabled",
                "AXSelectedTextRange",
            ]
        );
        assert!(!port.requested.contains(&"AXValue"));
        assert!(port.parameterized.contains(&"AXBoundsForRange"));
        assert_eq!(capture.anchor_frame(), port.caret.unwrap());
        assert!(!valid_frame(&port.caret.unwrap()));
        assert_eq!(capture.fields.len(), 2);
        assert_eq!(
            capture.action,
            DetectedAction::Form {
                fields: vec![AutoFillSecretField::Username, AutoFillSecretField::Password]
            }
        );
    }

    #[test]
    fn reader_rejects_malformed_carets_without_relaxing_field_geometry() {
        for caret in [
            AxFrame {
                x: 116.0,
                y: 102.0,
                width: -1.0,
                height: 20.0,
            },
            AxFrame {
                x: f64::NAN,
                y: 102.0,
                width: 0.0,
                height: 20.0,
            },
            AxFrame {
                x: 116.0,
                y: 102.0,
                width: 0.0,
                height: 0.0,
            },
        ] {
            assert!(!valid_caret_frame(&caret));
        }
        assert!(!valid_frame(&AxFrame {
            x: 100.0,
            y: 100.0,
            width: 0.0,
            height: 24.0,
        }));
    }

    #[test]
    fn reader_falls_back_to_field_and_enforces_all_traversal_bounds() {
        let mut port = FakePort::login_form();
        port.caret = None;
        port.children.insert(12, (30..400).map(Element).collect());
        for id in 30..400 {
            port.strings.insert((id, "AXRole"), "AXTextField".into());
            port.strings
                .insert((id, "AXPlaceholderValue"), "Email".into());
            port.strings.insert((id, "AXEnabled"), "true".into());
            port.frames.insert(
                id,
                AxFrame {
                    x: 100.0,
                    y: f64::from(id),
                    width: 180.0,
                    height: 24.0,
                },
            );
            port.settable.insert(id);
        }
        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .expect("bounded capture");

        assert_eq!(capture.anchor_frame(), capture.focused.frame);
        assert!(port.child_visits <= 256);
        assert!(capture.fields.len() <= 20);
        assert_eq!(port.parent_requests, 3);
    }

    #[test]
    fn reader_rejects_oversized_metadata_and_work_past_fifty_milliseconds() {
        let mut bounded = FakePort::login_form();
        bounded.strings.insert((1, "AXTitle"), "界".repeat(255));
        assert!(capture_with_port(
            &mut bounded,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .is_ok());

        let mut oversized = FakePort::login_form();
        oversized.strings.insert((1, "AXTitle"), "界".repeat(256));
        assert_eq!(
            capture_with_port(
                &mut oversized,
                Element(1),
                test_frontmost_app("com.example.editor", 42, 9),
                &[screen()],
                7
            )
            .unwrap_err(),
            AxContextError::OversizedMetadata
        );

        let mut slow = FakePort::login_form();
        slow.elapsed = Duration::from_millis(51);
        assert_eq!(
            capture_with_port(
                &mut slow,
                Element(1),
                test_frontmost_app("com.example.editor", 42, 9),
                &[screen()],
                7
            )
            .unwrap_err(),
            AxContextError::TimeBudgetExceeded
        );

        let mut boundary = FakePort::login_form();
        boundary.elapsed = Duration::from_millis(50);
        assert!(capture_with_port(
            &mut boundary,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .is_ok());
    }

    #[test]
    fn reader_rejects_a_disabled_focus_and_invalid_window_geometry() {
        let mut disabled = FakePort::login_form();
        disabled.strings.insert((1, "AXEnabled"), "false".into());
        assert_eq!(
            capture_with_port(
                &mut disabled,
                Element(1),
                test_frontmost_app("com.example.editor", 42, 9),
                &[screen()],
                7,
            )
            .unwrap_err(),
            AxContextError::NoWritableField,
        );

        let mut invalid_window = FakePort::login_form();
        invalid_window.frames.insert(
            20,
            AxFrame {
                x: 20.0,
                y: 20.0,
                width: f64::NAN,
                height: 600.0,
            },
        );
        assert_eq!(
            capture_with_port(
                &mut invalid_window,
                Element(1),
                test_frontmost_app("com.example.editor", 42, 9),
                &[screen()],
                7,
            )
            .unwrap_err(),
            AxContextError::MissingWindow,
        );
    }

    #[test]
    fn tokens_expire_at_thirty_seconds_and_are_consumed_on_every_take_attempt() {
        let now = Arc::new(Mutex::new(Instant::now()));
        let store = DetectedFillContextStore::for_test(
            {
                let now = Arc::clone(&now);
                move || *now.lock().unwrap()
            },
            |_, _| Ok(()),
        );
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );
        assert!(uuid::Uuid::parse_str(&presentation.fill_context_token).is_ok());
        *now.lock().unwrap() += Duration::from_secs(30);
        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::Expired
        );
        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::InvalidToken
        );

        let wrong = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );
        assert_eq!(
            store
                .take(&wrong.fill_context_token, &[AutoFillSecretField::Username])
                .unwrap_err(),
            DetectedFillError::WrongFieldSubset
        );
        assert_eq!(
            store
                .take(&wrong.fill_context_token, &[AutoFillSecretField::Password])
                .unwrap_err(),
            DetectedFillError::InvalidToken
        );
    }

    #[test]
    fn capacity_rejects_without_evicting_and_invalidation_burns_every_context() {
        let store = DetectedFillContextStore::for_test(Instant::now, |_, _| Ok(()));
        let first = store.insert(
            test_frontmost_app("com.example.editor", 42, 1),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );
        for instance in 2..=64 {
            assert!(!store
                .insert(
                    test_frontmost_app("com.example.editor", 42, instance),
                    vec![fingerprint(AutoFillSecretField::Password, true)],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password
                    }
                )
                .fill_context_token
                .is_empty());
        }
        assert_eq!(
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, 65),
                    vec![fingerprint(AutoFillSecretField::Password, true)],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password
                    }
                )
                .unwrap_err(),
            DetectedFillError::CapacityReached
        );
        assert!(store
            .take(&first.fill_context_token, &[AutoFillSecretField::Password])
            .is_ok());

        let remaining = store.insert(
            test_frontmost_app("com.example.editor", 42, 66),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );
        store.invalidate_all();
        assert_eq!(
            store
                .take(
                    &remaining.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::InvalidToken
        );
    }

    #[test]
    fn expired_capacity_is_purged_before_a_new_context_is_inserted() {
        let now = Arc::new(Mutex::new(Instant::now()));
        let store = DetectedFillContextStore::for_test(
            {
                let now = Arc::clone(&now);
                move || *now.lock().unwrap()
            },
            |_, _| Ok(()),
        );
        for instance in 1..=64 {
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, instance),
                    vec![fingerprint(AutoFillSecretField::Password, true)],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password,
                    },
                )
                .unwrap();
        }
        *now.lock().unwrap() += Duration::from_secs(30);
        assert!(store
            .try_insert(
                test_frontmost_app("com.example.editor", 42, 65),
                vec![fingerprint(AutoFillSecretField::Password, true)],
                DetectedAction::Field {
                    field: AutoFillSecretField::Password,
                },
            )
            .is_ok());
    }

    #[test]
    fn ambiguous_but_valid_focused_field_preserves_a_choose_context() {
        let mut port = FakePort::login_form();
        port.strings
            .insert((1, "AXPlaceholderValue"), "Account".into());
        port.children.insert(10, vec![Element(1)]);
        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .expect("editable focused fallback");
        assert_eq!(capture.action, DetectedAction::Choose);

        let store = DetectedFillContextStore::for_test(Instant::now, |_, _| Ok(()));
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            capture.fields,
            capture.action,
        );
        assert_eq!(presentation.action.mode, PresentedActionMode::Choose);
        assert!(presentation.action.fields.is_empty());
        assert!(uuid::Uuid::parse_str(&presentation.fill_context_token).is_ok());
    }

    #[test]
    fn stale_app_pid_window_and_field_fingerprints_fail_closed() {
        for error in [
            DetectedFillError::TargetChanged,
            DetectedFillError::StaleProcess,
            DetectedFillError::StaleWindow,
            DetectedFillError::StaleField,
        ] {
            let store = DetectedFillContextStore::for_test(Instant::now, move |_, _| Err(error));
            let presentation = store.insert(
                test_frontmost_app("com.example.editor", 42, 9),
                vec![fingerprint(AutoFillSecretField::Password, true)],
                DetectedAction::Field {
                    field: AutoFillSecretField::Password,
                },
            );
            assert_eq!(
                store
                    .take(
                        &presentation.fill_context_token,
                        &[AutoFillSecretField::Password]
                    )
                    .unwrap_err(),
                error
            );
            assert_eq!(
                store
                    .take(
                        &presentation.fill_context_token,
                        &[AutoFillSecretField::Password]
                    )
                    .unwrap_err(),
                DetectedFillError::InvalidToken
            );
        }
    }

    #[test]
    fn insertion_rejects_cross_process_and_mixed_generation_fingerprints() {
        let store = DetectedFillContextStore::for_test(Instant::now, |_, _| Ok(()));
        let mut wrong_process = fingerprint(AutoFillSecretField::Password, true);
        wrong_process.process_id = 41;
        assert_eq!(
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, 9),
                    vec![wrong_process],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password,
                    },
                )
                .unwrap_err(),
            DetectedFillError::StaleProcess,
        );

        let username = fingerprint(AutoFillSecretField::Username, true);
        let mut password = fingerprint(AutoFillSecretField::Password, false);
        password.observer_generation = 8;
        assert_eq!(
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, 9),
                    vec![username, password],
                    DetectedAction::Form {
                        fields: vec![AutoFillSecretField::Username, AutoFillSecretField::Password,],
                    },
                )
                .unwrap_err(),
            DetectedFillError::StaleField,
        );
    }

    #[test]
    fn live_validation_requires_exact_field_multiset_and_real_generation() {
        let username = fingerprint(AutoFillSecretField::Username, true);
        let password = fingerprint(AutoFillSecretField::Password, false);
        let stored = vec![username.clone(), password.clone()];

        let mut reordered = vec![password.clone(), username.clone()];
        assert_eq!(
            validate_current_fingerprints(&stored, &reordered, 7),
            Ok(())
        );

        reordered[0].focused = true;
        reordered[1].focused = false;
        assert_eq!(
            validate_current_fingerprints(&stored, &reordered, 7),
            Err(DetectedFillError::StaleField)
        );

        let mut extra_confirm = stored.clone();
        extra_confirm.push(password.clone());
        assert_eq!(
            validate_current_fingerprints(&stored, &extra_confirm, 7),
            Err(DetectedFillError::StaleField)
        );
        assert_eq!(
            validate_current_fingerprints(&stored, &stored[..1], 7),
            Err(DetectedFillError::StaleField)
        );

        let mut changed_kind = stored.clone();
        changed_kind[1].kind = DetectedFieldKind::Unknown;
        assert_eq!(
            validate_current_fingerprints(&stored, &changed_kind, 7),
            Err(DetectedFillError::StaleField)
        );
        let mut changed_confidence = stored.clone();
        changed_confidence[1].confidence = FieldConfidence::Medium;
        assert_eq!(
            validate_current_fingerprints(&stored, &changed_confidence, 7),
            Err(DetectedFillError::StaleField)
        );
        let mut changed_secret_mapping = stored.clone();
        changed_secret_mapping[1].secret_field = Some(AutoFillSecretField::Username);
        assert_eq!(
            validate_current_fingerprints(&stored, &changed_secret_mapping, 7),
            Err(DetectedFillError::StaleField)
        );
        assert_eq!(
            validate_current_fingerprints(&stored, &stored, 8),
            Err(DetectedFillError::StaleGeneration)
        );
    }

    #[test]
    fn observer_generation_change_burns_the_token_before_live_validation() {
        let generation = ObserverGeneration::new(7);
        let validator_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let store =
            DetectedFillContextStore::for_test_with_generation(generation.clone(), Instant::now, {
                let validator_calls = Arc::clone(&validator_calls);
                move |_, _, _| {
                    validator_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(())
                }
            });
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );

        generation.set(8);
        assert_eq!(
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, 9),
                    vec![fingerprint(AutoFillSecretField::Password, true)],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password,
                    },
                )
                .unwrap_err(),
            DetectedFillError::StaleGeneration
        );
        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::StaleGeneration
        );
        assert_eq!(validator_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::InvalidToken
        );
    }

    #[test]
    fn observer_generation_change_during_live_validation_rejects_the_taken_token() {
        let generation = ObserverGeneration::new(7);
        let store =
            DetectedFillContextStore::for_test_with_generation(generation.clone(), Instant::now, {
                let generation = generation.clone();
                move |_, _, observed_generation| {
                    assert_eq!(observed_generation, 7);
                    generation.set(8);
                    Ok(())
                }
            });
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );

        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::StaleGeneration
        );
    }

    #[test]
    fn descendant_reader_requests_only_the_remaining_bounded_allowance() {
        let mut port = FakePort::login_form();
        port.children.insert(12, (30..400).map(Element).collect());
        let _ = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        );

        assert!(!port.child_request_limits.is_empty());
        assert!(port
            .child_request_limits
            .iter()
            .all(|limit| *limit <= MAX_DESCENDANTS));
        assert_eq!(port.child_request_limits[0], MAX_DESCENDANTS);
    }

    #[test]
    fn invalid_bounded_child_entry_is_charged_and_fails_immediately() {
        let inspected = Cell::new(0);
        let result = inspect_bounded_child_entries(&[true, false, true], 3, |valid| {
            inspected.set(inspected.get() + 1);
            *valid
        });

        assert_eq!(result, Err(2));
        assert_eq!(inspected.get(), 2);
    }
}
